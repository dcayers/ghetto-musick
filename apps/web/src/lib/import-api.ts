import type { paths } from "@flowgraph/api-client";

import { api, ApiError } from "./api.js";

/**
 * Import endpoints, through the generated client.
 *
 * Types are projected out of `paths` rather than restated, for the reason
 * `graph-api.ts` explains: a hand-written wire type bridged by a cast absorbs
 * contract changes instead of failing on them.
 */

export type ImportRun =
  paths["/v1/imports/serato"]["post"]["responses"][201]["content"]["application/json"];

export type SeratoRoot =
  paths["/v1/imports/serato/roots"]["get"]["responses"][200]["content"]["application/json"]["items"][number];

function fail(status: number, fallback: string, error: unknown): never {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message: unknown }).message)
      : fallback;
  throw new ApiError(message, status);
}

export async function listSeratoRoots(): Promise<SeratoRoot[]> {
  const { data, error, response } = await api.GET("/v1/imports/serato/roots", {});
  if (error || !data) fail(response.status, "Could not look for Serato libraries", error);
  return data.items;
}

export async function listImportRuns(): Promise<ImportRun[]> {
  const { data, error, response } = await api.GET("/v1/imports", {});
  if (error || !data) fail(response.status, "Could not load import history", error);
  return data.items;
}

/**
 * Runs an import and waits for it.
 *
 * The request holds open for the whole scan. Plan §17 puts long imports behind
 * a job queue and a library large enough to need one will need that, but there
 * is no queue yet — and a job id returned by a request that already did the
 * work would be a fiction the UI then had to poll.
 */
export async function importSerato(root?: string): Promise<ImportRun> {
  const { data, error, response } = await api.POST("/v1/imports/serato", {
    body: root === undefined ? {} : { root },
  });
  if (error || !data) fail(response.status, "Import failed", error);
  return data;
}

/** A one-line summary of what a run did, for the status line. */
export function describeRun(run: ImportRun): string {
  const parts = [`${run.tracksCreated} added`, `${run.tracksUpdated} updated`];
  if (run.streamingSeen > 0) parts.push(`${run.streamingSeen} streaming`);
  // Only worth saying when it happened: "0 missing" is noise on every run.
  if (run.filesMissing > 0) parts.push(`${run.filesMissing} file(s) missing`);
  return `Imported ${run.tracksSeen} track${run.tracksSeen === 1 ? "" : "s"} — ${parts.join(", ")}.`;
}
