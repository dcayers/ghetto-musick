import { afterAll, afterEach, beforeAll, inject } from "vitest";
import { createPrismaClient, type PrismaClient } from "@flowgraph/db";
import { newId } from "@flowgraph/contracts";

/**
 * Per-file database harness.
 *
 * The container is shared (see `postgres-setup.ts`); this hands each test file
 * a client against it and empties the tables between tests. Truncation rather
 * than a transaction-per-test wrapper, because the repositories under test use
 * `$transaction` themselves and nesting would change the very behaviour — real
 * rollback on a version conflict, real constraint timing — these tests exist
 * to observe.
 */
export function useDatabase(): () => PrismaClient {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createPrismaClient({ databaseUrl: inject("databaseUrl"), logQueries: false });
  });

  afterEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  return () => prisma;
}

/**
 * Empties every table except Prisma's own migration ledger.
 *
 * Discovered from the catalogue rather than listed by hand: a table added
 * later would otherwise leak rows between tests, and the failure would surface
 * as an unrelated test breaking whenever the file order changed.
 */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;

  const list = tables.map((row) => `"public"."${row.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/* ------------------------------------------------------------------ seeds -- */

export interface SeededWorkspace {
  readonly workspaceId: string;
  readonly userId: string;
}

/**
 * A workspace with an owner, which is what every scoped query needs.
 *
 * Returns ids rather than rows: the tests assert on what the repositories do
 * with a workspace id, and handing back whole records invites assertions on
 * the seed instead of on the behaviour.
 */
export async function seedWorkspace(
  prisma: PrismaClient,
  name = "Test workspace",
): Promise<SeededWorkspace> {
  const workspaceId = newId();
  const userId = newId();

  await prisma.workspace.create({ data: { id: workspaceId, name } });
  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@example.test`,
      name,
      emailVerified: true,
    },
  });
  await prisma.workspaceMember.create({
    data: { id: newId(), workspaceId, userId, role: "OWNER" },
  });

  return { workspaceId, userId };
}

export async function seedTrack(
  prisma: PrismaClient,
  workspaceId: string,
  over: { title?: string; artist?: string; bpm?: number; keySignature?: string } = {},
): Promise<string> {
  const id = newId();
  await prisma.track.create({
    data: {
      id,
      workspaceId,
      title: over.title ?? "Untitled",
      artist: over.artist ?? "Unknown artist",
      bpm: over.bpm ?? 124,
      keySignature: over.keySignature ?? "8A",
      tags: [],
    },
  });
  return id;
}
