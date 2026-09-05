import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client.js";

export { PrismaClient } from "./generated/client.js";
export type {
  Workspace,
  User,
  WorkspaceMember,
  Track,
  Graph,
  GraphNode,
  Transition,
  // Named `Set` to match the plan's §7.3 outline. Import it aliased —
  // an unaliased `Set` shadows the global in any file that builds one.
  Set,
  SetItem,
  LocalFile,
  ImportRun,
} from "./generated/client.js";
export { WorkspaceRole, ImportRunStatus } from "./generated/enums.js";

/**
 * Database client — ADR-0008.
 *
 * Deliberately framework-agnostic. ADR-0008 binds Prisma's lifecycle to
 * Rikta's hooks, but ADR-0002 rule 2 forbids importing `@riktajs/*` anywhere
 * under `packages/**`. So this file exposes plain `connect` / `disconnect`
 * functions plus a `DatabaseLifecycle` interface, and the Rikta binding lives
 * in `apps/api/src/bootstrap.ts` where framework imports are allowed.
 *
 * Prisma 7 note: the datasource block no longer accepts `url`, and the client
 * connects through a driver adapter rather than a bundled Rust engine.
 * Connection configuration for Migrate lives in `prisma.config.ts`; the
 * runtime connection is constructed here.
 */

export interface DatabaseLifecycle {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface PrismaClientOptions {
  readonly databaseUrl: string;
  readonly logQueries?: boolean;
}

export function createPrismaClient(options: PrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({ connectionString: options.databaseUrl });

  return new PrismaClient({
    adapter,
    log: options.logQueries ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

/**
 * Wraps a client in the lifecycle contract the API bootstrap consumes.
 *
 * `disconnect` must run *after* HTTP draining so in-flight requests can
 * complete. Getting it backwards produces intermittent shutdown errors that
 * are miserable to diagnose in production, so the ordering is asserted by a
 * test rather than left to convention — see
 * `apps/api/src/lifecycle/graceful-shutdown.test.ts`.
 */
export function createDatabaseLifecycle(client: PrismaClient): DatabaseLifecycle {
  return {
    async connect() {
      await client.$connect();
    },
    async disconnect() {
      await client.$disconnect();
    },
  };
}
