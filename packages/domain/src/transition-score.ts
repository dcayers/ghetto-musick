import { parseKey, harmonicScore, harmonicRelation, type HarmonicRelation } from "./camelot.js";
import { tempoCompatibility, type TempoOptions } from "./tempo.js";

/**
 * Deterministic transition scoring — plan §10.2.
 *
 * Scores are advisory, never gates: a deliberate key clash or energy jump is
 * a valid artistic choice when the DJ marks it intentional. The score exists
 * to rank candidates and to explain itself, not to forbid anything.
 *
 * Every result carries `algorithmVersion`. Plan §10.4 requires stored scores
 * be attributable to the algorithm that produced them, so weight changes do
 * not silently invalidate historical set validation.
 */

export const TRANSITION_ALGORITHM_VERSION = 1;

/** Minimal shape needed to score. Deliberately not the persisted Track type. */
export interface ScorableTrack {
  readonly id: string;
  readonly bpm?: number | null;
  readonly keySignature?: string | null;
  readonly tags?: readonly string[];
  /** Perceived intensity, 1–10, if known. */
  readonly energy?: number | null;
}

export interface TransitionScoreWeights {
  readonly harmonic: number;
  readonly tempo: number;
  readonly energy: number;
  readonly tags: number;
}

export const DEFAULT_WEIGHTS: TransitionScoreWeights = {
  harmonic: 0.4,
  tempo: 0.4,
  energy: 0.1,
  tags: 0.1,
};

export interface TransitionScoreOptions extends TempoOptions {
  readonly weights?: Partial<TransitionScoreWeights>;
}

export interface TransitionScoreComponent {
  readonly score: number;
  readonly weight: number;
  /** False when the inputs were unavailable, so the component was skipped. */
  readonly applicable: boolean;
  readonly detail?: string;
}

export interface TransitionScore {
  readonly overall: number;
  readonly algorithmVersion: number;
  readonly components: {
    readonly harmonic: TransitionScoreComponent;
    readonly tempo: TransitionScoreComponent;
    readonly energy: TransitionScoreComponent;
    readonly tags: TransitionScoreComponent;
  };
  readonly harmonicRelation: HarmonicRelation | null;
  readonly pitchAdjustment: number | null;
  readonly warnings: readonly string[];
}

/**
 * Scores a directed transition from one track to another.
 *
 * Direction matters (plan §7.2): A→B is not automatically valid as B→A,
 * because the pitch adjustment and energy delta both invert.
 *
 * Components with missing inputs are marked inapplicable and excluded from
 * the weighted mean rather than scored zero. Scoring them zero would rank a
 * track with unknown BPM below one with a genuinely bad BPM, which is exactly
 * backwards — unknown is not the same as bad.
 */
export function scoreTransition(
  from: ScorableTrack,
  to: ScorableTrack,
  options: TransitionScoreOptions = {},
): TransitionScore {
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const warnings: string[] = [];

  // --- Harmonic -----------------------------------------------------------
  const fromKey = parseKey(from.keySignature);
  const toKey = parseKey(to.keySignature);
  const keysKnown = fromKey !== null && toKey !== null;

  const relation = keysKnown ? harmonicRelation(fromKey, toKey) : null;
  const harmonic: TransitionScoreComponent = {
    score: keysKnown ? harmonicScore(fromKey, toKey) : 0,
    weight: weights.harmonic,
    applicable: keysKnown,
    ...(relation ? { detail: relation } : {}),
  };

  if (!keysKnown) {
    warnings.push("Key unknown for one or both tracks; harmonic score omitted");
  } else if (relation === "distant") {
    warnings.push("Keys are harmonically distant");
  }

  // --- Tempo --------------------------------------------------------------
  const bpmKnown =
    typeof from.bpm === "number" && from.bpm > 0 && typeof to.bpm === "number" && to.bpm > 0;

  const tempoMatch = bpmKnown ? tempoCompatibility(from.bpm!, to.bpm!, options) : null;
  const tempo: TransitionScoreComponent = {
    score: tempoMatch?.score ?? 0,
    weight: weights.tempo,
    applicable: bpmKnown,
    ...(tempoMatch ? { detail: `ratio ${tempoMatch.ratio}, pitch ${(tempoMatch.pitchAdjustment * 100).toFixed(1)}%` } : {}),
  };

  if (!bpmKnown) {
    warnings.push("BPM unknown for one or both tracks; tempo score omitted");
  } else if (tempoMatch && !tempoMatch.withinTolerance) {
    warnings.push("Tempo change exceeds the configured pitch tolerance");
  }

  // --- Energy -------------------------------------------------------------
  const energyKnown = typeof from.energy === "number" && typeof to.energy === "number";
  const energyDelta = energyKnown ? to.energy! - from.energy! : 0;
  // A gentle lift reads as a natural build. Large jumps in either direction
  // are jarring, so the score decays with absolute delta.
  const energyScore = energyKnown ? Math.max(0, 1 - Math.abs(energyDelta) / 5) : 0;

  const energy: TransitionScoreComponent = {
    score: energyScore,
    weight: weights.energy,
    applicable: energyKnown,
    ...(energyKnown ? { detail: `delta ${energyDelta > 0 ? "+" : ""}${energyDelta}` } : {}),
  };

  // --- Tags ---------------------------------------------------------------
  const fromTags = new Set((from.tags ?? []).map((tag) => tag.toLowerCase()));
  const toTags = new Set((to.tags ?? []).map((tag) => tag.toLowerCase()));
  const tagsKnown = fromTags.size > 0 && toTags.size > 0;

  let shared = 0;
  for (const tag of fromTags) {
    if (toTags.has(tag)) shared += 1;
  }
  // Jaccard similarity: shared over union.
  const union = fromTags.size + toTags.size - shared;
  const tagScore = tagsKnown && union > 0 ? shared / union : 0;

  const tags: TransitionScoreComponent = {
    score: tagScore,
    weight: weights.tags,
    applicable: tagsKnown,
    ...(tagsKnown ? { detail: `${shared} shared` } : {}),
  };

  // --- Weighted mean over applicable components only ----------------------
  const components = [harmonic, tempo, energy, tags];
  const totalWeight = components
    .filter((component) => component.applicable)
    .reduce((sum, component) => sum + component.weight, 0);

  const overall =
    totalWeight === 0
      ? 0
      : components
          .filter((component) => component.applicable)
          .reduce((sum, component) => sum + component.score * component.weight, 0) / totalWeight;

  if (totalWeight === 0) {
    warnings.push("No scorable metadata available for this pair");
  }

  return {
    overall,
    algorithmVersion: TRANSITION_ALGORITHM_VERSION,
    components: { harmonic, tempo, energy, tags },
    harmonicRelation: relation,
    pitchAdjustment: tempoMatch?.pitchAdjustment ?? null,
    warnings,
  };
}

export interface RankedCandidate {
  readonly track: ScorableTrack;
  readonly score: TransitionScore;
}

/**
 * Ranks candidate next-tracks, best first.
 *
 * Ties break on track id so ordering is deterministic — set generation and
 * its tests must not depend on input array order.
 */
export function rankCandidates(
  from: ScorableTrack,
  candidates: readonly ScorableTrack[],
  options: TransitionScoreOptions = {},
): RankedCandidate[] {
  return candidates
    .filter((candidate) => candidate.id !== from.id)
    .map((candidate) => ({ track: candidate, score: scoreTransition(from, candidate, options) }))
    .sort((a, b) =>
      b.score.overall === a.score.overall
        ? a.track.id.localeCompare(b.track.id)
        : b.score.overall - a.score.overall,
    );
}
