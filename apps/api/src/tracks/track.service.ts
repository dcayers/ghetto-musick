import type { Track } from "@flowgraph/db";
import type { CreateTrackInput, ListTracksQuery, TrackDto } from "@flowgraph/contracts";
import type { TrackRepository } from "./track.repository.js";

/**
 * Track domain service.
 *
 * Plain class, plain interfaces, no framework types — ADR-0002 rule 3. The
 * controller translates HTTP into these calls and translates the results back.
 * That is what keeps the Rikta exit path cheap.
 */

export class TrackNotFoundError extends Error {
  constructor(public readonly trackId: string) {
    super(`Track ${trackId} not found`);
    this.name = "TrackNotFoundError";
  }
}

export interface TrackPage {
  items: TrackDto[];
  nextCursor: string | null;
}

export class TrackService {
  constructor(private readonly repository: TrackRepository) {}

  async create(workspaceId: string, input: CreateTrackInput): Promise<TrackDto> {
    const track = await this.repository.create(workspaceId, input);
    return toDto(track);
  }

  async getById(workspaceId: string, trackId: string): Promise<TrackDto> {
    const track = await this.repository.findById(workspaceId, trackId);
    if (!track) {
      throw new TrackNotFoundError(trackId);
    }
    return toDto(track);
  }

  async list(workspaceId: string, query: ListTracksQuery): Promise<TrackPage> {
    const { items, nextCursor } = await this.repository.list(workspaceId, query);
    return { items: items.map(toDto), nextCursor };
  }
}

/**
 * Prisma `Decimal` does not survive JSON serialization as a number, and
 * `Date` serializes inconsistently across boundaries. Normalize once here so
 * the wire format always matches `trackSchema`.
 */
function toDto(track: Track): TrackDto {
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
