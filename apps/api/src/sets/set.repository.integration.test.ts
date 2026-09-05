import { describe, expect, it, beforeEach } from "vitest";
import { initialRanks, rankBetween, rankForMove } from "@flowgraph/domain";

import { useDatabase, seedTrack, seedWorkspace } from "../testing/harness.js";
import { SetRepository } from "./set.repository.js";

/**
 * Ordering, against the database that actually does the ordering.
 *
 * `rank.ts` claims that its `a`–`z` alphabet sorts identically under
 * JavaScript's `<` and under Postgres's `ORDER BY`. That claim is the whole
 * reason the client can trust the order it is sent, and until now it was a
 * comment. The unit tests sort in JavaScript, so they cannot see a collation
 * that disagrees.
 *
 * These also check the constraints the *migration* produced rather than the
 * ones `schema.prisma` declares — a unique index that never reached a
 * migration passes a pushed schema and fails in production.
 */
describe("set ordering", () => {
  const db = useDatabase();

  let workspaceId: string;
  let setId: string;

  beforeEach(async () => {
    workspaceId = (await seedWorkspace(db())).workspaceId;
    const set = await new SetRepository(db()).createSet(workspaceId, { name: "Set" });
    setId = set.id;
  });

  /** Appends a track and returns the item id. */
  async function append(repository: SetRepository, title: string): Promise<string> {
    const trackId = await seedTrack(db(), workspaceId, { title });
    const item = await repository.addItem(workspaceId, setId, { trackId }, (ranks) =>
      rankBetween(ranks.at(-1) ?? null, null),
    );
    expect(item).not.toBeNull();
    return item!.id;
  }

  const titles = async (repository: SetRepository): Promise<string[]> =>
    (await repository.listItems(workspaceId, setId)).map((item) => item.track.title);

  it("returns items in the order Postgres sorts the ranks", async () => {
    const repository = new SetRepository(db());
    for (const title of ["A", "B", "C", "D"]) await append(repository, title);

    expect(await titles(repository)).toEqual(["A", "B", "C", "D"]);
  });

  it("sorts the same way Postgres and JavaScript each would, for ranks of differing length", async () => {
    // The case a collation mismatch would break: "b" vs "ban" vs "bn" only
    // agree between the two if the alphabet stays lowercase ASCII.
    const repository = new SetRepository(db());
    const ranks = ["b", "ban", "bn", "bzzz", "c", "n", "zzz", "zzzn"];

    for (const [index, rank] of ranks.entries()) {
      const trackId = await seedTrack(db(), workspaceId, { title: `t${index}` });
      await repository.addItem(workspaceId, setId, { trackId }, () => rank);
    }

    const fromPostgres = (await repository.listItems(workspaceId, setId)).map(
      (item) => item.rank,
    );
    expect(fromPostgres).toEqual([...ranks].sort());
  });

  it("refuses two items at the same rank", async () => {
    // `@@unique([setId, rank])`. Without it two items tie and the order
    // becomes whatever the planner returns.
    const repository = new SetRepository(db());
    const first = await seedTrack(db(), workspaceId, { title: "First" });
    const second = await seedTrack(db(), workspaceId, { title: "Second" });

    await repository.addItem(workspaceId, setId, { trackId: first }, () => "n");
    await expect(
      repository.addItem(workspaceId, setId, { trackId: second }, () => "n"),
    ).rejects.toThrow();
  });

  it("allows the same rank in two different sets", async () => {
    const repository = new SetRepository(db());
    const other = await repository.createSet(workspaceId, { name: "Other" });
    const trackId = await seedTrack(db(), workspaceId, { title: "Shared" });

    await repository.addItem(workspaceId, setId, { trackId }, () => "n");
    const inOther = await repository.addItem(workspaceId, other.id, { trackId }, () => "n");

    expect(inOther).not.toBeNull();
  });

  it("moves an item by rewriting exactly one row", async () => {
    // The entire point of fractional ranks (§7.4). If the tail were
    // renumbered, this assertion would fail and the write amplification the
    // scheme exists to avoid would be back.
    const repository = new SetRepository(db());
    for (const title of ["A", "B", "C", "D"]) await append(repository, title);

    const before = await repository.listItems(workspaceId, setId);
    const moved = before.at(-1)!;

    await repository.moveItem(workspaceId, setId, moved.id, (ranks, from) =>
      rankForMove(ranks, from, 1),
    );

    const after = await repository.listItems(workspaceId, setId);
    expect(after.map((item) => item.track.title)).toEqual(["A", "D", "B", "C"]);

    const unchanged = before
      .filter((item) => item.id !== moved.id)
      .every((item) => after.find((entry) => entry.id === item.id)?.rank === item.rank);
    expect(unchanged).toBe(true);
  });

  it("keeps every item exactly once through a long run of moves", async () => {
    // Plan §21.3's first named property, checked end to end rather than in
    // memory: the ranks are computed by the domain, written by Prisma, and
    // read back in whatever order Postgres decides.
    const repository = new SetRepository(db());
    for (const title of ["A", "B", "C", "D", "E"]) await append(repository, title);

    let random = 4242;
    const next = (bound: number) => {
      random = (random * 1103515245 + 12345) & 0x7fffffff;
      return random % bound;
    };

    for (let step = 0; step < 25; step += 1) {
      const items = await repository.listItems(workspaceId, setId);
      const from = next(items.length);
      const to = next(items.length);
      await repository.moveItem(workspaceId, setId, items[from]!.id, (ranks, index) =>
        rankForMove(ranks, index, to),
      );

      const after = await repository.listItems(workspaceId, setId);
      expect(after).toHaveLength(5);
      expect(new Set(after.map((item) => item.track.title)).size).toBe(5);
    }
  });

  it("lets a set hold the same track twice", async () => {
    // §10.4 calls these occurrences. A unique constraint on (setId, trackId)
    // would have made this throw.
    const repository = new SetRepository(db());
    const trackId = await seedTrack(db(), workspaceId, { title: "Encore" });

    for (const rank of initialRanks(2)) {
      const item = await repository.addItem(workspaceId, setId, { trackId }, () => rank);
      expect(item).not.toBeNull();
    }

    expect(await repository.listItems(workspaceId, setId)).toHaveLength(2);
  });

  it("removes a set's items with it, and leaves the tracks alone", async () => {
    const repository = new SetRepository(db());
    await append(repository, "A");

    await repository.deleteSet(workspaceId, setId);

    expect(await db().setItem.count()).toBe(0);
    // Cascade reaches the join, not the library.
    expect(await db().track.count({ where: { workspaceId } })).toBe(1);
  });

  it("bumps the set version on every item change", async () => {
    // The client's concurrency token. A mutation that left it alone would let
    // a stale client believe it was current.
    const repository = new SetRepository(db());
    const created = await repository.findSet(workspaceId, setId);
    const itemId = await append(repository, "A");

    const afterAdd = await repository.findSet(workspaceId, setId);
    expect(afterAdd!.version).toBeGreaterThan(created!.version);

    await repository.moveItem(workspaceId, setId, itemId, (ranks, from) =>
      rankForMove(ranks, from, 0),
    );
    const afterMove = await repository.findSet(workspaceId, setId);
    expect(afterMove!.version).toBeGreaterThan(afterAdd!.version);

    await repository.removeItem(workspaceId, setId, itemId);
    const afterRemove = await repository.findSet(workspaceId, setId);
    expect(afterRemove!.version).toBeGreaterThan(afterMove!.version);
  });
});
