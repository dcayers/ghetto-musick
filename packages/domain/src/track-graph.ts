import DirectedGraph from "graphology";
import { rankCandidates, scoreTransition, type ScorableTrack, type TransitionScoreOptions } from "./transition-score.js";

/**
 * The planning graph — plan §9.3.
 *
 * graphology owns the authoritative structure; React Flow renders a
 * projection of it. That separation is what makes path-finding, filtering,
 * and scoring pure functions testable without a DOM, and it is the escape
 * hatch if the canvas ever has to move to a WebGL renderer (plan §9.4).
 *
 * It also removes a whole bug class by construction. The prototype this
 * replaced stored connection tags in two places — a `musicConnections` array
 * and inside `edges[].data` — and hand-synced them on every mutation. With a
 * single graph instance that desync is not expressible.
 */

export interface TransitionAttributes {
  readonly id: string;
  readonly technique?: string;
  readonly tags?: readonly string[];
  /** Confidence in this transition, 0–1. Null when none is recorded. */
  readonly confidence?: number | null;
}

export type TrackGraph = DirectedGraph<ScorableTrack, TransitionAttributes>;

export function createTrackGraph(): TrackGraph {
  // Directed: plan §7.2 — an A→B transition is not automatically valid as B→A.
  //
  // `multi: true` because the unique constraint on the Transition model is
  // `(workspaceId, fromTrackId, toTrackId, technique)` — technique is part of
  // the key, so the database has always allowed several transitions between
  // the same ordered pair, one per technique. A long blend and an echo out
  // from A into B are two different routes, which is the whole premise of
  // planning on a graph rather than in a list. A single-edge model silently
  // dropped all but the last one on the canvas.
  //
  // Self-loops stay banned: a track does not mix into itself.
  return new DirectedGraph<ScorableTrack, TransitionAttributes>({
    type: "directed",
    multi: true,
    allowSelfLoops: false,
  });
}

export interface TransitionInput {
  readonly id: string;
  readonly sourceTrackId: string;
  readonly targetTrackId: string;
  readonly technique?: string;
  readonly tags?: readonly string[];
  readonly confidence?: number | null;
}

/**
 * Builds a graph from tracks and transitions.
 *
 * Transitions referencing an absent track are skipped rather than throwing.
 * Imports are partial by nature — a Serato scan can reference a file that has
 * not been reconciled yet — and a single dangling edge must not fail the
 * whole canvas.
 */
export function buildTrackGraph(
  tracks: readonly ScorableTrack[],
  transitions: readonly TransitionInput[] = [],
): TrackGraph {
  const graph = createTrackGraph();

  for (const track of tracks) {
    graph.mergeNode(track.id, track);
  }

  for (const transition of transitions) {
    if (!graph.hasNode(transition.sourceTrackId) || !graph.hasNode(transition.targetTrackId)) {
      continue;
    }
    if (transition.sourceTrackId === transition.targetTrackId) {
      continue;
    }

    // Keyed on the transition id, not on the pair. On a multi graph an
    // unkeyed merge would add a second parallel edge every time the same
    // transition was rebuilt; keying it means re-merging the same transition
    // updates in place while a genuinely different one gets its own edge.
    graph.mergeDirectedEdgeWithKey(transition.id, transition.sourceTrackId, transition.targetTrackId, {
      id: transition.id,
      ...(transition.technique !== undefined ? { technique: transition.technique } : {}),
      ...(transition.tags !== undefined ? { tags: transition.tags } : {}),
      // Null and undefined both mean "no score recorded", and the attribute
      // is optional, so absence is the one representation of it.
      ...(transition.confidence != null ? { confidence: transition.confidence } : {}),
    });
  }

  return graph;
}

