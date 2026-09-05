/**
 * Fractional ranks for ordered lists — plan §7.4.
 *
 * "Ordered set items use fractional/ranked strings, not renumbered integers."
 * The reason is write amplification and conflict surface: moving one track in
 * a fifty-track set with integer positions rewrites up to fifty rows, and two
 * clients reordering different parts of the same set collide on rows neither
 * of them touched. A rank string is computed strictly between its two new
 * neighbours, so a move writes exactly one row and two concurrent moves in
 * different regions of the list do not contend at all.
 *
 * Ranks are compared with ordinary lexicographic string comparison, and the
 * alphabet is deliberately lowercase `a`–`z` only, where every collation
 * Postgres might be running agrees with JavaScript's `<`. That equivalence is
 * the point: `ORDER BY rank` and a client-side sort produce the same order
 * without either side knowing the algorithm. Widening the alphabet to mixed
 * case or digits would break it, because collations disagree there.
 *
 * ## The invariant
 *
 * **No rank ends in `a`.** This is load-bearing rather than cosmetic. In an
 * `a`–`z` alphabet nothing sorts before `"a"` — every non-empty string starts
 * with a character at least `a`, and `"a"` is a prefix of every string that
 * begins with it — so a list whose first rank was `"a"` could never be
 * prepended to again. Reserving `a` as the descent character instead means
 * `prefix + "a" + …` is always available below `prefix + anything-else`, and
 * prepending can continue forever at a cost of about one character per four
 * insertions.
 *
 * A first, naive version of this module took the plain midpoint at every
 * position and hit both failures the tests below now cover: it emitted the
 * character *below* `a` when asked to prepend before `"a"`, and it ran out of
 * room after four front-insertions.
 */

const FIRST = "a";
const LAST = "z";
const FIRST_CODE = FIRST.charCodeAt(0);
const LAST_CODE = LAST.charCodeAt(0);
/** One below `a` — what an exhausted lower bound reads as. */
const BELOW_FIRST = FIRST_CODE - 1;
/** One above `z` — what an exhausted upper bound reads as. */
const ABOVE_LAST = LAST_CODE + 1;

/** The rank of a first, only item: mid-alphabet, so both sides have room. */
const MIDDLE = String.fromCharCode(Math.floor((FIRST_CODE + ABOVE_LAST) / 2));

const VALID_RANK = /^[a-z]*[b-z]$/;

export class InvalidRankError extends Error {
  constructor(label: string, value: string) {
    super(
      `${label} rank ${JSON.stringify(value)} must be lowercase a–z and must not end in "a"`,
    );
    this.name = "InvalidRankError";
  }
}

export class RankOrderError extends Error {
  constructor(before: string, after: string) {
    super(`Rank ${JSON.stringify(before)} does not sort before ${JSON.stringify(after)}`);
    this.name = "RankOrderError";
  }
}

function assertRank(value: string | null, label: string): void {
  if (value === null) return;
  if (!VALID_RANK.test(value)) throw new InvalidRankError(label, value);
}

const charAt = (value: string, index: number, whenPast: number): number =>
  index < value.length ? value.charCodeAt(index) : whenPast;

/**
 * A rank strictly between `before` and `after`.
 *
 * Null means "no neighbour on that side": `rankBetween(null, first)` prepends,
 * `rankBetween(last, null)` appends, and `rankBetween(null, null)` is the rank
 * of the only item in an empty list.
 *
 * Total by construction — there is no pair of distinct ranks it cannot split,
 * because it lengthens rather than running out of room.
 */
export function rankBetween(before: string | null, after: string | null): string {
  assertRank(before, "Lower");
  assertRank(after, "Upper");

  if (before !== null && after !== null && before >= after) {
    throw new RankOrderError(before, after);
  }

  if (before === null && after === null) return MIDDLE;
  if (before === null) return rankBefore(after as string);
  if (after === null) return rankAfter(before);
  return rankWithin(before, after);
}

/**
 * A rank below `value`, which must be the current lowest.
 *
 * Nothing else sorts below the first item, so any string less than it is free.
 */
