import type { Graph, GraphNode, Track, Transition } from "@flowgraph/db";
import {
  scoreTransition,
  rankCandidates,
  buildTrackGraph,
  TRANSITION_ALGORITHM_VERSION,
  type ScorableTrack,
} from "@flowgraph/domain";
import type {
  AddGraphNodeInput,
  CreateGraphInput,
  CreateTransitionInput,
  GraphDetail,
  GraphNodeDto,
  TransitionDto,
  TransitionSuggestion,
  UpdateLayoutInput,
} from "@flowgraph/contracts";
import type { GraphNodeWithTrack, GraphRepository } from "./graph.repository.js";

/**
 * Graph domain service.
 *
 * Where persistence meets `@flowgraph/domain`. The scoring itself is pure and
 * lives in the domain package (Camelot relations, tempo windows, weighted
 * components); this layer only feeds it rows and stores the result.
 *
 * Plain class, plain interfaces, no framework types — ADR-0002 rule 3.
 */

export class SelfTransitionError extends Error {
  constructor() {
    super("A transition cannot start and end on the same track");
    this.name = "SelfTransitionError";
  }
}

export class GraphNotFoundError extends Error {
  constructor(readonly graphId: string) {
    super(`Graph ${graphId} not found`);
    this.name = "GraphNotFoundError";
  }
}

export class TrackNotInWorkspaceError extends Error {
  constructor() {
    super("Track does not exist in this workspace");
    this.name = "TrackNotInWorkspaceError";
  }
}

export class GraphService {
  constructor(private readonly repository: GraphRepository) {}

  async listGraphs(workspaceId: string) {
    return (await this.repository.listGraphs(workspaceId)).map(toGraphDto);
  }

  async createGraph(workspaceId: string, input: CreateGraphInput) {
    return toGraphDto(await this.repository.createGraph(workspaceId, input));
  }

  /** Everything the canvas needs in one round trip — plan §9.8. */
  async getGraphDetail(workspaceId: string, graphId: string): Promise<GraphDetail> {
    const graph = await this.repository.findGraph(workspaceId, graphId);
    if (!graph) throw new GraphNotFoundError(graphId);

    const [nodes, transitions] = await Promise.all([
      this.repository.listNodes(workspaceId, graphId),
      this.repository.listTransitions(workspaceId),
    ]);

    const nodeTrackIds = new Set(nodes.map((node) => node.trackId));

    return {
      graph: toGraphDto(graph),
      nodes: nodes.map(toNodeDto),
      // Only transitions whose endpoints are both on this canvas. A workspace
      // transition between two tracks that are not placed here has nothing to
      // draw between.
      transitions: transitions
        .filter((t) => nodeTrackIds.has(t.fromTrackId) && nodeTrackIds.has(t.toTrackId))
        .map(toTransitionDto),
    };
  }

  async addNode(
    workspaceId: string,
    graphId: string,
    input: AddGraphNodeInput,
  ): Promise<GraphNodeDto> {
    const node = await this.repository.addNode(workspaceId, graphId, input);
    if (!node) throw new TrackNotInWorkspaceError();
    return toNodeDto(node);
  }

  async removeNode(workspaceId: string, graphId: string, nodeId: string): Promise<void> {
    const removed = await this.repository.removeNode(workspaceId, graphId, nodeId);
    if (!removed) throw new GraphNotFoundError(graphId);
  }

  async updateLayout(workspaceId: string, graphId: string, input: UpdateLayoutInput) {
    const graph = await this.repository.updateLayout(workspaceId, graphId, input);
    if (!graph) throw new GraphNotFoundError(graphId);
    return toGraphDto(graph);
  }

  /**
   * Creates a transition, scoring it deterministically at authoring time.
   *
   * The score is a snapshot with its algorithm version (plan §10.4), not a
   * live computation: a later weights change must not silently reinterpret
   * transitions the user already authored and reasoned about.
   */
  async createTransition(
    workspaceId: string,
    input: CreateTransitionInput,
  ): Promise<TransitionDto> {
    if (input.fromTrackId === input.toTrackId) throw new SelfTransitionError();

    const tracks = await this.repository.listTracksForScoring(workspaceId);
    const byId = new Map(tracks.map((track) => [track.id, track]));

    const from = byId.get(input.fromTrackId);
    const to = byId.get(input.toTrackId);
    if (!from || !to) throw new TrackNotInWorkspaceError();

    const scored = scoreTransition(toScorable(from), toScorable(to));

    const transition = await this.repository.createTransition(workspaceId, input, {
      value: scored.overall,
      algorithmVersion: scored.algorithmVersion,
    });
    if (!transition) throw new TrackNotInWorkspaceError();

    return toTransitionDto(transition);
  }

