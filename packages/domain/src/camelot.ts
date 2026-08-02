/**
 * Camelot wheel and harmonic mixing — plan §10.3.
 *
 * The Camelot system maps every key to a number 1–12 and a letter (A = minor,
 * B = major), arranged so that harmonically compatible keys are neighbours.
 * Two keys mix well when they are the same, adjacent on the wheel, or relative
 * major/minor of each other.
 *
 * Pure functions, no I/O, no framework. This is the product's core
 * intelligence and it lives in the most testable layer available.
 */

export type CamelotMode = "A" | "B";

export interface CamelotKey {
  /** Position on the wheel, 1–12. */
  readonly number: number;
  /** A = minor, B = major. */
  readonly mode: CamelotMode;
}

/** How two keys relate on the wheel. Ordered from most to least consonant. */
export type HarmonicRelation =
  | "identical"
  | "adjacent"
  | "relative"
  | "diagonal"
  | "energy-boost"
  | "distant";

const CAMELOT_PATTERN = /^(?<number>[1-9]|1[0-2])(?<mode>[AB])$/;

/**
 * Standard notation to Camelot.
 *
 * Imported metadata rarely arrives as Camelot — Serato and Spotify report
 * musical keys — so parsing both forms is a practical requirement, not a
 * convenience. Enharmonic spellings map to the same wheel position.
 */
const MUSICAL_TO_CAMELOT: Readonly<Record<string, string>> = {
  // Minor keys → A
  "abm": "1A", "g#m": "1A",
  "ebm": "2A", "d#m": "2A",
  "bbm": "3A", "a#m": "3A",
  "fm": "4A",
  "cm": "5A",
  "gm": "6A",
  "dm": "7A",
  "am": "8A",
  "em": "9A",
  "bm": "10A",
  "f#m": "11A", "gbm": "11A",
  "dbm": "12A", "c#m": "12A",
  // Major keys → B
  "b": "1B",
  "f#": "2B", "gb": "2B",
  "db": "3B", "c#": "3B",
  "ab": "4B", "g#": "4B",
  "eb": "5B", "d#": "5B",
  "bb": "6B", "a#": "6B",
  "f": "7B",
  "c": "8B",
  "g": "9B",
  "d": "10B",
  "a": "11B",
  "e": "12B",
};

/**
 * Parses Camelot ("8A") or standard notation ("Am", "C#m", "F") into a key.
 * Returns null rather than throwing — imported metadata is untrusted and a
 * missing key is a normal state, not an error.
 */
export function parseKey(input: string | null | undefined): CamelotKey | null {
  if (!input) return null;

  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const camelot = CAMELOT_PATTERN.exec(trimmed.toUpperCase());
  if (camelot?.groups) {
    return {
      number: Number(camelot.groups.number),
      mode: camelot.groups.mode as CamelotMode,
    };
  }

  const normalized = trimmed.toLowerCase().replace(/\s+/g, "").replace(/(minor|min)$/, "m").replace(/(major|maj)$/, "");
  const mapped = MUSICAL_TO_CAMELOT[normalized];
  if (!mapped) return null;

  const parsed = CAMELOT_PATTERN.exec(mapped);
  if (!parsed?.groups) return null;

  return {
    number: Number(parsed.groups.number),
    mode: parsed.groups.mode as CamelotMode,
  };
}

export function formatKey(key: CamelotKey): string {
  return `${key.number}${key.mode}`;
}

/**
 * Shortest distance around the 12-position wheel, 0–6.
 *
 * The wheel is circular, so 12 and 1 are adjacent — a plain subtraction would
 * report 11 and wrongly rank a perfectly consonant move as the worst possible.
 */
export function wheelDistance(a: number, b: number): number {
  const forward = (a - b + 12) % 12;
  const backward = (b - a + 12) % 12;
  return Math.min(forward, backward);
}

export function harmonicRelation(from: CamelotKey, to: CamelotKey): HarmonicRelation {
  const distance = wheelDistance(from.number, to.number);
  const sameMode = from.mode === to.mode;

  if (distance === 0 && sameMode) return "identical";
  if (distance === 0) return "relative";
  if (distance === 1 && sameMode) return "adjacent";
  if (distance === 1) return "diagonal";
  // +7 on the wheel is a one-semitone lift: the classic energy-boost move.
  if (sameMode && (to.number - from.number + 12) % 12 === 7) return "energy-boost";
  return "distant";
}

const RELATION_SCORES: Readonly<Record<HarmonicRelation, number>> = {
  identical: 1,
  adjacent: 0.9,
  relative: 0.85,
  diagonal: 0.6,
  "energy-boost": 0.55,
  distant: 0,
};

/**
 * Harmonic compatibility in [0, 1].
 *
 * `distant` decays with wheel distance rather than collapsing to zero: a
 * two-step move is a rough but usable transition, while the opposite side of
 * the wheel is genuinely dissonant. Returning a gradient lets callers rank
 * imperfect options instead of discarding them all equally.
 */
export function harmonicScore(from: CamelotKey, to: CamelotKey): number {
  const relation = harmonicRelation(from, to);

  if (relation !== "distant") {
    return RELATION_SCORES[relation];
  }

  const distance = wheelDistance(from.number, to.number);
  const modePenalty = from.mode === to.mode ? 0 : 0.1;
  return Math.max(0, 0.5 - (distance - 1) * 0.1 - modePenalty);
}

/** Keys that mix cleanly from `key` — the standard harmonic mixing moves. */
export function compatibleKeys(key: CamelotKey): CamelotKey[] {
  const up = (key.number % 12) + 1;
  const down = ((key.number + 10) % 12) + 1;
  const otherMode: CamelotMode = key.mode === "A" ? "B" : "A";

  return [
    { number: key.number, mode: key.mode },
    { number: up, mode: key.mode },
    { number: down, mode: key.mode },
    { number: key.number, mode: otherMode },
  ];
}
