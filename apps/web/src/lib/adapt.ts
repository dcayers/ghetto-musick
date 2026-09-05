import type { Track as TrackDto } from "@flowgraph/api-client";

import type { GraphDetail, GraphNodeDto, TransitionDto } from "./graph-api.js";
import type { SetDetail, SetItemDto } from "./set-api.js";
import type {
  WorkspaceGraphNode,
  WorkspaceSet,
  WorkspaceSetItem,
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
 * Fields the `Track` table still has no column for.
 *
 * A to-do list as much as a default: each entry disappears from here when the
 * schema grows the column and the adapter starts reading it. `genre`,
 * `durationSeconds`, and `source` left this list when the Serato import landed
 * — they now come from the API.
 *
 * `energy` and `rating` await audio analysis and a rating control; `year` has
 * no source, since Serato does not store one.
 */
const TRACK_FIELDS_WITHOUT_COLUMNS = {
  energy: null,
  year: null,
  rating: null,
  comment: "",
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
    album: dto.album,
    genre: dto.genre,
    durationSeconds: dto.durationSeconds,
    // `local` / `streaming` / `missing`, or null for a track with neither a
    // file nor a provider — one typed in by hand.
    source: dto.source,
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
 * Merges two track lists, preferring the first, keeping one entry per id.
 *
 * The graph's inline tracks, the set's inline tracks, and the library page all
 * overlap. Order is preserved so the library's own sort is not disturbed.
 *
 * Deduplication spans *both* inputs rather than filtering the second against
 * the first. A set may hold the same track twice (§10.4 calls these
 * occurrences), so its inline tracks legitimately repeat — and an earlier
 * version that only screened `additional` let those repeats through, which
 * showed the track twice in the library and gave React two children with the
 * same key. A track list is a set of tracks; a running order is where
 * repetition means something.
 */
export function mergeTracks(
  preferred: readonly WorkspaceTrack[],
  additional: readonly WorkspaceTrack[],
): WorkspaceTrack[] {
  const seen = new Set<string>();
  const merged: WorkspaceTrack[] = [];
  for (const track of [...preferred, ...additional]) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    merged.push(track);
  }
  return merged;
}

/* ------------------------------------------------------------------ sets -- */

export function adaptSetItem(dto: SetItemDto): WorkspaceSetItem {
  // `rank` is deliberately dropped. It is the server's ordering mechanism, and
  // the API already returns items in rank order — carrying it into the client
  // would invite code that sorts or, worse, generates one.
  return { id: dto.id, trackId: dto.trackId };
}

export interface AdaptedSet {
  readonly set: WorkspaceSet;
  /**
   * Tracks carried inline by the set's own items.
   *
   * Same reason as the graph's: an item whose track is missing from the store
   * renders as a gap, so the timeline must not depend on the library page
   * having arrived.
   */
  readonly itemTracks: readonly WorkspaceTrack[];
}

export function adaptSet(detail: SetDetail): AdaptedSet {
  return {
    set: {
      id: detail.set.id,
      name: detail.set.name,
      items: detail.items.map(adaptSetItem),
      targetBpm: detail.set.targetBpm,
      targetKey: detail.set.targetKey,
    },
    itemTracks: detail.items.map((item) => adaptTrack(item.track)),
  };
}
