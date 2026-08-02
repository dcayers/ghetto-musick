import { describe, it, expect } from "vitest";
import {
  parseKey,
  formatKey,
  wheelDistance,
  harmonicRelation,
  harmonicScore,
  compatibleKeys,
} from "./camelot.js";

describe("parseKey", () => {
  it("parses Camelot notation", () => {
    expect(parseKey("8A")).toEqual({ number: 8, mode: "A" });
    expect(parseKey("12B")).toEqual({ number: 12, mode: "B" });
    expect(parseKey("1a")).toEqual({ number: 1, mode: "A" });
    expect(parseKey("  10B  ")).toEqual({ number: 10, mode: "B" });
  });

  it("maps standard minor keys to the A ring", () => {
    expect(formatKey(parseKey("Am")!)).toBe("8A");
    expect(formatKey(parseKey("Em")!)).toBe("9A");
    expect(formatKey(parseKey("F#m")!)).toBe("11A");
    expect(formatKey(parseKey("Bbm")!)).toBe("3A");
  });

  it("maps standard major keys to the B ring", () => {
    expect(formatKey(parseKey("C")!)).toBe("8B");
    expect(formatKey(parseKey("G")!)).toBe("9B");
    expect(formatKey(parseKey("E")!)).toBe("12B");
  });

  it("treats enharmonic spellings as the same position", () => {
    expect(parseKey("F#m")).toEqual(parseKey("Gbm"));
    expect(parseKey("C#")).toEqual(parseKey("Db"));
    expect(parseKey("A#m")).toEqual(parseKey("Bbm"));
  });

  it("accepts spelled-out and abbreviated modes", () => {
    expect(formatKey(parseKey("A minor")!)).toBe("8A");
    expect(formatKey(parseKey("C major")!)).toBe("8B");
    expect(formatKey(parseKey("Bmin")!)).toBe("10A");
  });

  it("returns null for absent or unrecognised input rather than throwing", () => {
    // Imported metadata is untrusted, and a missing key is a normal state.
    expect(parseKey(null)).toBeNull();
    expect(parseKey(undefined)).toBeNull();
    expect(parseKey("")).toBeNull();
    expect(parseKey("   ")).toBeNull();
    expect(parseKey("13A")).toBeNull();
    expect(parseKey("0A")).toBeNull();
    expect(parseKey("8C")).toBeNull();
    expect(parseKey("not a key")).toBeNull();
  });
});

describe("wheelDistance", () => {
  it("measures the shorter way around the circle", () => {
    expect(wheelDistance(8, 8)).toBe(0);
    expect(wheelDistance(8, 9)).toBe(1);
    expect(wheelDistance(8, 2)).toBe(6);
  });

  it("wraps between 12 and 1", () => {
    // The whole point of a wheel: a plain subtraction would report 11 here
    // and rank a perfectly consonant move as the worst possible.
    expect(wheelDistance(12, 1)).toBe(1);
    expect(wheelDistance(1, 12)).toBe(1);
    expect(wheelDistance(11, 2)).toBe(3);
  });

  it("is symmetric", () => {
    for (let a = 1; a <= 12; a += 1) {
      for (let b = 1; b <= 12; b += 1) {
        expect(wheelDistance(a, b)).toBe(wheelDistance(b, a));
      }
    }
  });
});

describe("harmonicRelation", () => {
  const key = (value: string) => parseKey(value)!;

  it("identifies the same key", () => {
    expect(harmonicRelation(key("8A"), key("8A"))).toBe("identical");
  });

  it("identifies adjacent keys, including across the wrap", () => {
    expect(harmonicRelation(key("8A"), key("9A"))).toBe("adjacent");
    expect(harmonicRelation(key("8A"), key("7A"))).toBe("adjacent");
    expect(harmonicRelation(key("12A"), key("1A"))).toBe("adjacent");
  });

  it("identifies relative major/minor", () => {
    // 8A is A minor and 8B is C major — genuinely relative.
    expect(harmonicRelation(key("8A"), key("8B"))).toBe("relative");
    expect(harmonicRelation(key("9B"), key("9A"))).toBe("relative");
  });

  it("identifies diagonal moves", () => {
    expect(harmonicRelation(key("8A"), key("9B"))).toBe("diagonal");
  });

  it("identifies the +7 energy boost", () => {
    // Seven steps up the wheel is a one-semitone lift.
    expect(harmonicRelation(key("8A"), key("3A"))).toBe("energy-boost");
    expect(harmonicRelation(key("1A"), key("8A"))).toBe("energy-boost");
  });

  it("treats everything else as distant", () => {
    expect(harmonicRelation(key("8A"), key("11A"))).toBe("distant");
    expect(harmonicRelation(key("8A"), key("2B"))).toBe("distant");
  });

  it("is not symmetric for the energy boost", () => {
    // +7 and -7 are different moves: one lifts, one drops.
    expect(harmonicRelation(key("8A"), key("3A"))).toBe("energy-boost");
    expect(harmonicRelation(key("3A"), key("8A"))).toBe("distant");
  });
});

describe("harmonicScore", () => {
  const key = (value: string) => parseKey(value)!;

  it("ranks the standard mixing moves above everything else", () => {
    const identical = harmonicScore(key("8A"), key("8A"));
    const adjacent = harmonicScore(key("8A"), key("9A"));
    const relative = harmonicScore(key("8A"), key("8B"));
    const distant = harmonicScore(key("8A"), key("2A"));

    expect(identical).toBe(1);
    expect(identical).toBeGreaterThan(adjacent);
    expect(adjacent).toBeGreaterThan(relative);
    expect(relative).toBeGreaterThan(distant);
  });

  it("decays with distance instead of collapsing to zero", () => {
    // A gradient lets callers rank imperfect options rather than discarding
    // them all equally.
    const two = harmonicScore(key("8A"), key("10A"));
    const three = harmonicScore(key("8A"), key("11A"));
    expect(two).toBeGreaterThan(three);
    expect(three).toBeGreaterThan(0);
  });

  it("always returns a value in [0, 1]", () => {
    for (let a = 1; a <= 12; a += 1) {
      for (const modeA of ["A", "B"] as const) {
        for (let b = 1; b <= 12; b += 1) {
          for (const modeB of ["A", "B"] as const) {
            const score = harmonicScore({ number: a, mode: modeA }, { number: b, mode: modeB });
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});

describe("compatibleKeys", () => {
  it("returns the four standard moves from a key", () => {
    const result = compatibleKeys(parseKey("8A")!).map(formatKey);
    expect(result).toEqual(["8A", "9A", "7A", "8B"]);
  });

  it("wraps correctly at both ends of the wheel", () => {
    expect(compatibleKeys(parseKey("12A")!).map(formatKey)).toEqual(["12A", "1A", "11A", "12B"]);
    expect(compatibleKeys(parseKey("1B")!).map(formatKey)).toEqual(["1B", "2B", "12B", "1A"]);
  });

  it("only produces keys that score as non-distant", () => {
    for (let number = 1; number <= 12; number += 1) {
      for (const mode of ["A", "B"] as const) {
        const from = { number, mode };
        for (const to of compatibleKeys(from)) {
          expect(harmonicRelation(from, to)).not.toBe("distant");
        }
      }
    }
  });
});
