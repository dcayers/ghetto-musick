import type { paths } from "@flowgraph/api-client";

import { api, ApiError } from "./api.js";

/**
 * Set endpoints, through the generated client.
 *
 * Types are projected out of `paths` rather than restated, for the reason
 * `graph-api.ts` explains at length: a hand-written wire type bridged by a
 * cast absorbs contract changes instead of failing on them.
 */

export type SetSummary =
  paths["/v1/sets"]["get"]["responses"][200]["content"]["application/json"]["items"][number];

export type SetDetail =
  paths["/v1/sets/{setId}"]["get"]["responses"][200]["content"]["application/json"];

export type SetItemDto = SetDetail["items"][number];

function fail(status: number, fallback: string, error: unknown): never {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message: unknown }).message)
      : fallback;
  throw new ApiError(message, status);
}

export async function listSets(): Promise<SetSummary[]> {
  const { data, error, response } = await api.GET("/v1/sets", {});
  if (error || !data) fail(response.status, "Failed to load sets", error);
  return data.items;
}

/**
 * Creates a set.
 *
 * Targets are optional but not nullable here, even though the contract accepts
 * an explicit null to clear them. The generated body type says `number` rather
 * than `number | null` because `@riktajs/swagger` drops Zod's `.nullable()`
 * when it writes the document — the same defect `adapt.test.ts` documents on
 * the response side. Clearing a target needs the PATCH route and that fix.
 */
export async function createSet(input: {
  name: string;
  targetBpm?: number;
  targetKey?: string;
}): Promise<SetSummary> {
  const { data, error, response } = await api.POST("/v1/sets", {
    body: {
      name: input.name,
      ...(input.targetBpm !== undefined ? { targetBpm: input.targetBpm } : {}),
      ...(input.targetKey !== undefined ? { targetKey: input.targetKey } : {}),
    },
  });
  if (error || !data) fail(response.status, "Failed to create set", error);
  return data;
}

export async function getSet(setId: string): Promise<SetDetail> {
  const { data, error, response } = await api.GET("/v1/sets/{setId}", {
    params: { path: { setId } },
  });
  if (error || !data) fail(response.status, "Failed to load set", error);
  return data;
}

/**
 * Adds a track to the set.
 *
 * Omitting `position` appends, which is what a drop past the last card means.
 */
export async function addSetItem(
  setId: string,
  input: { trackId: string; position?: number },
): Promise<SetItemDto> {
  const { data, error, response } = await api.POST("/v1/sets/{setId}/items", {
    params: { path: { setId } },
    body: {
      trackId: input.trackId,
      ...(input.position !== undefined ? { position: input.position } : {}),
    },
  });
  if (error || !data) fail(response.status, "Failed to add the track", error);
  return data;
}

export async function removeSetItem(setId: string, itemId: string): Promise<void> {
  const { error, response } = await api.DELETE("/v1/sets/{setId}/items/{itemId}", {
    params: { path: { setId, itemId } },
  });
  if (error) fail(response.status, "Failed to remove the track", error);
}

/**
 * Moves one item to an index.
 *
 * The server recomputes a single rank between the item's new neighbours, so
 * this writes one row however long the set is (plan §7.4).
 */
export async function reorderSetItem(
  setId: string,
  itemId: string,
  toIndex: number,
): Promise<SetItemDto> {
  const { data, error, response } = await api.PATCH("/v1/sets/{setId}/items/reorder", {
    params: { path: { setId } },
    body: { itemId, toIndex },
  });
  if (error || !data) fail(response.status, "Failed to reorder the set", error);
  return data;
}
