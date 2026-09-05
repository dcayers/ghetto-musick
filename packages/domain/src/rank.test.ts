import { describe, expect, it } from "vitest";

import {
  InvalidRankError,
  RankOrderError,
  initialRanks,
  rankBetween,
  rankForMove,
} from "./rank.js";

/**
 * The invariant every test here is really checking.
 *
 * A rank is only useful if lexicographic comparison agrees with intended
 * order, so "strictly between" is asserted directly rather than inferred from
 * a produced value looking reasonable.
 */
function isBetween(before: string | null, value: string, after: string | null): boolean {
  return (before === null || before < value) && (after === null || value < after);
}

describe("rankBetween", () => {
  it("gives an empty list a rank in the middle of the alphabet", () => {
    // Room to insert on both sides without immediately lengthening.
    const only = rankBetween(null, null);

    expect(only).toBe("n");
  });

  it("appends after a last item", () => {
    expect(isBetween("n", rankBetween("n", null), null)).toBe(true);
  });

  it("prepends before a first item", () => {
    expect(isBetween(null, rankBetween(null, "n"), "n")).toBe(true);
  });

  it("splits two ranks that have room between them", () => {
    const middle = rankBetween("b", "d");

    expect(middle).toBe("c");
    expect(isBetween("b", middle, "d")).toBe(true);
  });

  it("lengthens rather than failing when neighbours are adjacent", () => {
    // Nothing sorts between "b" and "c" at one character, so the answer has to
    // grow. This is the case integer positions cannot express at all.
    const middle = rankBetween("b", "c");

    expect(middle.length).toBeGreaterThan(1);
    expect(isBetween("b", middle, "c")).toBe(true);
  });

  it("splits a prefix pair, where one rank is the start of the other", () => {
    const middle = rankBetween("b", "bb");

    expect(isBetween("b", middle, "bb")).toBe(true);
  });

  it("handles a run of trailing z", () => {
    const middle = rankBetween("bzzz", "c");

    expect(isBetween("bzzz", middle, "c")).toBe(true);
  });

  it("appends past a rank that is all z", () => {
    expect(isBetween("zzz", rankBetween("zzz", null), null)).toBe(true);
  });

  it("rejects a pair given in the wrong order", () => {
    // Silently returning something would corrupt the list order rather than
    // fail the request that caused it.
    expect(() => rankBetween("c", "b")).toThrow(RankOrderError);
    expect(() => rankBetween("b", "b")).toThrow(RankOrderError);
  });

  it("rejects a rank outside the alphabet", () => {
    expect(() => rankBetween("a1", null)).toThrow(InvalidRankError);
    expect(() => rankBetween(null, "A")).toThrow(InvalidRankError);
    expect(() => rankBetween("", null)).toThrow(InvalidRankError);
  });

  it("rejects a rank ending in the reserved descent character", () => {
    // "a" is the runway every prepend descends into. A rank that ended there
    // would be unprependable, which is the failure this reservation exists to
    // prevent — so it is refused at the door rather than stored.
    expect(() => rankBetween("a", null)).toThrow(InvalidRankError);
    expect(() => rankBetween(null, "ba")).toThrow(InvalidRankError);
  });

  it("never produces a rank ending in the reserved character", () => {
    const produced = [
      rankBetween(null, null),
      rankBetween(null, "b"),
      rankBetween(null, "c"),
      rankBetween("b", "c"),
      rankBetween("b", "bn"),
      rankBetween("z", null),
      rankBetween("zzz", null),
      rankBetween("an", "b"),
    ];

    for (const rank of produced) expect(rank.endsWith("a")).toBe(false);
  });
});

describe("initialRanks", () => {
  it("produces the requested count in ascending order", () => {
    const ranks = initialRanks(6);

    expect(ranks).toHaveLength(6);
    expect([...ranks].sort()).toEqual(ranks);
  });

  it("produces no duplicates", () => {
    const ranks = initialRanks(40);

    expect(new Set(ranks).size).toBe(40);
  });

  it("returns nothing for an empty list", () => {
    expect(initialRanks(0)).toEqual([]);
  });
});

describe("rankForMove", () => {
  const ranks = initialRanks(5);

  it("moves an item forward to the requested position", () => {
    // Dragging item 0 to index 3 must land it between what will be its
    // neighbours *after* removal, which is the third and fourth of the rest.
    const moved = rankForMove(ranks, 0, 3);
    const remaining = ranks.filter((_, index) => index !== 0);

    expect(isBetween(remaining[2] ?? null, moved, remaining[3] ?? null)).toBe(true);
  });

  it("moves an item backward to the requested position", () => {
    const moved = rankForMove(ranks, 4, 1);
    const remaining = ranks.filter((_, index) => index !== 4);

    expect(isBetween(remaining[0] ?? null, moved, remaining[1] ?? null)).toBe(true);
  });

  it("moves to the front", () => {
    expect(isBetween(null, rankForMove(ranks, 2, 0), ranks[0] ?? null)).toBe(true);
  });

  it("moves to the end", () => {
    const moved = rankForMove(ranks, 0, 4);

    expect(isBetween(ranks[4] ?? null, moved, null)).toBe(true);
  });

  it("clamps a target index past the end rather than throwing", () => {
    expect(isBetween(ranks[4] ?? null, rankForMove(ranks, 0, 99), null)).toBe(true);
  });
});

describe("ordering survives repeated churn", () => {
  it("keeps a list sorted through 400 random insertions", () => {
    // The failure this guards against is subtle: a rank function can look
    // right on the cases someone thought to write down and still produce a
    // value equal to a neighbour after enough splitting, at which point two
    // rows tie and the order becomes whatever the database felt like.
    let random = 12345;
    const next = (bound: number) => {
      // Deterministic LCG — a flaky ordering test is worse than none.
      random = (random * 1103515245 + 12345) & 0x7fffffff;
      return random % bound;
    };

    const list: string[] = [];
    for (let step = 0; step < 400; step += 1) {
      const at = list.length === 0 ? 0 : next(list.length + 1);
      const rank = rankBetween(list[at - 1] ?? null, list[at] ?? null);
      list.splice(at, 0, rank);
    }

    expect(list).toHaveLength(400);
    expect(new Set(list).size).toBe(400);
    expect([...list].sort()).toEqual(list);
  });

  it("keeps a list sorted through 200 random moves", () => {
    let random = 999;
    const next = (bound: number) => {
      random = (random * 1103515245 + 12345) & 0x7fffffff;
      return random % bound;
    };

    let list = initialRanks(12);
    for (let step = 0; step < 200; step += 1) {
      const from = next(list.length);
      const to = next(list.length);
      const rank = rankForMove(list, from, to);

      const rest = list.filter((_, index) => index !== from);
      rest.splice(Math.min(rest.length, to), 0, rank);
      list = rest;

      expect([...list].sort()).toEqual(list);
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("does not grow ranks without bound when always inserting at the front", () => {
    // Prepending repeatedly is the adversarial case for this scheme. It is
    // allowed to lengthen, but linearly — if it doubled, a few hundred moves
    // would produce ranks too long for an index.
    let first = rankBetween(null, null);
    for (let step = 0; step < 200; step += 1) {
      first = rankBetween(null, first);
    }

    expect(first.length).toBeLessThan(220);
  });
});
