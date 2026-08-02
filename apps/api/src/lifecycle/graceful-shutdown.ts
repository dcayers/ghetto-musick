import type { DatabaseLifecycle } from "@flowgraph/db";

/**
 * Graceful shutdown — ADR-0008.
 *
 * Ordering matters and is easy to get backwards: HTTP must drain first so
 * in-flight requests can finish their queries, and only then may the database
 * disconnect. Reversed, you get intermittent "client is closed" errors under
 * load that are miserable to diagnose in production.
 *
 * Extracted from `bootstrap.ts` so the ordering can be asserted by a test
 * rather than left to convention. The dependencies are minimal interfaces
 * rather than Rikta types, which also keeps this file inside ADR-0002 rule 2.
 */

/** Minimal surface of the HTTP server. Deliberately not a Rikta type. */
export interface Closable {
  close(): Promise<void>;
}

export interface ShutdownDeps {
  readonly server: Closable;
  readonly database: DatabaseLifecycle;
  /** Injected so tests can observe the exit code instead of killing the run. */
  readonly onExit: (code: number) => void;
  readonly log?: (message: string) => void;
  readonly logError?: (message: string, error: unknown) => void;
}

export type ShutdownHandler = (signal: string) => Promise<void>;

export function createGracefulShutdown(deps: ShutdownDeps): ShutdownHandler {
  const { server, database, onExit } = deps;
  const log = deps.log ?? (() => {});
  const logError = deps.logError ?? (() => {});

  let shuttingDown = false;

  return async function shutdown(signal: string): Promise<void> {
    // A second SIGINT while the first shutdown is in flight must not start a
    // concurrent teardown — that races the two closes against each other.
    if (shuttingDown) return;
    shuttingDown = true;

    log(`${signal} received, shutting down`);

    let failed = false;

    try {
      await server.close();
    } catch (error) {
      failed = true;
      logError("Failed to close HTTP server", error);
    }

    // Disconnect even when the HTTP close failed. The original inline version
    // wrapped both calls in one try block, so a throwing `close()` skipped the
    // disconnect entirely and leaked the connection pool — exactly the bug the
    // ordering comment was there to prevent, one step removed.
    try {
      await database.disconnect();
    } catch (error) {
      failed = true;
      logError("Failed to disconnect database", error);
    }

    onExit(failed ? 1 : 0);
  };
}
