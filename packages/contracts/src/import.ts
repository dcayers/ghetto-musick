import { z } from "zod";
import { uuidSchema } from "./ids.js";

/**
 * Import contracts — plan §8.7, §12.3 S1.
 *
 * Read-only Serato import. The response is a run summary rather than the
 * imported tracks: a library is thousands of rows, the library endpoint
 * already serves them, and returning both would make the import look like the
 * source of truth for the collection rather than one contributor to it.
 */

export const importRunStatuses = ["RUNNING", "SUCCEEDED", "FAILED"] as const;
export const importRunStatusSchema = z.enum(importRunStatuses);

/**
 * Where to import from.
 *
 * Omitting `root` scans the standard macOS locations (ADR-0006 is macOS-only
 * for now). An explicit root is accepted because a DJ's library often lives on
 * an external drive, which is exactly the case the defaults miss.
 */
export const startSeratoImportSchema = z.object({
  root: z.string().trim().min(1).max(4096).optional(),
});

export const seratoRootSchema = z.object({
  root: z.string(),
  /** True when a `database V2` was found and is readable. */
  readable: z.boolean(),
  crateCount: z.number().int(),
});

export const seratoRootsSchema = z.object({
  items: z.array(seratoRootSchema),
});

export const importRunSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  source: z.string(),
  root: z.string(),
  status: importRunStatusSchema,
  /** Entries read from the library, whatever became of them. */
  tracksSeen: z.number().int(),
  tracksCreated: z.number().int(),
  tracksUpdated: z.number().int(),
  /** Entries whose recorded path no longer resolves to a file. */
  filesMissing: z.number().int(),
  /** Entries with no local file at all — a normal state, not a failure. */
  streamingSeen: z.number().int(),
  error: z.string().nullable(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});

export const importRunListSchema = z.object({
  items: z.array(importRunSchema),
});

export type StartSeratoImportInput = z.infer<typeof startSeratoImportSchema>;
export type ImportRunDto = z.infer<typeof importRunSchema>;
export type SeratoRootDto = z.infer<typeof seratoRootSchema>;