  async deleteTransition(workspaceId: string, transitionId: string): Promise<void> {
    const deleted = await this.repository.deleteTransition(workspaceId, transitionId);
    if (!deleted) throw new GraphNotFoundError(transitionId);
  }

  /**
   * Ranks candidate next-tracks from the whole library.
   *
   * Considers every track rather than only authored neighbours — the point is
   * surfacing transitions the DJ has not thought of yet (plan §10.1). This is
   * also the deterministic candidate-filtering stage the AI pipeline consumes
   * (§14.2): the model selects among these, it does not compute them.
   */
  async suggestTransitions(
    workspaceId: string,
    fromTrackId: string,
    limit: number,
  ): Promise<TransitionSuggestion[]> {
    const tracks = await this.repository.listTracksForScoring(workspaceId);
    const from = tracks.find((track) => track.id === fromTrackId);
    if (!from) throw new TrackNotInWorkspaceError();

    // graphology owns the model; the ranking is pure domain code.
    const graph = buildTrackGraph(tracks.map(toScorable));
    void graph;

    return rankCandidates(
      toScorable(from),
      tracks.filter((track) => track.id !== fromTrackId).map(toScorable),
    )
      .slice(0, limit)
      .map((candidate) => {
        const track = tracks.find((t) => t.id === candidate.track.id)!;
        return {
          track: toTrackDto(track),
          score: candidate.score.overall,
          algorithmVersion: candidate.score.algorithmVersion,
          harmonicRelation: candidate.score.harmonicRelation,
          pitchAdjustment: candidate.score.pitchAdjustment,
          warnings: [...candidate.score.warnings],
        };
      });
  }
}

// --- Mapping ----------------------------------------------------------------

/**
 * Prisma row to the domain's minimal scorable shape.
 *
 * `bpm` is Decimal on the way out and must become a number; energy has no
 * column yet (it arrives with audio analysis), so it is explicitly null
 * rather than defaulted — the scorer treats unknown as inapplicable, not bad.
 */
function toScorable(track: Track): ScorableTrack {
  return {
    id: track.id,
    bpm: track.bpm === null ? null : Number(track.bpm),
    keySignature: track.keySignature,
    tags: track.tags,
    energy: null,
  };
}

function toGraphDto(graph: Graph) {
  return {
    id: graph.id,
    workspaceId: graph.workspaceId,
    name: graph.name,
    version: graph.version,
    createdAt: graph.createdAt.toISOString(),
    updatedAt: graph.updatedAt.toISOString(),
  };
}

function toNodeDto(node: GraphNodeWithTrack): GraphNodeDto {
  return {
    id: node.id,
    trackId: node.trackId,
    x: node.x,
    y: node.y,
    track: toTrackDto(node.track),
  };
}

function toTransitionDto(transition: Transition): TransitionDto {
  return {
    id: transition.id,
    workspaceId: transition.workspaceId,
    fromTrackId: transition.fromTrackId,
    toTrackId: transition.toTrackId,
    technique: transition.technique,
    notes: transition.notes,
    tags: transition.tags,
    score: transition.score === null ? null : Number(transition.score),
    scoreAlgorithm: transition.scoreAlgorithm,
    createdAt: transition.createdAt.toISOString(),
    updatedAt: transition.updatedAt.toISOString(),
  };
}

function toTrackDto(track: Track) {
  return {
    id: track.id,
    workspaceId: track.workspaceId,
    title: track.title,
    artist: track.artist,
    bpm: track.bpm === null ? null : Number(track.bpm),
    keySignature: track.keySignature,
    timeSignature: track.timeSignature,
    tags: track.tags,
    version: track.version,
    createdAt: track.createdAt.toISOString(),
    updatedAt: track.updatedAt.toISOString(),
  };
}

export { TRANSITION_ALGORITHM_VERSION };
export type { GraphNode };
