import type { Track as TrackDto } from "@flowgraph/api-client";

import type { GraphDetail, GraphNodeDto, TransitionDto } from "./graph-api.js";
import type {
  WorkspaceGraphNode,
  WorkspaceTrack,
  WorkspaceTransition,
} from "./workspace-data.js";

/**
 * API responses to workspace shapes.
 *
 * The one place the wire format meets the UI vocabulary. It exists so the
 * mapping is reviewable in a single file rather than smeared across the four
 * surfaces that consume it, and so the fields the API does not yet store are
 * listed explicitly instead of being quietly absent.
 *
 * The rule everywhere below: **map what exists, null what does not.** No field
 * is synthesised from a track id. A derived genre or energy would render
 * beside the user's real titles as though it were their own metadata, which is
 * a worse failure than an empty cell — the cell is recoverable, a plausible
 * fabrication is not.
 */

/**
 * Fields the `Track` table has no column for.
 *
 * Pulled out as a named constant because it is a to-do list as much as a
 * default: each entry disappears from here when the schema grows the column
 * and the adapter starts reading it.
 */
const TRACK_FIELDS_WITHOUT_COLUMNS = {
  energy: null,
  genre: null,
  year: null,
  durationSeconds: null,
  rating: null,
  comment: "",
  source: null,
  hasStems: false,
  /**
   * Empty rather than guessed. `ProvenanceMark` renders nothing for an absent
   * entry, so every metadata row simply shows no origin — which is true: the
   * API records no per-field provenance yet.
   */
  provenance: {},
} as const satisfies Partial<WorkspaceTrack>;

export function adaptTrack(dto: TrackDto): WorkspaceTrack {
  return {
    ...TRACK_FIELDS_WITHOUT_COLUMNS,
    id: dto.id,
    title: dto.title,
    artist: dto.artist,
    bpm: dto.bpm,
    keySignature: dto.keySignature,
    tags: dto.tags,
  };
}

/** The abbreviated track a graph node carries is a subset of the full one. */
export function adaptNodeTrack(dto: GraphNodeDto["track"]): WorkspaceTrack {
  return adaptTrack(dto);
}

export function adaptNode(dto: GraphNodeDto): WorkspaceGraphNode {
  return { id: dto.id, trackId: dto.trackId, x: dto.x, y: dto.y };
}

export function adaptTransition(dto: TransitionDto): WorkspaceTransition {
  return {
    id: dto.id,
    // The API names the endpoints by direction of travel; the graph model names
    // them by their role as edge endpoints. Same edge, two vocabularies.
    sourceTrackId: dto.fromTrackId,
    targetTrackId: dto.toTrackId,
    technique: dto.technique,
    tags: dto.tags,
    notes: dto.notes ?? "",
    // `score` is the deterministic ranking the domain produced at authoring
    // time — the same quantity `confidence` renders.
    confidence: dto.score,
    // No column for any of these yet.
    bars: null,
    mixOutCueId: null,
    mixInCueId: null,
    fx: [],
    warnings: [],
    // Every transition the API can currently return was authored by a person:
    // there is no AI write path (plan §14 is deferred). This is a fact about
    // today's API, not a default — when suggestions can be persisted they will
    // arrive with an origin of their own.
    origin: "manual",
    provenance: "manual",
  };
}

export interface AdaptedGraph {
  readonly graphId: string;
  readonly graphVersion: number;
  readonly nodes: readonly WorkspaceGraphNode[];
  readonly transitions: readonly WorkspaceTransition[];
  /**
   * Tracks carried inline by the graph's own nodes.
   *
   * The library fetches the full page separately, but the canvas must not wait
   * on it — a node whose track is missing from the store renders as nothing at
   * all. These are merged in first so the graph is complete on its own.
   */
  readonly nodeTracks: readonly WorkspaceTrack[];
}

export function adaptGraph(detail: GraphDetail): AdaptedGraph {
  return {
    graphId: detail.graph.id,
    graphVersion: detail.graph.version,
    nodes: detail.nodes.map(adaptNode),
    transitions: detail.transitions.map(adaptTransition),
    nodeTracks: detail.nodes.map((node) => adaptNodeTrack(node.track)),
  };
}

/**
 * Merges two track lists, preferring the first.
 *
 * The graph's inline tracks and the library page overlap, and the library's
 * copy is the fuller one — it is the same row read through the same schema,
 * but fetching it is what makes a track filterable. Order is preserved so the
 * library's own sort is not disturbed.
 */
export function mergeTracks(
  preferred: readonly WorkspaceTrack[],
  additional: readonly WorkspaceTrack[],
): WorkspaceTrack[] {
  const seen = new Set(preferred.map((track) => track.id));
  return [...preferred, ...additional.filter((track) => !seen.has(track.id))];
}
