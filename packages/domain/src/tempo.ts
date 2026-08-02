/**
 * Tempo compatibility — plan §10.2, §14.3.
 *
 * A transition is playable when the incoming track can be pitched into the
 * outgoing track's tempo without sounding unnatural. Typical pitch faders
 * reach ±8%, but musical quality degrades well before that, so the default
 * tolerance is tighter.
 */

export interface TempoOptions {
  /** Maximum acceptable pitch adjustment, as a fraction. Default 0.06 (±6%). */
  readonly tolerance?: number;
  /**
   * Whether to consider half-time and double-time matches. A 70 BPM track
   * mixes with a 140 BPM track at the same perceived pulse, and rejecting
   * that pairing would hide a large share of genuinely valid transitions.
   */
  readonly allowHalfDouble?: boolean;
}

export interface TempoMatch {
  /** Compatibility in [0, 1]. */
  readonly score: number;
  /** Fractional pitch adjustment needed on the incoming track. */
  readonly pitchAdjustment: number;
  /** Tempo ratio applied to reach the match. */
  readonly ratio: 0.5 | 1 | 2;
  readonly withinTolerance: boolean;
}

const DEFAULT_TOLERANCE = 0.06;

/**
 * Guards the tolerance comparison against floating-point representation error.
 *
 * `tempoWindow` is used to pre-filter candidates and `tempoCompatibility` then
 * scores them, so the two must agree at their shared boundary. Without this,
 * a BPM at exactly the window edge round-trips to a ratio a few ULPs over
 * tolerance and is reported out of range — a candidate that passes filtering
 * then fails scoring.
 */
const TOLERANCE_EPSILON = 1e-9;

/**
 * Scores the tempo move from `fromBpm` to `toBpm`.
 *
 * Returns the best of the direct, half-time, and double-time interpretations.
 * Score decays linearly to zero at twice the tolerance so that near-misses
 * stay rankable rather than being indistinguishable from wild mismatches.
 */
export function tempoCompatibility(
  fromBpm: number,
  toBpm: number,
  options: TempoOptions = {},
): TempoMatch {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const allowHalfDouble = options.allowHalfDouble ?? true;

  if (fromBpm <= 0 || toBpm <= 0) {
    return { score: 0, pitchAdjustment: 0, ratio: 1, withinTolerance: false };
  }

  const ratios: Array<0.5 | 1 | 2> = allowHalfDouble ? [1, 0.5, 2] : [1];

  let best: TempoMatch = {
    score: 0,
    pitchAdjustment: Number.POSITIVE_INFINITY,
    ratio: 1,
    withinTolerance: false,
  };

  for (const ratio of ratios) {
    const target = toBpm * ratio;
    const adjustment = (target - fromBpm) / fromBpm;
    const magnitude = Math.abs(adjustment);

    // Linear decay: full marks at an exact match, zero at 2x tolerance.
    const score = Math.max(0, 1 - magnitude / (tolerance * 2));

    // Half/double-time matches are musically valid but a bigger creative
    // decision than a straight blend, so they are ranked slightly below an
    // equivalent direct match rather than tied with it.
    const adjusted = ratio === 1 ? score : score * 0.9;

    if (adjusted > best.score) {
      best = {
        score: adjusted,
        pitchAdjustment: adjustment,
        ratio,
        withinTolerance: magnitude <= tolerance + TOLERANCE_EPSILON,
      };
    }
  }

  return best;
}

/** BPM window reachable from `bpm` within tolerance, for candidate filtering. */
export function tempoWindow(
  bpm: number,
  options: TempoOptions = {},
): { min: number; max: number } {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  return {
    min: bpm * (1 - tolerance),
    max: bpm * (1 + tolerance),
  };
}
