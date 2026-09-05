import { scoreTransition, type ScorableTrack } from "@flowgraph/domain";
// From the generated client, not from `@flowgraph/contracts`: the web app
// depends on the OpenAPI document, so a technique the API stops accepting
// fails typecheck here rather than at runtime.
import type { TransitionTechnique } from "./graph-api.js";

/**
 * Picks a starting technique for a newly drawn transition.
 *
 * The server scores every transition it creates and stores that score with its
 * algorithm version, so the *number* is not our job. What the API has no
 * opinion about is which move this is: `technique` defaults to `"blend"` for
 * everything, which is a guess wearing the same clothes as a decision.
 *
 * So this reads the same deterministic score the server will compute and maps
 * its harmonic relation and tempo fit onto the technique vocabulary. The
 * mapping is DJ practice, not arithmetic: keys that sit together can be ridden
 * long, keys that clash want an effect tail rather than a blend, and an
 * imperfect match wants a filter to cover the seam.
 *
 * This is a proposal, never a claim. The caller announces what was chosen and
 * why so the DJ can override it immediately, and `custom` is returned rather
 * than a plausible invention whenever the metadata cannot support a choice —
 * an unscored pair is not the same as a badly scoring one.
 */

export interface TechniqueSuggestion {
  readonly technique: TransitionTechnique;
  /** One clause, for the confirmation message. Empty when nothing was known. */
  readonly rationale: string;
  /**
   * The deterministic overall score, or null when nothing was scorable.
   *
   * Advisory only, and deliberately not persisted from here: the API scores
   * every transition it creates and stores that value with its algorithm
   * version, so this is for explaining the suggestion, never for writing.
   */
  readonly score: number | null;
}

/** Above this the two tempos sit close enough to ride together. */
const TEMPO_COMFORTABLE = 0.8;

export function suggestTechnique(from: ScorableTrack, to: ScorableTrack): TechniqueSuggestion {
  const scored = scoreTransition(from, to);
  const { harmonic, tempo } = scored.components;

  // Nothing to reason from. `custom` is the contract's escape hatch and the
  // only honest answer — every other value would assert a move we did not pick.
  if (!harmonic.applicable && !tempo.applicable) {
    return { technique: "custom", rationale: "", score: null };
  }

  const score = scored.overall;
  const tempoComfortable = tempo.applicable && tempo.score >= TEMPO_COMFORTABLE;
  const relation = scored.harmonicRelation;

  // Tempo is the hard constraint: two tracks that cannot be beatmatched cannot
  // be blended however well their keys agree, so it is checked before the key.
  if (tempo.applicable && !tempoComfortable) {
    return {
      technique: "echo-out",
      rationale: "tempos are too far apart to ride together",
      score,
    };
  }

  // Only claim the tempo matched if a tempo was actually known. With no BPM on
  // either side the pair is unscorable on that axis, and "matched tempo" would
  // be a fact the data does not support — the same fabrication the em dash
  // exists everywhere else to avoid.
  const tempoClause = tempoComfortable ? ", matched tempo" : "";

  switch (relation) {
    case "identical":
    case "adjacent":
      return {
        technique: "long-blend",
        rationale: (relation === "identical" ? "same key" : "neighbouring keys") + tempoClause,
        score,
      };
    case "relative":
      return { technique: "blend", rationale: "relative key" + tempoClause, score };
    case "energy-boost":
      // The relation is named for the lift it produces, and the energy family
      // is the set of moves that exploit one.
      return { technique: "loop-build", rationale: "key change lifts the energy", score };
    case "diagonal":
      return { technique: "filter-sweep", rationale: "keys are close but not clean", score };
    case "distant":
      return { technique: "echo-out", rationale: "keys are harmonically distant", score };
    default:
      // Tempo was scorable and comfortable, but the key of one side is unknown.
      // A plain blend is the safest move that does not pretend to know the key.
      return {
        technique: "blend",
        rationale: tempoComfortable ? "matched tempo, key unknown" : "",
        score,
      };
  }
}
