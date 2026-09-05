import { z } from "zod";

/**
 * Error response contract.
 *
 * **This documents what the API actually returns, which is not what plan §6.3
 * specifies.** The plan calls for RFC 9457 problem details
 * (`type`/`title`/`status`/`detail`/`instance`); Rikta's exception filter emits
 * the shape below instead.
 *
 * Documenting the RFC shape here would produce an OpenAPI document that lies
 * about the API — worse than documenting the real one. Converting the error
 * format is a separate change: it needs a custom Rikta exception filter and
 * touches every error path, so it should not ride along with the OpenAPI work.
 *
 * Until then, this is the contract of record.
 */

export const validationIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
  code: z.string(),
  expected: z.string().optional(),
});

export const errorResponseSchema = z.object({
  statusCode: z.number().int(),
  message: z.string(),
  error: z.string(),
  timestamp: z.iso.datetime(),
  path: z.string(),
  requestId: z.string(),
  /** Present on validation failures. */
  details: z
    .object({
      errors: z.array(validationIssueSchema),
      errorCount: z.number().int(),
    })
    .optional(),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