/** Tracks reachable from `trackId` via an authored transition. */
export function authoredNextTracks(graph: TrackGraph, trackId: string): ScorableTrack[] {
  if (!graph.hasNode(trackId)) return [];

  return graph
    .outNeighbors(trackId)
    .map((neighbor) => graph.getNodeAttributes(neighbor))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export interface SuggestOptions extends TransitionScoreOptions {
  readonly limit?: number;
  /** Exclude these ids — typically tracks already used in the set. */
  readonly exclude?: readonly string[];
  /** Minimum overall score to include. Default 0. */
  readonly minScore?: number;
}

/**
 * Suggests next tracks from anywhere in the library, ranked by score.
 *
 * Considers every node, not just authored neighbours: the point is to surface
 * transitions the DJ has not thought of yet. Use `authoredNextTracks` when
 * only existing, deliberate transitions should be offered.
 */
export function suggestNext(
  graph: TrackGraph,
  trackId: string,
  options: SuggestOptions = {},
) {
  if (!graph.hasNode(trackId)) return [];

  const from = graph.getNodeAttributes(trackId);
  const excluded = new Set([trackId, ...(options.exclude ?? [])]);
  const minScore = options.minScore ?? 0;

  const candidates = graph
    .nodes()
    .filter((node) => !excluded.has(node))
    .map((node) => graph.getNodeAttributes(node));

  const ranked = rankCandidates(from, candidates, options).filter(
    (candidate) => candidate.score.overall >= minScore,
  );

  return options.limit === undefined ? ranked : ranked.slice(0, options.limit);
}

export interface PathOptions extends TransitionScoreOptions {
  /** Maximum tracks in the path, including both endpoints. Default 8. */
  readonly maxLength?: number;
}

/**
 * Finds the highest-scoring path between two tracks.
 *
 * A set is a path through the graph (plan §1), so "get me from this opener to
 * this closer" is the literal question a DJ asks. Uses Dijkstra over an edge
 * cost of `1 - score`, so maximising total compatibility becomes minimising
 * total cost.
 *
 * Searches all pairs rather than only authored transitions, since the useful
 * answer usually includes tracks the DJ has not connected yet. Bounded by
 * `maxLength` because unbounded search over a full library is both slow and
 * musically pointless.
 *
 * Known limitation: the hop bound makes this approximate rather than optimal.
 * Dijkstra records hop count along the *cheapest* route to each node, so a
 * marginally more expensive route that would have fit inside `maxLength` can
 * be missed. The result is never invalid — the final length check enforces the
 * bound — but it is not guaranteed to be the best path of that length. Good
 * enough for suggesting a bridge; revisit with a proper k-shortest-paths
 * search if set generation starts depending on optimality.
 */
export function findBestPath(
  graph: TrackGraph,
  fromId: string,
  toId: string,
  options: PathOptions = {},
): { path: ScorableTrack[]; totalScore: number } | null {
  if (!graph.hasNode(fromId) || !graph.hasNode(toId)) return null;
  if (fromId === toId) {
    return { path: [graph.getNodeAttributes(fromId)], totalScore: 0 };
  }

  const maxLength = options.maxLength ?? 8;
  const nodes = graph.nodes();

  const cost = new Map<string, number>();
  const previous = new Map<string, string>();
  const hops = new Map<string, number>();
  const visited = new Set<string>();

  for (const node of nodes) {
    cost.set(node, Number.POSITIVE_INFINITY);
  }
  cost.set(fromId, 0);
  hops.set(fromId, 1);

  while (visited.size < nodes.length) {
    // Linear scan for the cheapest unvisited node. Fine at planning scale
    // (§3.5 targets 1k nodes); swap for a binary heap if profiling says so.
    let current: string | null = null;
    let currentCost = Number.POSITIVE_INFINITY;

    for (const node of nodes) {
      if (visited.has(node)) continue;
      const nodeCost = cost.get(node) ?? Number.POSITIVE_INFINITY;
      if (nodeCost < currentCost) {
        current = node;
        currentCost = nodeCost;
      }
    }

    if (current === null || currentCost === Number.POSITIVE_INFINITY) break;
    if (current === toId) break;

    visited.add(current);

    const currentHops = hops.get(current) ?? 1;
    if (currentHops >= maxLength) continue;

    const fromTrack = graph.getNodeAttributes(current);

    for (const candidate of nodes) {
      if (visited.has(candidate) || candidate === current) continue;

      const toTrack = graph.getNodeAttributes(candidate);
      const score = scoreTransition(fromTrack, toTrack, options).overall;
      const edgeCost = 1 - score;
      const nextCost = currentCost + edgeCost;

      if (nextCost < (cost.get(candidate) ?? Number.POSITIVE_INFINITY)) {
        cost.set(candidate, nextCost);
        previous.set(candidate, current);
        hops.set(candidate, currentHops + 1);
      }
    }
  }

  const finalCost = cost.get(toId);
  if (finalCost === undefined || finalCost === Number.POSITIVE_INFINITY) return null;

  const path: ScorableTrack[] = [];
  let cursor: string | undefined = toId;
  while (cursor !== undefined) {
    path.unshift(graph.getNodeAttributes(cursor));
    cursor = previous.get(cursor);
  }

  if (path.length > maxLength) return null;

  // Total cost is (hops × 1) − (sum of scores), so recover the mean score.
  const edgeCount = path.length - 1;
  const totalScore = edgeCount === 0 ? 0 : (edgeCount - finalCost) / edgeCount;

  return { path, totalScore };
}
