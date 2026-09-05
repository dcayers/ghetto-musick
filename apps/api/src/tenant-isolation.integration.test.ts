import { describe, expect, it, beforeEach } from "vitest";
import { rankBetween, rankForMove } from "@flowgraph/domain";

import { useDatabase, seedTrack, seedWorkspace } from "./testing/harness.js";
import { GraphRepository } from "./graphs/graph.repository.js";
import { SetRepository } from "./sets/set.repository.js";
import { TrackRepository } from "./tracks/track.repository.js";

/**
 * Plan §21.3: "Unauthorized workspace IDs never change query results or
 * mutation targets." §26 lists "workspace isolation tests pass" as a platform
 * acceptance criterion.
 *
 * Until now the discipline was tested but the queries were not. `WorkspaceContextService`
 * has unit tests proving a client-supplied workspace header is ignored, and every
 * repository method takes `workspaceId` positionally so it cannot be forgotten —
 * but nothing checked that the argument actually reaches the `WHERE` clause. A
 * method that accepted `workspaceId` and then queried by id alone would have
 * passed every test in the suite.
 *
 * So each case below runs the real query against real Postgres with the *wrong*
 * workspace id and asserts two things: nothing is returned, and nothing is
 * changed. The second matters more. A read that leaks is a disclosure bug; a
 * write that lands in another tenant's data is corruption.
 */
