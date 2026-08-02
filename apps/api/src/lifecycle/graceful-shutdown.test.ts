import { describe, it, expect, vi } from "vitest";
import type { DatabaseLifecycle } from "@flowgraph/db";
import { createGracefulShutdown, type Closable } from "./graceful-shutdown.js";

/**
 * Asserts the shutdown-ordering contract from ADR-0008.
 *
 * Both `packages/db/src/index.ts` and `bootstrap.ts` claim this ordering is
 * "asserted by a test rather than left to convention". Until this file existed,
 * that claim was false.
 */

interface Harness {
  readonly calls: string[];
  readonly server: Closable;
  readonly database: DatabaseLifecycle;
  readonly exitCodes: number[];
  readonly errors: string[];
}

function harness(
  options: { serverThrows?: boolean; databaseThrows?: boolean } = {},
): Harness {
  const calls: string[] = [];
  const exitCodes: number[] = [];
  const errors: string[] = [];

  return {
    calls,
    exitCodes,
    errors,
    server: {
      async close() {
        calls.push("server.close");
        if (options.serverThrows) throw new Error("http close failed");
      },
    },
    database: {
      async connect() {
        calls.push("database.connect");
      },
      async disconnect() {
        calls.push("database.disconnect");
        if (options.databaseThrows) throw new Error("disconnect failed");
      },
    },
  };
}

const shutdownFor = (h: Harness) =>
  createGracefulShutdown({
    server: h.server,
    database: h.database,
    onExit: (code) => h.exitCodes.push(code),
    logError: (message) => h.errors.push(message),
  });

describe("createGracefulShutdown", () => {
  it("drains HTTP before disconnecting the database", async () => {
    // The whole point. Reversing these produces intermittent
    // "client is closed" errors under load.
    const h = harness();
    await shutdownFor(h)("SIGTERM");

    expect(h.calls).toEqual(["server.close", "database.disconnect"]);
  });

  it("exits zero on a clean shutdown", async () => {
    const h = harness();
    await shutdownFor(h)("SIGTERM");

    expect(h.exitCodes).toEqual([0]);
  });

  it("ignores a second signal while shutting down", async () => {
    // A second SIGINT must not start a concurrent teardown racing the first.
    const h = harness();
    const shutdown = shutdownFor(h);

    await Promise.all([shutdown("SIGINT"), shutdown("SIGINT")]);

    expect(h.calls).toEqual(["server.close", "database.disconnect"]);
    expect(h.exitCodes).toEqual([0]);
  });

  it("ignores a later signal after shutdown completed", async () => {
    const h = harness();
    const shutdown = shutdownFor(h);

    await shutdown("SIGTERM");
    await shutdown("SIGINT");

    expect(h.calls).toEqual(["server.close", "database.disconnect"]);
  });

  it("still disconnects the database when the HTTP close fails", async () => {
    // Regression guard. The original inline version wrapped both calls in one
    // try block, so a throwing close() skipped the disconnect and leaked the
    // connection pool.
    const h = harness({ serverThrows: true });
    await shutdownFor(h)("SIGTERM");

    expect(h.calls).toEqual(["server.close", "database.disconnect"]);
    expect(h.exitCodes).toEqual([1]);
    expect(h.errors).toContain("Failed to close HTTP server");
  });

  it("reports a non-zero exit when the disconnect fails", async () => {
    const h = harness({ databaseThrows: true });
    await shutdownFor(h)("SIGTERM");

    expect(h.exitCodes).toEqual([1]);
    expect(h.errors).toContain("Failed to disconnect database");
  });

  it("does not resolve before both teardown steps finish", async () => {
    // Guards against a fire-and-forget refactor: the handler must await both,
    // or the process exits mid-teardown.
    const order: string[] = [];
    const slowClose = vi.fn(
      async () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            order.push("server.close");
            resolve();
          }, 10),
        ),
    );

    const shutdown = createGracefulShutdown({
      server: { close: slowClose },
      database: {
        async connect() {},
        async disconnect() {
          order.push("database.disconnect");
        },
      },
      onExit: () => order.push("exit"),
    });

    await shutdown("SIGTERM");

    expect(order).toEqual(["server.close", "database.disconnect", "exit"]);
  });
});
