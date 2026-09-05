import type {
  WorkspaceGraphNode,
  WorkspaceSet,
  WorkspaceTrack,
  WorkspaceTransition,
} from "../lib/workspace-data.js";

/**
 * A synthetic graph at the §9.4 gate size.
 *
 * Deterministic, so two runs measure the same scene and a change in the
 * numbers is a change in the code. Shaped rather than random: a real planning
 * graph is a sparse mesh with local clusters, and a uniformly random one is
 * both easier to cull and harder to pan through than anything a DJ would
 * build, which would make the measurement flattering in one direction and
 * pessimistic in the other.
 */

const TECHNIQUES = [
  "long-blend",
  "blend",
  "filter-sweep",
  "echo-out",
  "loop-build",
  "cut",
] as const;

const GENRES = ["Melodic House", "Techno", "Progressive House", "Deep House"] as const;

/** Mulberry32 — small, fast, deterministic. */
function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticGraph {
  readonly tracks: WorkspaceTrack[];
  readonly nodes: WorkspaceGraphNode[];
  readonly transitions: WorkspaceTransition[];
  readonly set: WorkspaceSet;
}

/**
 * `nodeCount` nodes and up to `edgeCount` transitions.
 *
 * Edges are drawn between nearby nodes in the grid rather than at random. That
 * matters for the measurement: React Flow renders each edge as an SVG path
 * whose bounding box grows with the distance between its endpoints, and
 * long-range edges stay on screen — and in the render tree — far longer than a
 * plausible graph's would.
 */
export function generateGraph(nodeCount = 1000, edgeCount = 3000): SyntheticGraph {
  const random = rng(0xf10c6a);

  const columns = Math.ceil(Math.sqrt(nodeCount));
  const COLUMN_WIDTH = 260;
  const ROW_HEIGHT = 180;

  const tracks: WorkspaceTrack[] = [];
  const nodes: WorkspaceGraphNode[] = [];

  for (let index = 0; index < nodeCount; index += 1) {
    const id = `perf-track-${index}`;
    const column = index % columns;
    const row = Math.floor(index / columns);

    tracks.push({
      id,
      title: `Synthetic Track ${index}`,
      artist: `Artist ${index % 120}`,
      bpm: 118 + Math.floor(random() * 14),
      keySignature: `${1 + Math.floor(random() * 12)}${random() > 0.35 ? "A" : "B"}`,
      album: null,
      energy: 1 + Math.floor(random() * 5),
      genre: GENRES[index % GENRES.length] ?? null,
      year: 2014 + Math.floor(random() * 12),
      durationSeconds: 300 + Math.floor(random() * 240),
      rating: 1 + Math.floor(random() * 5),
      comment: "",
      tags: [],
      source: random() > 0.25 ? "local" : "streaming",
      hasStems: random() > 0.8,
      provenance: {},
    });

    nodes.push({
      id: `perf-node-${index}`,
      trackId: id,
      // Jittered off the lattice so the scene is not pathologically regular,
      // which would let the browser batch work it could not batch in practice.
      x: column * COLUMN_WIDTH + Math.round(random() * 60 - 30),
      y: row * ROW_HEIGHT + Math.round(random() * 40 - 20),
    });
  }

  const transitions: WorkspaceTransition[] = [];
  const seen = new Set<string>();
  // One edge per ordered pair and no self-loops, matching what
  // `buildTrackGraph` enforces — otherwise the model would silently drop
  // edges and the render would be measured against a smaller graph than the
  // one this claims to build.
  const fanOut = Math.max(1, Math.ceil(edgeCount / Math.max(1, nodeCount)));

  for (let index = 0; index < nodeCount && transitions.length < edgeCount; index += 1) {
    for (let step = 1; step <= fanOut && transitions.length < edgeCount; step += 1) {
      // Neighbours: the next node, the one below in the grid, and a short hop.
      const offsets = [1, columns, columns + 1, 2];
      const target = index + (offsets[(step - 1) % offsets.length] ?? 1);
      if (target >= nodeCount || target === index) continue;

      const key = `${index}->${target}`;
      if (seen.has(key)) continue;
      seen.add(key);

      transitions.push({
        id: `perf-tx-${transitions.length}`,
        sourceTrackId: `perf-track-${index}`,
        targetTrackId: `perf-track-${target}`,
        technique: TECHNIQUES[transitions.length % TECHNIQUES.length] ?? "blend",
        confidence: Math.round(random() * 100) / 100,
        bars: 16,
        mixOutCueId: null,
        mixInCueId: null,
        notes: "",
        origin: "manual",
        provenance: "manual",
        warnings: [],
        fx: [],
        tags: [],
      });
    }
  }

  return {
    tracks,
    nodes,
    transitions,
    // A set spanning part of the graph, so the "in active set" highlighting
    // and set-position badges are exercised rather than skipped.
    set: {
      id: "perf-set",
      name: "Synthetic set",
      items: Array.from({ length: Math.min(40, nodeCount) }, (_, index) => ({
        id: `perf-item-${index}`,
        trackId: `perf-track-${index}`,
      })),
      targetBpm: 124,
      targetKey: "8A",
    },
  };
}