describe("tenant isolation", () => {
  const db = useDatabase();

  let mine: string;
  let theirs: string;

  beforeEach(async () => {
    mine = (await seedWorkspace(db(), "Mine")).workspaceId;
    theirs = (await seedWorkspace(db(), "Theirs")).workspaceId;
  });

  describe("tracks", () => {
    it("does not read another workspace's track by id", async () => {
      const repository = new TrackRepository(db());
      const trackId = await seedTrack(db(), mine, { title: "Private" });

      expect(await repository.findById(theirs, trackId)).toBeNull();
      // And the owner still sees it, so the null above is scoping rather than
      // a seed that never landed.
      expect(await repository.findById(mine, trackId)).not.toBeNull();
    });

    it("does not list or count another workspace's tracks", async () => {
      const repository = new TrackRepository(db());
      await seedTrack(db(), mine, { title: "Private" });

      const page = await repository.list(theirs, { limit: 50 });
      expect(page.items).toHaveLength(0);
      expect(await repository.countForWorkspace(theirs)).toBe(0);
      expect(await repository.countForWorkspace(mine)).toBe(1);
    });
  });

  describe("graphs", () => {
    it("does not read another workspace's graph or its nodes", async () => {
      const repository = new GraphRepository(db());
      const graph = await repository.createGraph(mine, { name: "Private" });
      const trackId = await seedTrack(db(), mine);
      await repository.addNode(mine, graph.id, { trackId, x: 0, y: 0 });

      expect(await repository.findGraph(theirs, graph.id)).toBeNull();
      expect(await repository.listGraphs(theirs)).toHaveLength(0);
      // Scoped through the graph's workspace, not just by graphId — the case
      // the repository's own comment calls out.
      expect(await repository.listNodes(theirs, graph.id)).toHaveLength(0);
      expect(await repository.listNodes(mine, graph.id)).toHaveLength(1);
    });

    it("does not place a node on another workspace's graph", async () => {
      const repository = new GraphRepository(db());
      const graph = await repository.createGraph(mine, { name: "Private" });
      const intruderTrack = await seedTrack(db(), theirs, { title: "Theirs" });

      await repository
        .addNode(theirs, graph.id, { trackId: intruderTrack, x: 10, y: 10 })
        .catch(() => null);

      expect(await repository.listNodes(mine, graph.id)).toHaveLength(0);
    });

    it("does not remove a node from another workspace's graph", async () => {
      const repository = new GraphRepository(db());
      const graph = await repository.createGraph(mine, { name: "Private" });
      const trackId = await seedTrack(db(), mine);
      const node = await repository.addNode(mine, graph.id, { trackId, x: 0, y: 0 });
      expect(node).not.toBeNull();

      expect(await repository.removeNode(theirs, graph.id, node!.id)).toBe(false);
      expect(await repository.listNodes(mine, graph.id)).toHaveLength(1);
    });

    it("does not move nodes on another workspace's graph", async () => {
      const repository = new GraphRepository(db());
      const graph = await repository.createGraph(mine, { name: "Private" });
      const trackId = await seedTrack(db(), mine);
      const node = await repository.addNode(mine, graph.id, { trackId, x: 5, y: 7 });
      expect(node).not.toBeNull();

      const result = await repository.updateLayout(theirs, graph.id, {
        expectedVersion: graph.version,
        positions: [{ id: node!.id, x: 999, y: 999 }],
      });

      expect(result).toBeNull();
      const [after] = await repository.listNodes(mine, graph.id);
      expect({ x: after?.x, y: after?.y }).toEqual({ x: 5, y: 7 });
    });

    it("does not read or delete another workspace's transition", async () => {
      const repository = new GraphRepository(db());
      const from = await seedTrack(db(), mine, { title: "From" });
      const to = await seedTrack(db(), mine, { title: "To" });
      const transition = await repository.createTransition(
        mine,
        { fromTrackId: from, toTrackId: to, technique: "blend", tags: [] },
        null,
      );

      expect(transition).not.toBeNull();
      expect(await repository.listTransitions(theirs)).toHaveLength(0);
      expect(await repository.deleteTransition(theirs, transition!.id)).toBe(false);
      expect(await repository.listTransitions(mine)).toHaveLength(1);
    });

    it("does not offer another workspace's tracks as scoring candidates", async () => {
      // A leak here would be quiet and specific: suggestions naming tracks the
      // caller has never seen.
      const repository = new GraphRepository(db());
      await seedTrack(db(), mine, { title: "Private" });

      expect(await repository.listTracksForScoring(theirs)).toHaveLength(0);
    });
  });

  describe("sets", () => {
    it("does not read another workspace's set or its items", async () => {
      const repository = new SetRepository(db());
      const set = await repository.createSet(mine, { name: "Private" });
      const trackId = await seedTrack(db(), mine);
      await repository.addItem(mine, set.id, { trackId }, () => rankBetween(null, null));

      expect(await repository.findSet(theirs, set.id)).toBeNull();
      expect(await repository.listSets(theirs)).toHaveLength(0);
      expect(await repository.listItems(theirs, set.id)).toHaveLength(0);
      expect(await repository.listItems(mine, set.id)).toHaveLength(1);
    });

    it("does not rename another workspace's set", async () => {
      const repository = new SetRepository(db());
      const set = await repository.createSet(mine, { name: "Private" });

      expect(await repository.updateSet(theirs, set.id, { name: "Hijacked" })).toBeNull();
      expect((await repository.findSet(mine, set.id))?.name).toBe("Private");
    });

    it("does not delete another workspace's set", async () => {
      const repository = new SetRepository(db());
      const set = await repository.createSet(mine, { name: "Private" });

      expect(await repository.deleteSet(theirs, set.id)).toBe(false);
      expect(await repository.findSet(mine, set.id)).not.toBeNull();
    });

    it("does not add an item to another workspace's set", async () => {
      const repository = new SetRepository(db());
      const set = await repository.createSet(mine, { name: "Private" });
      const intruderTrack = await seedTrack(db(), theirs);

      const added = await repository.addItem(
        theirs,
        set.id,
        { trackId: intruderTrack },
        () => rankBetween(null, null),
      );

      expect(added).toBeNull();
      expect(await repository.listItems(mine, set.id)).toHaveLength(0);
    });

    it("does not remove or reorder another workspace's set items", async () => {
      const repository = new SetRepository(db());
      const set = await repository.createSet(mine, { name: "Private" });
      const first = await seedTrack(db(), mine, { title: "First" });
      const second = await seedTrack(db(), mine, { title: "Second" });
      await repository.addItem(mine, set.id, { trackId: first }, (r) =>
        rankBetween(r.at(-1) ?? null, null),
      );
      const item = await repository.addItem(mine, set.id, { trackId: second }, (r) =>
        rankBetween(r.at(-1) ?? null, null),
      );

      expect(await repository.removeItem(theirs, set.id, item!.id)).toBe(false);
      expect(
        await repository.moveItem(theirs, set.id, item!.id, (r, from) => rankForMove(r, from, 0)),
      ).toBeNull();

      const items = await repository.listItems(mine, set.id);
      expect(items.map((entry) => entry.track.title)).toEqual(["First", "Second"]);
    });

    it("does not confirm another workspace's track exists", async () => {
      // `trackExists` gates adding to a set. A true here would let one
      // workspace plan a set around a track it cannot see.
      const repository = new SetRepository(db());
      const trackId = await seedTrack(db(), mine);

      expect(await repository.trackExists(theirs, trackId)).toBe(false);
      expect(await repository.trackExists(mine, trackId)).toBe(true);
    });
  });
});
