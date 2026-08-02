import { api, ApiError } from "./api.js";

/**
 * Graph endpoints, through the generated client.
 *
 * Types are derived from `openapi.json`; nothing here restates a wire shape.
 */

export interface GraphSummary {
  id: string;
  name: string;
  version: number;
}

export interface GraphNodeDto {
  id: string;
  trackId: string;
  x: number;
  y: number;
  track: {
    id: string;
    title: string;
    artist: string;
    bpm: number | null;
    keySignature: string | null;
  };
}

export interface TransitionDto {
  id: string;
  fromTrackId: string;
  toTrackId: string;
  technique: string;
  tags: string[];
  score: number | null;
}

export interface GraphDetail {
  graph: GraphSummary;
  nodes: GraphNodeDto[];
  transitions: TransitionDto[];
}

export interface Suggestion {
  track: { id: string; title: string; artist: string; bpm: number | null; keySignature: string | null };
  score: number;
  harmonicRelation: string | null;
  pitchAdjustment: number | null;
  warnings: string[];
}

function fail(status: number, fallback: string, error: unknown): never {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message: unknown }).message)
      : fallback;
  throw new ApiError(message, status);
}

export async function listGraphs(): Promise<GraphSummary[]> {
  const { data, error, response } = await api.GET("/v1/graphs", {});
  if (error || !data) fail(response.status, "Failed to load graphs", error);
  return data.items as GraphSummary[];
}

export async function createGraph(name: string): Promise<GraphSummary> {
  const { data, error, response } = await api.POST("/v1/graphs", { body: { name } });
  if (error || !data) fail(response.status, "Failed to create graph", error);
  return data as GraphSummary;
}

export async function getGraph(graphId: string): Promise<GraphDetail> {
  const { data, error, response } = await api.GET("/v1/graphs/{graphId}", {
    params: { path: { graphId } },
  });
  if (error || !data) fail(response.status, "Failed to load graph", error);
  return data as unknown as GraphDetail;
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
  return data as unknown as GraphNodeDto;
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
 * token current. A 409 means someone else moved things — the caller reloads
 * rather than clobbering (plan §10.1).
 */
export async function saveLayout(
  graphId: string,
  expectedVersion: number,
  positions: Array<{ id: string; x: number; y: number }>,
): Promise<number> {
  const { data, error, response } = await api.PATCH("/v1/graphs/{graphId}/layout", {
    params: { path: { graphId } },
    body: { expectedVersion, positions },
  });
  if (error || !data) fail(response.status, "Failed to save layout", error);
  return (data as unknown as GraphSummary).version;
}

export async function createTransition(input: {
  fromTrackId: string;
  toTrackId: string;
  technique?: string;
}): Promise<TransitionDto> {
  const { data, error, response } = await api.POST("/v1/transitions", {
    body: {
      fromTrackId: input.fromTrackId,
      toTrackId: input.toTrackId,
      ...(input.technique ? { technique: input.technique } : {}),
      tags: [],
    } as never,
  });
  if (error || !data) fail(response.status, "Failed to create transition", error);
  return data as unknown as TransitionDto;
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
  return data.items as unknown as Suggestion[];
}
