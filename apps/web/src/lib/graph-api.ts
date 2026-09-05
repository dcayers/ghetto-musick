import type { paths } from "@flowgraph/api-client";

import { api, ApiError } from "./api.js";

/**
 * Graph endpoints, through the generated client.
 *
 * Every type below is projected out of `paths`, which `openapi-typescript`
 * derives from `openapi.json`. The document inlines its schemas rather than
 * using `$ref` components, so `components["schemas"]` is `never` and the
 * projection has to walk the path — verbose, but it is still one source of
 * truth. An earlier version of this file restated the shapes by hand and
 * bridged the difference with `as unknown as`, which meant the casts silently
 * absorbed every contract change instead of failing on it.
 */

type Json200<P extends keyof paths, M extends "get"> = paths[P][M] extends {
  responses: { 200: { content: { "application/json": infer T } } };
}
  ? T
  : never;

export type GraphSummary = Json200<"/v1/graphs", "get">["items"][number];
export type GraphDetail = Json200<"/v1/graphs/{graphId}", "get">;
export type GraphNodeDto = GraphDetail["nodes"][number];
export type TransitionDto = GraphDetail["transitions"][number];
export type TrackDto = GraphNodeDto["track"];
export type Suggestion = Json200<"/v1/transitions/suggestions", "get">["items"][number];

/**
 * The closed technique vocabulary, straight from the contract.
 *
 * Exported because the UI's own technique table has to stay a subset of it:
 * a technique the canvas can draw but the API rejects is precisely the split
 * the closed set exists to prevent.
 */
export type TransitionTechnique = NonNullable<
  paths["/v1/transitions"]["post"]["requestBody"]
>["content"]["application/json"]["technique"];

/** A node position in a layout batch. */
export interface NodePosition {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/**
 * Raised when the graph moved underneath us.
 *
 * Distinct from a generic `ApiError` because the caller's response is
 * different in kind: a 409 is not a failure to retry but a signal to reload
 * and re-apply, which is what plan §10.1 asks for.
 */
export class GraphConflictError extends ApiError {
  constructor(message = "The graph changed in another window.") {
    super(message, 409);
    this.name = "GraphConflictError";
  }
}

/**
 * A technique change that collides with another edge on the same pair.
 *
 * Separate from `GraphConflictError` because the recovery is different: this
 * one is not stale state and a reload does not resolve it. The caller has to
 * roll its own edit back and say why.
 */
export class TransitionConflictError extends ApiError {
  constructor(message = "Those tracks are already connected with that technique.") {
    super(message, 409);
    this.name = "TransitionConflictError";
  }
}

function fail(status: number, fallback: string, error: unknown): never {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message: unknown }).message)
      : fallback;
  if (status === 409) throw new GraphConflictError(message);
  throw new ApiError(message, status);
}

export async function listGraphs(): Promise<GraphSummary[]> {
  const { data, error, response } = await api.GET("/v1/graphs", {});
  if (error || !data) fail(response.status, "Failed to load graphs", error);
  return data.items;
}

export async function createGraph(name: string): Promise<GraphSummary> {
  const { data, error, response } = await api.POST("/v1/graphs", { body: { name } });
  if (error || !data) fail(response.status, "Failed to create graph", error);
  return data;
}

export async function getGraph(graphId: string): Promise<GraphDetail> {
  const { data, error, response } = await api.GET("/v1/graphs/{graphId}", {
    params: { path: { graphId } },
  });
  if (error || !data) fail(response.status, "Failed to load graph", error);
  return data;
}

export async function addNode(
  graphId: string,
  input: { trackId: string; x: number; y: number },
): Promise<GraphNodeDto> {
  const { data, error, response } = await api.POST("/v1/graphs/{graphId}/nodes", {
    params: { path: { graphId } },
    body: input,
  });
  if (error || !data) fail(response.status, "Failed to place track", error);
  return data;
}

export async function removeNode(graphId: string, nodeId: string): Promise<void> {
  const { error, response } = await api.DELETE("/v1/graphs/{graphId}/nodes/{nodeId}", {
    params: { path: { graphId, nodeId } },
  });
  if (error) fail(response.status, "Failed to remove track", error);
}

/**
 * Persists a batch of positions.
 *
 * Returns the new version so the caller can keep its optimistic-concurrency
 * token current. A 409 arrives as `GraphConflictError` — someone else moved
 * things, and the caller reloads rather than clobbering (plan §10.1).
 */
export async function saveLayout(
  graphId: string,
  expectedVersion: number,
  positions: readonly NodePosition[],
): Promise<number> {
  const { data, error, response } = await api.PATCH("/v1/graphs/{graphId}/layout", {
    params: { path: { graphId } },
    body: { expectedVersion, positions: [...positions] },
  });
  if (error || !data) fail(response.status, "Failed to save layout", error);
  return data.version;
}

export async function createTransition(input: {
  fromTrackId: string;
  toTrackId: string;
  technique?: TransitionTechnique;
  notes?: string;
}): Promise<TransitionDto> {
  const { data, error, response } = await api.POST("/v1/transitions", {
    body: {
      fromTrackId: input.fromTrackId,
      toTrackId: input.toTrackId,
      // Required by the generated body type even though Zod defaults it —
      // `.default()` makes the field required on the *output* side, which is
      // what the document describes.
      technique: input.technique ?? "blend",
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      tags: [],
    },
  });
  if (error || !data) fail(response.status, "Failed to create transition", error);
  return data;
}

/**
 * Refines a transition — plan §8.3.
 *
 * `bars` and `notes` are sent when present and `null` when explicitly
 * cleared, matching the contract's `nullish`: omitting a field leaves it
 * alone, so a patch of `{ bars: 32 }` must not blank the notes.
 *
 * A 409 here is deliberately *not* routed through `fail`. Its 409 branch
 * raises `GraphConflictError`, which the store answers by reloading the graph
 * — the right move for a stale layout version, and the wrong one here. This
 * conflict means the technique is taken on that pair; reloading would show
 * the user the same two edges and lose their edit while implying the problem
 * was staleness.
 */
export async function updateTransition(
  transitionId: string,
  patch: {
    technique?: TransitionTechnique;
    bars?: number | null;
    notes?: string | null;
    tags?: string[];
  },
): Promise<TransitionDto> {
  const { data, error, response } = await api.PATCH("/v1/transitions/{transitionId}", {
    params: { path: { transitionId } },
    body: patch,
  });
  if (error || !data) {
    if (response.status === 409) {
      throw new TransitionConflictError(
        typeof error === "object" && error && "message" in error
          ? String((error as { message: unknown }).message)
          : "Those tracks are already connected with that technique.",
      );
    }
    fail(response.status, "Failed to update transition", error);
  }
  return data;
}

export async function deleteTransition(transitionId: string): Promise<void> {
  const { error, response } = await api.DELETE("/v1/transitions/{transitionId}", {
    params: { path: { transitionId } },
  });
  if (error) fail(response.status, "Failed to delete transition", error);
}

export async function suggestTransitions(
  fromTrackId: string,
  limit = 8,
): Promise<Suggestion[]> {
  const { data, error, response } = await api.GET("/v1/transitions/suggestions", {
    params: { query: { fromTrackId, limit } },
  });
  if (error || !data) fail(response.status, "Failed to load suggestions", error);
  return data.items;
}
