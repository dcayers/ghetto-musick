import type { PrismaClient, Track } from "@flowgraph/db";
import type { CreateTrackInput, ListTracksQuery } from "@flowgraph/contracts";
import { newId } from "@flowgraph/contracts";

/**
 * Track persistence.
 *
 * Prisma appears here and nowhere above this layer (ADR-0008). No framework
 * imports — enforced by the ESLint boundary rule, since this is not a
 * controller.
 *
 * Every method takes `workspaceId` as a required first argument. Plan §16.2:
 * repository queries are scoped at the query, never fetched-then-authorized.
 * Making it positional means you cannot forget it.
 */
export class TrackRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(workspaceId: string, input: CreateTrackInput): Promise<Track> {
    return this.prisma.track.create({
      data: {
        id: newId(),
        workspaceId,
        title: input.title,
        artist: input.artist,
        bpm: input.bpm ?? null,
        keySignature: input.keySignature ?? null,
        timeSignature: input.timeSignature ?? null,
        tags: input.tags,
      },
    });
  }

  async findById(workspaceId: string, trackId: string): Promise<Track | null> {
    return this.prisma.track.findFirst({
      where: { id: trackId, workspaceId, deletedAt: null },
    });
  }

  /**
   * Cursor pagination over (createdAt DESC, id DESC).
   *
   * UUIDv7 is time-ordered (ADR-0003), so the pair is a total ordering and the
   * id alone is a sufficient cursor — matching the composite index declared on
   * the model.
   */
  async list(
    workspaceId: string,
    query: ListTracksQuery,
  ): Promise<{ items: Track[]; nextCursor: string | null }> {
    const items = await this.prisma.track.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        ...(query.query
          ? {
              OR: [
                { title: { contains: query.query, mode: "insensitive" as const } },
                { artist: { contains: query.query, mode: "insensitive" as const } },
              ],
            }
          : {}),
        ...(query.bpmMin !== undefined || query.bpmMax !== undefined
          ? {
              bpm: {
                ...(query.bpmMin !== undefined ? { gte: query.bpmMin } : {}),
                ...(query.bpmMax !== undefined ? { lte: query.bpmMax } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = items.length > query.limit;
    const page = hasMore ? items.slice(0, query.limit) : items;
    const last = page.at(-1);

    return {
      items: page,
      nextCursor: hasMore && last ? last.id : null,
    };
  }

  async countForWorkspace(workspaceId: string): Promise<number> {
    return this.prisma.track.count({ where: { workspaceId, deletedAt: null } });
  }
}
