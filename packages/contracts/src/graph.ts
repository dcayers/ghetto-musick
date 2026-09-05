import { z } from "zod";
import { uuidSchema } from "./ids.js";
import { trackSchema } from "./track.js";

/**
 * Graph and transition contracts — plan §8.3.
 *
 * A graph is a named canvas over the workspace's tracks. Nodes carry layout;
 * transitions are workspace-level and reusable across graphs, because a
 * mixing relationship between two tracks does not stop being true because
 * you opened a different canvas (§7.1).
 */

/**
 * Mixing techniques — plan §10.2.
 *
 * A closed set rather than free text so the canvas can style edges
 * consistently and the AI pipeline has a bounded vocabulary to select from
 * (§14.4). `custom` is the escape hatch, paired with `notes`.
 */
export const transitionTechniques = [
  "blend",
  "long-blend",
  "cut",
  "echo-out",
  "filter-sweep",
  "loop-build",
  "acapella-over",
  "genre-flip",
  // Effect-tail and hard-cut moves. Added because the planning UI renders
  // them and the demo set uses both; a technique the client can draw but the
  // API rejects is a vocabulary split, which is exactly what the closed set
  // above exists to prevent.
  "reverb-tail",
  "backspin",
  "custom",
] as const;

export const transitionTechniqueSchema = z.enum(transitionTechniques);
export type TransitionTechnique = (typeof transitionTechniques)[number];

// --- Graphs -----------------------------------------------------------------

export const createGraphSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

export const graphIdParamSchema = z.object({ graphId: uuidSchema });

export const graphNodeSchema = z.object({
  id: uuidSchema,
  trackId: uuidSchema,
  x: z.number(),
  y: z.number(),
  track: trackSchema,
});

export const graphSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  name: z.string(),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const graphSummaryListSchema = z.object({
  items: z.array(graphSchema),
});

// --- Nodes ------------------------------------------------------------------

export const addGraphNodeSchema = z.object({
  trackId: uuidSchema,
  x: z.number(),
  y: z.number(),
});

export const nodePositionSchema = z.object({
  id: uuidSchema,
  x: z.number(),
  y: z.number(),
});

/**
 * Bounded layout batch — plan §6.3, §9.8.
 *
 * The canvas debounces drags and sends one batch on pointer release rather
 * than a request per frame. `expectedVersion` is optimistic concurrency: a
 * mismatch means another client moved things, and the caller reloads rather
 * than silently clobbering.
 */
export const updateLayoutSchema = z.object({
  expectedVersion: z.number().int().min(1),
  positions: z.array(nodePositionSchema).min(1).max(500),
});

export const nodeIdParamSchema = z.object({
  graphId: uuidSchema,
  nodeId: uuidSchema,
});

// --- Transitions ------------------------------------------------------------

export const createTransitionSchema = z.object({
  fromTrackId: uuidSchema,
  toTrackId: uuidSchema,
  technique: transitionTechniqueSchema.default("blend"),
  notes: z.string().trim().max(2000).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
});

/**
 * Planned mix length, in bars.
 *
 * Bounded because the field is a number input: 1 bar is the shortest thing
 * worth calling a mix, and 128 bars is already over two minutes at club
 * tempo. The ceiling exists to catch a slipped decimal point, not to express
 * a musical opinion.
 */
export const transitionBarsSchema = z.number().int().min(1).max(128);

/**
 * Refining a transition after quick-create — plan §8.3, §10.1.
 *
 * Every field is optional, and `notes` is `nullish` rather than `optional`
 * because absent and null mean different things here: absent leaves the note
 * alone, explicit null clears it. `bars` is the same, and clearing it returns
 * the transition to "length not decided" rather than to zero.
 *
 * `fromTrackId` and `toTrackId` are deliberately absent. Re-pointing an edge
 * at different tracks is not an edit of this transition — it is a different
 * transition, with a different deterministic score, and allowing it here
 * would silently invalidate the score snapshot §10.2 requires.
 */
export const updateTransitionSchema = z
  .object({
    technique: transitionTechniqueSchema.optional(),
    bars: transitionBarsSchema.nullish(),
    notes: z.string().trim().max(2000).nullish(),
    tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  })
  // An empty PATCH is almost always a client bug — unknown keys are stripped,
  // so a misspelled field name arrives here as `{}` and would otherwise be
  // answered with a cheerful 200 that changed nothing.
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });

export const transitionSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  fromTrackId: uuidSchema,
  toTrackId: uuidSchema,
  technique: z.string(),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  /** Planned mix length in bars, or null when it has not been decided. */
  bars: z.number().int().nullable(),
  /** Deterministic score at authoring time, 0–1. */
  score: z.number().nullable(),
  /** Algorithm version that produced `score` — plan §10.4. */
  scoreAlgorithm: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const transitionIdParamSchema = z.object({ transitionId: uuidSchema });

/** Everything the canvas needs in one request — nodes, edges, and tracks. */
export const graphDetailSchema = z.object({
  graph: graphSchema,
  nodes: z.array(graphNodeSchema),
  transitions: z.array(transitionSchema),
});

// --- Suggestions ------------------------------------------------------------

export const suggestQuerySchema = z.object({
  fromTrackId: uuidSchema,
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const transitionSuggestionSchema = z.object({
  track: trackSchema,
  /** Overall deterministic score, 0–1. */
  score: z.number(),
  algorithmVersion: z.number().int(),
  harmonicRelation: z.string().nullable(),
  /** Fractional pitch adjustment needed, e.g. 0.031 for +3.1%. */
  pitchAdjustment: z.number().nullable(),
  warnings: z.array(z.string()),
});

export const transitionSuggestionsSchema = z.object({
  items: z.array(transitionSuggestionSchema),
});

export type CreateGraphInput = z.infer<typeof createGraphSchema>;
export type AddGraphNodeInput = z.infer<typeof addGraphNodeSchema>;
export type UpdateLayoutInput = z.infer<typeof updateLayoutSchema>;
export type CreateTransitionInput = z.infer<typeof createTransitionSchema>;
export type UpdateTransitionInput = z.infer<typeof updateTransitionSchema>;
export type GraphDetail = z.infer<typeof graphDetailSchema>;
export type TransitionDto = z.infer<typeof transitionSchema>;
export type GraphNodeDto = z.infer<typeof graphNodeSchema>;
export type TransitionSuggestion = z.infer<typeof transitionSuggestionSchema>;
