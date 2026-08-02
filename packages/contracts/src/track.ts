import { z } from "zod";
import { uuidSchema } from "./ids.js";

/**
 * Track contracts.
 *
 * These schemas are the single source of truth for validation, OpenAPI
 * generation, and TypeScript inference. They live here rather than inline in
 * Rikta decorators so they survive a framework swap — ADR-0002 rule 4.
 *
 * Verified safe against the dual-Zod situation: @riktajs/core bundles its own
 * zod, but validates via `.safeParse()` rather than `instanceof`, so schemas
 * built here work correctly when passed to `@Body(schema)`.
 */

/** Musical key in Camelot notation, e.g. "8A", "12B". */
export const camelotKeySchema = z
  .string()
  .regex(/^(?:[1-9]|1[0-2])[AB]$/, "Expected Camelot notation, e.g. 8A or 12B");

/** Time signature as "beats/unit", e.g. "4/4", "6/8". */
export const timeSignatureSchema = z
  .string()
  .regex(/^\d{1,2}\/\d{1,2}$/, "Expected a time signature, e.g. 4/4");

/**
 * BPM is bounded rather than merely positive. Values outside this range are
 * almost always a parse error (half/double-time detection failures, or a
 * duration field misread as tempo) and should be rejected at the boundary.
 */
export const bpmSchema = z.number().positive().min(20).max(300);

export const createTrackSchema = z.object({
  title: z.string().trim().min(1).max(500),
  artist: z.string().trim().min(1).max(500),
  bpm: bpmSchema.optional(),
  keySignature: camelotKeySchema.optional(),
  timeSignature: timeSignatureSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
});

export const updateTrackSchema = createTrackSchema.partial();

export const trackIdParamSchema = z.object({
  trackId: uuidSchema,
});

export const listTracksQuerySchema = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  bpmMin: z.coerce.number().positive().optional(),
  bpmMax: z.coerce.number().positive().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const trackSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  title: z.string(),
  artist: z.string(),
  bpm: z.number().nullable(),
  keySignature: z.string().nullable(),
  timeSignature: z.string().nullable(),
  tags: z.array(z.string()),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const trackPageSchema = z.object({
  items: z.array(trackSchema),
  /** Opaque cursor for the next page, or null when exhausted. */
  nextCursor: z.string().nullable(),
});

export type CreateTrackInput = z.infer<typeof createTrackSchema>;
export type TrackPage = z.infer<typeof trackPageSchema>;
export type UpdateTrackInput = z.infer<typeof updateTrackSchema>;
export type ListTracksQuery = z.infer<typeof listTracksQuerySchema>;
export type TrackDto = z.infer<typeof trackSchema>;
