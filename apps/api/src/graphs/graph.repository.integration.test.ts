import { describe, expect, it, beforeEach } from "vitest";

import { useDatabase, seedTrack, seedWorkspace } from "../testing/harness.js";
import { GraphRepository, GraphVersionConflictError } from "./graph.repository.js";

/**
 * Optimistic concurrency, where it actually happens.
 *
 * `updateLayout` reads the version, compares it, writes the positions, and
 * bumps the version — all inside one `$transaction`, because a partially
 * applied layout would leave the canvas in a state neither client asked for.
 * That is a claim about transaction behaviour, and only a real database can
 * settle it: a mocked Prisma would happily "roll back" whatever the mock was
 * told to.
 */
describe("graph persistence", () => {
  const db = useDatabase();

  let workspaceId: string;

  beforeEach(async () => {
    workspaceId = (await seedWorkspace(db())).workspaceId;
  });

  it("applies a layout batch and bumps the version", async () => {
    const repository = new GraphRepository(db());
    const graph = await repository.createGraph(workspaceId, { name: "G" });
    const trackId = await seedTrack(db(), workspaceId);
    const node = await repository.addNode(workspaceId, graph.id, { trackId, x: 0, y: 0 });

    const updated = await repository.updateLayout(workspaceId, graph.id, {
      expectedVersion: graph.version,
      positions: [{ id: node!.id, x: 45, y: 84 }],
    });

    expect(updated!.version).toBe(graph.version + 1);
    const [moved] = await repository.listNodes(workspaceId, graph.id);
    expect({ x: moved?.x, y: moved?.y }).toEqual({ x: 45, y: 84 });
  });

  it("rejects a stale version and leaves every position untouched", async () => {
    const repository = new GraphRepository(db());
    const graph = await repository.createGraph(workspaceId, { name: "G" });
    const trackId = await seedTrack(db(), workspaceId);
    const node = await repository.addNode(workspaceId, graph.id, { trackId, x: 1, y: 2 });

    // Someone else moves it first, which advances the version.
    await repository.updateLayout(workspaceId, graph.id, {
      expectedVersion: graph.version,
      positions: [{ id: node!.id, x: 10, y: 20 }],
    });

    await expect(
      repository.updateLayout(workspaceId, graph.id, {
        expectedVersion: graph.version,
        positions: [{ id: node!.id, x: 999, y: 999 }],
      }),
    ).rejects.toThrow(GraphVersionConflictError);

    const [after] = await repository.listNodes(workspaceId, graph.id);
    expect({ x: after?.x, y: after?.y }).toEqual({ x: 10, y: 20 });
  });

  it("rolls the whole batch back when the version check fails mid-write", async () => {
    // The transaction claim. The conflict is detected before any write here,
    // but the assertion is what would catch a future refactor that moved the
    // check after the loop.
    const repository = new GraphRepository(db());
    const graph = await repository.createGraph(workspaceId, { name: "G" });
    const nodes = [];
    for (const title of ["A", "B", "C"]) {
      const trackId = await seedTrack(db(), workspaceId, { title });
      nodes.push(await repository.addNode(workspaceId, graph.id, { trackId, x: 0, y: 0 }));
    }

    await expect(
      repository.updateLayout(workspaceId, graph.id, {
        expectedVersion: graph.version + 99,
        positions: nodes.map((node) => ({ id: node!.id, x: 500, y: 500 })),
      }),
    ).rejects.toThrow(GraphVersionConflictError);

    const after = await repository.listNodes(workspaceId, graph.id);
    expect(after.every((node) => node.x === 0 && node.y === 0)).toBe(true);
  });

  it("is idempotent when a track is placed twice", async () => {
    // What the endpoint documentation promises: re-adding returns the
    // existing node rather than erroring on `@@unique([graphId, trackId])`.
    const repository = new GraphRepository(db());
    const graph = await repository.createGraph(workspaceId, { name: "G" });
    const trackId = await seedTrack(db(), workspaceId);

    const first = await repository.addNode(workspaceId, graph.id, { trackId, x: 1, y: 1 });
    const second = await repository.addNode(workspaceId, graph.id, { trackId, x: 9, y: 9 });

    expect(second!.id).toBe(first!.id);
    expect(await repository.listNodes(workspaceId, graph.id)).toHaveLength(1);
  });

  it("lets one track sit on two different graphs", async () => {
    // Position lives on the node, not the track (§7.2), so the same track can
    // appear in several graphs with its own layout in each.
    const repository = new GraphRepository(db());
    const one = await repository.createGraph(workspaceId, { name: "One" });
    const two = await repository.createGraph(workspaceId, { name: "Two" });
    const trackId = await seedTrack(db(), workspaceId);

    await repository.addNode(workspaceId, one.id, { trackId, x: 1, y: 1 });
    const other = await repository.addNode(workspaceId, two.id, { trackId, x: 2, y: 2 });

    expect(other).not.toBeNull();
    expect(await repository.listNodes(workspaceId, one.id)).toHaveLength(1);
  });

  it("refuses a transition whose endpoints are not both in the workspace", async () => {
    const repository = new GraphRepository(db());
    const from = await seedTrack(db(), workspaceId, { title: "From" });
    const elsewhere = (await seedWorkspace(db(), "Other")).workspaceId;
    const to = await seedTrack(db(), elsewhere, { title: "To" });

    const created = await repository.createTransition(
      workspaceId,
      { fromTrackId: from, toTrackId: to, technique: "blend", tags: [] },
      null,
    );

    expect(created).toBeNull();
  });

  it("treats the two directions as different transitions", async () => {
    // §7.2: A→B is not automatically valid as B→A — the pitch adjustment and
    // energy delta both invert — so the unique constraint must not collapse
    // them.
    const repository = new GraphRepository(db());
    const a = await seedTrack(db(), workspaceId, { title: "A" });
    const b = await seedTrack(db(), workspaceId, { title: "B" });

    await repository.createTransition(
      workspaceId,
      { fromTrackId: a, toTrackId: b, technique: "blend", tags: [] },
      null,
    );
    const reverse = await repository.createTransition(
      workspaceId,
      { fromTrackId: b, toTrackId: a, technique: "blend", tags: [] },
      null,
    );

    expect(reverse).not.toBeNull();
    expect(await repository.listTransitions(workspaceId)).toHaveLength(2);
  });

  it("removes a graph's nodes with it, and leaves the tracks and transitions alone", async () => {
    const repository = new GraphRepository(db());
    const graph = await repository.createGraph(workspaceId, { name: "G" });
    const a = await seedTrack(db(), workspaceId, { title: "A" });
    const b = await seedTrack(db(), workspaceId, { title: "B" });
    await repository.addNode(workspaceId, graph.id, { trackId: a, x: 0, y: 0 });
    await repository.createTransition(
      workspaceId,
      { fromTrackId: a, toTrackId: b, technique: "blend", tags: [] },
      null,
    );

    await db().graph.delete({ where: { id: graph.id } });

    expect(await db().graphNode.count()).toBe(0);
    // Transitions are workspace-level and reusable across graphs (§7.1), so a
    // deleted canvas must not take them with it.
    expect(await repository.listTransitions(workspaceId)).toHaveLength(1);
    expect(await db().track.count({ where: { workspaceId } })).toBe(2);
  });
  /**
   * Refinement — plan §8.3, §10.1.
   *
   * The awkward half is that technique is part of the uniqueness key, so a
   * technique change is a constraint operation dressed up as a field edit.
   * Only a real database settles what happens at that boundary: a mocked
   * Prisma would report whatever collision behaviour the mock was told to.
   */
  describe("refining a transition", () => {
    async function seedPair() {
      const repository = new GraphRepository(db());
      const a = await seedTrack(db(), workspaceId, { title: "A" });
      const b = await seedTrack(db(), workspaceId, { title: "B" });
      const transition = await repository.createTransition(
        workspaceId,
        { fromTrackId: a, toTrackId: b, technique: "blend", tags: [] },
        { value: 0.8, algorithmVersion: 1 },
      );
      return { repository, a, b, transition: transition! };
    }

    it("changes only the fields the patch names", async () => {
      const { repository, transition } = await seedPair();

      const updated = await repository.updateTransition(workspaceId, transition.id, {
        bars: 32,
      });

      expect(updated).not.toBe("not-found");
      expect(updated).not.toBe("technique-taken");
      const row = updated as Exclude<typeof updated, string>;
      expect(row.bars).toBe(32);
      // Untouched, because the patch did not mention them.
      expect(row.technique).toBe("blend");
      expect(row.notes).toBeNull();
    });

    it("distinguishes clearing a field from leaving it alone", async () => {
      const { repository, transition } = await seedPair();
      await repository.updateTransition(workspaceId, transition.id, {
        bars: 16,
        notes: "ride the low end",
      });

      // An explicit null clears; an absent key does not.
      const cleared = (await repository.updateTransition(workspaceId, transition.id, {
        bars: null,
      })) as Exclude<Awaited<ReturnType<GraphRepository["updateTransition"]>>, string>;

      expect(cleared.bars).toBeNull();
      expect(cleared.notes).toBe("ride the low end");
    });

    it("leaves the score snapshot alone when the technique changes", async () => {
      const { repository, transition } = await seedPair();

      const updated = (await repository.updateTransition(workspaceId, transition.id, {
        technique: "cut",
      })) as Exclude<Awaited<ReturnType<GraphRepository["updateTransition"]>>, string>;

      expect(updated.technique).toBe("cut");
      // §10.2: the score is a snapshot with the algorithm version that made
      // it. Technique is not an input to `scoreTransition`, so re-deriving it
      // here would restate a claim nobody asked to have restated.
      expect(Number(updated.score)).toBe(0.8);
      expect(updated.scoreAlgorithm).toBe(1);
    });

    it("refuses a technique another live transition on the pair already uses", async () => {
      const { repository, a, b, transition } = await seedPair();
      // A second, parallel route between the same two tracks. Legal: technique
      // is part of the uniqueness key.
      await repository.createTransition(
        workspaceId,
        { fromTrackId: a, toTrackId: b, technique: "cut", tags: [] },
        null,
      );

      expect(await repository.updateTransition(workspaceId, transition.id, { technique: "cut" }))
        .toBe("technique-taken");

      // And the refused edit changed nothing.
      const row = await db().transition.findUnique({ where: { id: transition.id } });
      expect(row?.technique).toBe("blend");
      expect(await repository.listTransitions(workspaceId)).toHaveLength(2);
    });

    it("allows a technique a soft-deleted transition was holding", async () => {
      const { repository, a, b, transition } = await seedPair();
      const stale = await repository.createTransition(
        workspaceId,
        { fromTrackId: a, toTrackId: b, technique: "cut", tags: [] },
        null,
      );
      await repository.deleteTransition(workspaceId, stale!.id);

      // Nothing on the canvas corresponds to the deleted row, so refusing here
      // would block an edit for a reason the user cannot see or act on.
      const updated = await repository.updateTransition(workspaceId, transition.id, {
        technique: "cut",
      });

      expect(updated).not.toBe("technique-taken");
      expect((updated as Exclude<typeof updated, string>).technique).toBe("cut");
      expect(await repository.listTransitions(workspaceId)).toHaveLength(1);
    });

    it("accepts a no-op technique that matches what is already stored", async () => {
      const { repository, transition } = await seedPair();

      // Same value, so there is no collision to detect — the row would
      // otherwise find *itself* holding the slot and refuse.
      const updated = await repository.updateTransition(workspaceId, transition.id, {
        technique: "blend",
        notes: "unchanged technique, new note",
      });

      expect(updated).not.toBe("technique-taken");
      expect((updated as Exclude<typeof updated, string>).notes).toBe(
        "unchanged technique, new note",
      );
    });

    it("will not update a transition in another workspace", async () => {
      const { repository, transition } = await seedPair();
      const other = await seedWorkspace(db());

      expect(
        await repository.updateTransition(other.workspaceId, transition.id, { bars: 8 }),
      ).toBe("not-found");

      const row = await db().transition.findUnique({ where: { id: transition.id } });
      expect(row?.bars).toBeNull();
    });

    it("will not update a soft-deleted transition", async () => {
      const { repository, transition } = await seedPair();
      await repository.deleteTransition(workspaceId, transition.id);

      expect(await repository.updateTransition(workspaceId, transition.id, { bars: 8 })).toBe(
        "not-found",
      );
    });
  });
});