function rankBefore(value: string): string {
  const head = value.charCodeAt(0);

  // Room for a character strictly between `a` and this one. The midpoint is at
  // least `b` once the head is `c`, which keeps the invariant.
  if (head >= FIRST_CODE + 2) {
    return String.fromCharCode(Math.floor((FIRST_CODE + head) / 2));
  }

  // Head is `b`: everything beginning with `a` sorts below it, whatever
  // follows, so the tail does not need inspecting.
  if (head > FIRST_CODE) return FIRST + MIDDLE;

  // Head is `a`: descend. The invariant guarantees a non-`a` character later,
  // so the tail is never empty and this recursion always terminates.
  return FIRST + rankBefore(value.slice(1));
}

/**
 * A rank above `value`, which must be the current highest.
 *
 * Nothing else sorts above the last item, so any string greater than it is
 * free.
 */
function rankAfter(value: string): string {
  const index = value.length - 1;
  const tail = value.charCodeAt(index);
  const midpoint = Math.floor((tail + ABOVE_LAST) / 2);

  if (midpoint > tail) return value.slice(0, index) + String.fromCharCode(midpoint);

  // The last character is already `z`. Extending is always greater, since the
  // shorter string is a prefix of the longer one.
  return value + MIDDLE;
}

/** A rank strictly between two existing ranks. */
function rankWithin(before: string, after: string): string {
  let result = "";

  for (let index = 0; ; index += 1) {
    const low = charAt(before, index, BELOW_FIRST);
    const high = charAt(after, index, ABOVE_LAST);

    if (low === high) {
      // Still on the shared prefix. Both bounds continue to apply, so copy and
      // keep walking. Treating this as "no room" was a real bug: it discarded
      // the upper bound while it was still binding, and produced `"bn"` for
      // the gap between `"b"` and `"bb"` — a rank above its own ceiling.
      result += String.fromCharCode(low);
      continue;
    }

    if (high - low > 1) {
      const midpoint = Math.floor((low + high) / 2);
      // A midpoint of exactly `a` would break the invariant, and it can only
      // arise where `before` has run out and `after` continues with `b`.
      // Descending into the runway keeps both the ordering and the rule.
      if (midpoint === FIRST_CODE) return `${result}${FIRST}${MIDDLE}`;
      return result + String.fromCharCode(midpoint);
    }

    if (low >= FIRST_CODE) {
      // The characters are adjacent, so nothing fits between them here. Match
      // `before` and descend: past this position every continuation sorts
      // below `after`, because `after` has diverged upward, which reduces the
      // problem to "anything above the rest of `before`".
      result += String.fromCharCode(low);
      const rest = before.slice(index + 1);
      return result + (rest === "" ? MIDDLE : rankAfter(rest));
    }

    // `before` is exhausted and `after` continues with `a`. Take the runway
    // character and keep looking for room further along `after`.
    result += FIRST;
  }
}

/**
 * Ranks for a whole list, in order.
 *
 * Used when seeding a set from an existing sequence, where inserting each item
 * against `null` neighbours would be wrong and computing them pairwise would
 * repeat this work.
 */
export function initialRanks(count: number): string[] {
  const ranks: string[] = [];
  let previous: string | null = null;
  for (let index = 0; index < count; index += 1) {
    previous = rankBetween(previous, null);
    ranks.push(previous);
  }
  return ranks;
}

/**
 * The rank an item needs to sit at `toIndex` in the list it is moving within.
 *
 * `ranks` is the current order *including* the item being moved, and
 * `fromIndex` is where it currently sits. Removing it before choosing
 * neighbours is what makes the target index mean what it does in the UI:
 * dragging item 1 to position 4 lands it between the items that will be its
 * neighbours after the move, not before it.
 */
export function rankForMove(
  ranks: readonly string[],
  fromIndex: number,
  toIndex: number,
): string {
  const remaining = ranks.filter((_, index) => index !== fromIndex);
  const clamped = Math.max(0, Math.min(remaining.length, toIndex));
  return rankBetween(remaining[clamped - 1] ?? null, remaining[clamped] ?? null);
}
