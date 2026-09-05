import type { PrismaClient, Set as SetRecord, SetItem, Track } from "@flowgraph/db";
import type { CreateSetInput, UpdateSetInput } from "@flowgraph/contracts";
import { newId } from "@flowgraph/contracts";

/**
 * Set persistence.
 *
 * Prisma appears here and nowhere above (ADR-0008), and every method takes
 * `workspaceId` positionally so it cannot be forgotten (plan §16.2).
 *
 * The Prisma model is called `Set` to match the plan's §7.3 outline, so it is
 * imported as `SetRecord` throughout: an unaliased `Set` would shadow the
 * global in any file that also builds one, which is a trap worth spending a
 * rename to avoid.
 */

export class SetVersionConflictError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`Set version ${expected} is stale; current is ${actual}`);
    this.name = "SetVersionConflictError";
  }
}

export type SetItemWithTrack = SetItem & { track: Track };

export class SetRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listSets(workspaceId: string): Promise<SetRecord[]> {
    return this.prisma.set.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }

  async createSet(workspaceId: string, input: CreateSetInput): Promise<SetRecord> {
    return this.prisma.set.create({
      data: {
        id: newId(),
        workspaceId,
        name: input.name,
        targetBpm: input.targetBpm ?? null,
        targetKey: input.targetKey ?? null,
      },
    });
  }

  async findSet(workspaceId: string, setId: string): Promise<SetRecord | null> {
    return this.prisma.set.findFirst({ where: { id: setId, workspaceId } });
  }

  /**
   * Items in rank order.
   *
   * `rank` alone is a total order within a set — the unique constraint on
   * `(setId, rank)` guarantees no ties — so no tiebreaker column is needed.
   */
  async listItems(workspaceId: string, setId: string): Promise<SetItemWithTrack[]> {
    return this.prisma.setItem.findMany({
      // Scoped through the set's workspace, not just by setId — otherwise a
      // known set id from another workspace would read its items.
      where: { setId, set: { workspaceId } },
      include: { track: { include: { localFile: { select: { missing: true } } } } },
      orderBy: { rank: "asc" },
    });
  }

  async updateSet(
    workspaceId: string,
    setId: string,
    input: UpdateSetInput,
  ): Promise<SetRecord | null> {
    const existing = await this.findSet(workspaceId, setId);
    if (!existing) return null;

    return this.prisma.set.update({
      where: { id: setId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        // `nullish` in the contract means "absent leaves it alone, explicit
        // null clears it" — two different intents that a single `??` would
        // collapse into one.
        ...(input.targetBpm !== undefined ? { targetBpm: input.targetBpm } : {}),
        ...(input.targetKey !== undefined ? { targetKey: input.targetKey } : {}),
        version: { increment: 1 },
      },
    });
  }

  async deleteSet(workspaceId: string, setId: string): Promise<boolean> {
    const { count } = await this.prisma.set.deleteMany({ where: { id: setId, workspaceId } });
    return count > 0;
  }

  /** True when the track exists in this workspace and is not soft-deleted. */
  async trackExists(workspaceId: string, trackId: string): Promise<boolean> {
    const track = await this.prisma.track.findFirst({
      where: { id: trackId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    return track !== null;
  }

  /**
   * Adds one item at a computed rank.
   *
   * The rank is computed by the caller from the current order, so the read and
   * the write must be one transaction: without it, two concurrent adds at the
   * same position would compute the same rank and the unique constraint would
   * reject the loser with a constraint error rather than a retry.
   */
  async addItem(
    workspaceId: string,
    setId: string,
    input: { trackId: string; notes?: string | undefined },
    rankFor: (ranks: readonly string[]) => string,
  ): Promise<SetItemWithTrack | null> {
    return this.prisma.$transaction(async (tx) => {
      const set = await tx.set.findFirst({ where: { id: setId, workspaceId } });
      if (!set) return null;

      const existing = await tx.setItem.findMany({
        where: { setId },
        orderBy: { rank: "asc" },
        select: { rank: true },
      });

      const created = await tx.setItem.create({
        data: {
          id: newId(),
          setId,
          trackId: input.trackId,
          rank: rankFor(existing.map((item) => item.rank)),
          notes: input.notes ?? null,
        },
        include: { track: { include: { localFile: { select: { missing: true } } } } },
      });

      await tx.set.update({ where: { id: setId }, data: { version: { increment: 1 } } });
      return created;
    });
  }

  async removeItem(workspaceId: string, setId: string, itemId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.setItem.deleteMany({
        where: { id: itemId, setId, set: { workspaceId } },
      });
      if (count === 0) return false;

      await tx.set.update({ where: { id: setId }, data: { version: { increment: 1 } } });
      return true;
    });
  }

  /**
   * Moves one item, writing exactly one row.
   *
   * This is what fractional ranks buy (§7.4): the tail is not renumbered, so a
   * fifty-track set costs one UPDATE and two clients reordering different
   * regions do not contend.
   */
  async moveItem(
    workspaceId: string,
    setId: string,
    itemId: string,
    rankFor: (ranks: readonly string[], fromIndex: number) => string,
  ): Promise<SetItemWithTrack | null> {
    return this.prisma.$transaction(async (tx) => {
      const set = await tx.set.findFirst({ where: { id: setId, workspaceId } });
      if (!set) return null;

      const ordered = await tx.setItem.findMany({
        where: { setId },
        orderBy: { rank: "asc" },
        select: { id: true, rank: true },
      });

      const fromIndex = ordered.findIndex((item) => item.id === itemId);
      if (fromIndex === -1) return null;

      const rank = rankFor(
        ordered.map((item) => item.rank),
        fromIndex,
      );

      const moved = await tx.setItem.update({
        where: { id: itemId },
        data: { rank },
        include: { track: { include: { localFile: { select: { missing: true } } } } },
      });

      await tx.set.update({ where: { id: setId }, data: { version: { increment: 1 } } });
      return moved;
    });
  }
}
