import type { Set as SetRecord, Track } from "@flowgraph/db";
import { rankBetween, rankForMove } from "@flowgraph/domain";
import type {
  AddSetItemInput,
  CreateSetInput,
  ReorderSetItemInput,
  SetDetail,
  SetDto,
  SetItemDto,
  UpdateSetInput,
} from "@flowgraph/contracts";
import type { SetItemWithTrack, SetRepository } from "./set.repository.js";

/**
 * Set domain service.
 *
 * Where persistence meets `@flowgraph/domain`. Rank arithmetic is pure and
 * lives in the domain package; this layer decides which neighbours a new rank
 * sits between and stores the result.
 *
 * Plain class, plain interfaces, no framework types — ADR-0002 rule 3.
 */

export class SetNotFoundError extends Error {
  constructor(readonly setId: string) {
    super(`Set ${setId} not found`);
    this.name = "SetNotFoundError";
  }
}

export class SetItemNotFoundError extends Error {
  constructor(readonly itemId: string) {
    super(`Set item ${itemId} not found`);
    this.name = "SetItemNotFoundError";
  }
}

export class TrackNotInWorkspaceError extends Error {
  constructor() {
    super("Track does not exist in this workspace");
    this.name = "TrackNotInWorkspaceError";
  }
}

export class SetService {
  constructor(private readonly repository: SetRepository) {}

  async listSets(workspaceId: string): Promise<SetDto[]> {
    return (await this.repository.listSets(workspaceId)).map(toSetDto);
  }

  async createSet(workspaceId: string, input: CreateSetInput): Promise<SetDto> {
    return toSetDto(await this.repository.createSet(workspaceId, input));
  }

  /** Everything the timeline needs in one round trip — plan §9.8. */
  async getSetDetail(workspaceId: string, setId: string): Promise<SetDetail> {
    const set = await this.repository.findSet(workspaceId, setId);
    if (!set) throw new SetNotFoundError(setId);

    const items = await this.repository.listItems(workspaceId, setId);
    return { set: toSetDto(set), items: items.map(toItemDto) };
  }

  async updateSet(
    workspaceId: string,
    setId: string,
    input: UpdateSetInput,
  ): Promise<SetDto> {
    const updated = await this.repository.updateSet(workspaceId, setId, input);
    if (!updated) throw new SetNotFoundError(setId);
    return toSetDto(updated);
  }

  async deleteSet(workspaceId: string, setId: string): Promise<void> {
    if (!(await this.repository.deleteSet(workspaceId, setId))) {
      throw new SetNotFoundError(setId);
    }
  }

  /**
   * Adds a track to the set, appending unless a position is given.
   *
   * The rank is computed inside the repository's transaction from the order as
   * it exists at that moment, so a concurrent add cannot make two items tie.
   */
  async addItem(
    workspaceId: string,
    setId: string,
    input: AddSetItemInput,
  ): Promise<SetItemDto> {
    if (!(await this.repository.trackExists(workspaceId, input.trackId))) {
      throw new TrackNotInWorkspaceError();
    }

    const created = await this.repository.addItem(
      workspaceId,
      setId,
      { trackId: input.trackId, notes: input.notes },
      (ranks) => {
        // Clamped rather than rejected: a drop at the end of a list that grew
        // underneath you is still plainly a request to append.
        const at = Math.max(0, Math.min(ranks.length, input.position ?? ranks.length));
        return rankBetween(ranks[at - 1] ?? null, ranks[at] ?? null);
      },
    );

    if (!created) throw new SetNotFoundError(setId);
    return toItemDto(created);
  }

  async removeItem(workspaceId: string, setId: string, itemId: string): Promise<void> {
    if (!(await this.repository.removeItem(workspaceId, setId, itemId))) {
      // The set may not exist, or the item may not be in it. Both are "that
      // item is not there", and distinguishing them would leak whether a set
      // id in another workspace exists.
      throw new SetItemNotFoundError(itemId);
    }
  }

  async reorderItem(
    workspaceId: string,
    setId: string,
    input: ReorderSetItemInput,
  ): Promise<SetItemDto> {
    const moved = await this.repository.moveItem(
      workspaceId,
      setId,
      input.itemId,
      (ranks, fromIndex) => rankForMove(ranks, fromIndex, input.toIndex),
    );

    if (!moved) throw new SetItemNotFoundError(input.itemId);
    return toItemDto(moved);
  }
}

/**
 * Prisma `Decimal` does not survive JSON serialization as a number, so
 * `targetBpm` is widened on the way out — the same conversion the track and
 * transition mappers make.
 */
function toSetDto(set: SetRecord): SetDto {
  return {
    id: set.id,
    workspaceId: set.workspaceId,
    name: set.name,
    targetBpm: set.targetBpm === null ? null : Number(set.targetBpm),
    targetKey: set.targetKey,
    version: set.version,
    createdAt: set.createdAt.toISOString(),
    updatedAt: set.updatedAt.toISOString(),
  };
}

function toItemDto(item: SetItemWithTrack): SetItemDto {
  return {
    id: item.id,
    trackId: item.trackId,
    rank: item.rank,
    notes: item.notes,
    track: toTrackDto(item.track),
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
