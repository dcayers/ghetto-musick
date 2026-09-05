import { z } from "zod";
import { uuidSchema } from "./ids.js";
import { trackSchema } from "./track.js";

/**
 * Set contracts — plan §8.5, §10.4.
 *
 * A set is an ordered path through the library: the running order a DJ plans,
 * as distinct from the graph, which is the space of possible routes. Items
 * reference tracks directly rather than graph nodes, so a track can be planned
 * into a set without being placed on any canvas.
 *
 * Ordering is carried by opaque rank strings (§7.4), and clients never send
 * one. A client sends "put item X at position 3" and the server computes the
 * rank, because the rank algorithm is a server concern and two clients that
 * disagreed about it would corrupt the order.
 *
 * Branches, publish snapshots, and `SetItemTransition` from §8.5 are absent
 * here: branches are deferred (decision 11), and publishing follows the
 * validation work. Adjacent transitions are resolved by the client against the
 * transitions it already holds, which is why there is no endpoint for them.
 */

// --- Sets -------------------------------------------------------------------

export const setIdParamSchema = z.object({ setId: uuidSchema });

export const setItemIdParamSchema = z.object({
  setId: uuidSchema,
  itemId: uuidSchema,
});

/**
 * Target tempo and key are optional and free-form-ish on purpose.
 *
 * They are the set's *plan*, not a measurement of its contents (§10.4), so
 * they may be set before any track is added and may disagree with the tracks
 * actually in the set. The key is validated as a Camelot position because the
 * whole UI renders it as one.
 */
const camelotKeySchema = z
  .string()
  .trim()
  .regex(/^(1[0-2]|[1-9])[AB]$/, "Expected a Camelot key such as 8A or 12B");

export const createSetSchema = z.object({
  name: z.string().trim().min(1).max(200),
  targetBpm: z.number().positive().max(400).nullish(),
  targetKey: camelotKeySchema.nullish(),
});

export const updateSetSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    targetBpm: z.number().positive().max(400).nullish(),
    targetKey: camelotKeySchema.nullish(),
  })
  // An empty PATCH is almost always a client bug — it bumps `updatedAt` and
  // the version while changing nothing, which then invalidates someone else's
  // concurrency token for no reason.
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });

export const setSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  name: z.string(),
  targetBpm: z.number().nullable(),
  targetKey: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const setSummaryListSchema = z.object({
  items: z.array(setSchema),
});

// --- Items ------------------------------------------------------------------

export const setItemSchema = z.object({
  id: uuidSchema,
  trackId: uuidSchema,
  /**
   * Opaque. Clients order by it but must never parse or generate it — the
   * format is the server's to change.
   */
  rank: z.string(),
  notes: z.string().nullable(),
  track: trackSchema,
});

/**
 * Appends by default; `position` inserts.
 *
 * A position is an index into the set as the client currently sees it, which
 * is the only coordinate the timeline actually has. Out-of-range values clamp
 * rather than fail: a drop at the end of a list that grew underneath you is
 * still obviously a request to append.
 */
export const addSetItemSchema = z.object({
  trackId: uuidSchema,
  position: z.number().int().min(0).optional(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * Moves one item to an index.
 *
 * `toIndex` is where the item should end up in the list *after* the move,
 * matching what the user dragged. The server recomputes one rank; no other row
 * is touched, which is the entire reason for fractional ranks (§7.4).
 */
export const reorderSetItemSchema = z.object({
  itemId: uuidSchema,
  toIndex: z.number().int().min(0),
});

export const setDetailSchema = z.object({
  set: setSchema,
  items: z.array(setItemSchema),
});

export type CreateSetInput = z.infer<typeof createSetSchema>;
export type UpdateSetInput = z.infer<typeof updateSetSchema>;
export type AddSetItemInput = z.infer<typeof addSetItemSchema>;
export type ReorderSetItemInput = z.infer<typeof reorderSetItemSchema>;
export type SetDto = z.infer<typeof setSchema>;
export type SetItemDto = z.infer<typeof setItemSchema>;
export type SetDetail = z.infer<typeof setDetailSchema>;
