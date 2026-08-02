import type { PrismaClient, Graph, GraphNode, Track, Transition } from "@flowgraph/db";
import type {
  AddGraphNodeInput,
  CreateGraphInput,
  CreateTransitionInput,
  UpdateLayoutInput,
} from "@flowgraph/contracts";
import { newId } from "@flowgraph/contracts";

/**
 * Graph and transition persistence.
 *
 * Prisma appears here and nowhere above (ADR-0008), and every method takes
 * `workspaceId` positionally so it cannot be forgotten (plan §16.2).
 */

export class GraphVersionConflictError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`Graph version ${expected} is stale; current is ${actual}`);
    this.name = "GraphVersionConflictError";
  }
}

export type GraphNodeWithTrack = GraphNode & { track: Track };

export class GraphRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listGraphs(workspaceId: string): Promise<Graph[]> {
    return this.prisma.graph.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }

  async createGraph(workspaceId: string, input: CreateGraphInput): Promise<Graph> {
    return this.prisma.graph.create({
      data: { id: newId(), workspaceId, name: input.name },
    });
  }

  async findGraph(workspaceId: string, graphId: string): Promise<Graph | null> {
    return this.prisma.graph.findFirst({ where: { id: graphId, workspaceId } });
  }

  async listNodes(workspaceId: string, graphId: string): Promise<GraphNodeWithTrack[]> {
    return this.prisma.graphNode.findMany({
      // Scoped through the graph's workspace, not just by graphId — otherwise
      // a known graph id from another workspace would read its nodes.
      where: { graphId, graph: { workspaceId } },
      include: { track: true },
      orderBy: { createdAt: "asc" },
    });
  }

  async addNode(
    workspaceId: string,
    graphId: string,
    input: AddGraphNodeInput,
  ): Promise<GraphNodeWithTrack | null> {
    // Both the graph and the track must belong to the caller's workspace.
    const [graph, track] = await Promise.all([
      this.prisma.graph.findFirst({ where: { id: graphId, workspaceId } }),
      this.prisma.track.findFirst({
        where: { id: input.trackId, workspaceId, deletedAt: null },
      }),
    ]);

    if (!graph || !track) return null;

    // Decision 16 forbids duplicates, so re-adding a track is idempotent
    // rather than an error — dropping the same track twice on the canvas is
    // a slip, not something to interrupt the user over.
    return this.prisma.graphNode.upsert({
      where: { graphId_trackId: { graphId, trackId: input.trackId } },
      create: { id: newId(), graphId, trackId: input.trackId, x: input.x, y: input.y },
      update: {},
      include: { track: true },
    });
  }

  async removeNode(
    workspaceId: string,
    graphId: string,
    nodeId: string,
  ): Promise<boolean> {
    // Delete-from-graph, never delete-from-library — plan §10.1.
    const { count } = await this.prisma.graphNode.deleteMany({
      where: { id: nodeId, graphId, graph: { workspaceId } },
    });
    return count > 0;
  }

  /**
   * Applies a bounded batch of positions under optimistic concurrency.
   *
   * One transaction: a partially-applied layout would leave the canvas in a
   * state neither client asked for. The version bump and the writes must
   * land together or not at all.
   */
  async updateLayout(
    workspaceId: string,
    graphId: string,
    input: UpdateLayoutInput,
  ): Promise<Graph | null> {
    return this.prisma.$transaction(async (tx) => {
      const graph = await tx.graph.findFirst({ where: { id: graphId, workspaceId } });
      if (!graph) return null;

      if (graph.version !== input.expectedVersion) {
        throw new GraphVersionConflictError(input.expectedVersion, graph.version);
      }

      for (const position of input.positions) {
        await tx.graphNode.updateMany({
          where: { id: position.id, graphId },
          data: { x: position.x, y: position.y },
        });
      }

      return tx.graph.update({
        where: { id: graphId },
        data: { version: { increment: 1 } },
      });
    });
  }

  async listTransitions(workspaceId: string): Promise<Transition[]> {
    return this.prisma.transition.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
  }

  async createTransition(
    workspaceId: string,
    input: CreateTransitionInput,
    score: { value: number; algorithmVersion: number } | null,
  ): Promise<Transition | null> {
    const tracks = await this.prisma.track.findMany({
      where: { workspaceId, deletedAt: null, id: { in: [input.fromTrackId, input.toTrackId] } },
      select: { id: true },
    });

    // Both endpoints must exist in this workspace. A self-loop is rejected by
    // the service before reaching here.
    if (tracks.length !== new Set([input.fromTrackId, input.toTrackId]).size) return null;

    return this.prisma.transition.upsert({
      where: {
        workspaceId_fromTrackId_toTrackId_technique: {
          workspaceId,
          fromTrackId: input.fromTrackId,
          toTrackId: input.toTrackId,
          technique: input.technique,
        },
      },
      create: {
        id: newId(),
        workspaceId,
        fromTrackId: input.fromTrackId,
        toTrackId: input.toTrackId,
        technique: input.technique,
        notes: input.notes ?? null,
        tags: input.tags,
        score: score?.value ?? null,
        scoreAlgorithm: score?.algorithmVersion ?? null,
      },
      // Re-drawing an existing edge revives it rather than erroring.
      update: { deletedAt: null, tags: input.tags, notes: input.notes ?? null },
    });
  }

  async deleteTransition(workspaceId: string, transitionId: string): Promise<boolean> {
    const { count } = await this.prisma.transition.updateMany({
      where: { id: transitionId, workspaceId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return count > 0;
  }

  async listTracksForScoring(workspaceId: string): Promise<Track[]> {
    return this.prisma.track.findMany({ where: { workspaceId, deletedAt: null } });
  }
}
