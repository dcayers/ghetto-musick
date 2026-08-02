import "reflect-metadata";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Rikta, container } from "@riktajs/core";
import {
  createPrismaClient,
  createDatabaseLifecycle,
  type PrismaClient,
} from "@flowgraph/db";

import { loadEnv, isProduction, type Env } from "./config/env.js";
import { createGracefulShutdown } from "./lifecycle/graceful-shutdown.js";
import { TRACK_SERVICE, HEALTH_SERVICE } from "./tokens.js";
import { TrackRepository } from "./tracks/track.repository.js";
import { TrackService } from "./tracks/track.service.js";
import { TrackController } from "./tracks/track.controller.js";
import { HealthService } from "./health/health.service.js";
import { HealthController } from "./health/health.controller.js";

// Resolve .env against the repo root, not the process working directory —
// otherwise `pnpm --filter` runs from apps/api and silently finds nothing.
loadDotenv({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

/**
 * Application entrypoint — the only non-controller file permitted to import
 * `@riktajs/*` (ADR-0002 rule 2).
 *
 * Everything framework-specific is concentrated here: DI registration,
 * lifecycle binding, error-response policy, and signal handling. If Rikta's
 * exit triggers ever fire, this file and the controllers are what get
 * rewritten. Nothing else.
 */

/**
 * Wires object construction by hand rather than relying on autowiring.
 *
 * Deliberate: it keeps the dependency graph readable in one place, and it
 * means services and repositories are plain classes with constructor
 * arguments rather than decorated framework citizens.
 *
 * Tokens are symbols from `./tokens.ts` rather than the service classes
 * themselves: Rikta's `Token<T>` requires `new (...args: unknown[]) => T`, and
 * a constructor with typed parameters is not assignable to that. See tokens.ts.
 */
function registerProviders(prisma: PrismaClient): void {
  const trackRepository = new TrackRepository(prisma);

  container.registerValue(TRACK_SERVICE, new TrackService(trackRepository));
  container.registerValue(HEALTH_SERVICE, new HealthService(prisma));
}

async function main(): Promise<void> {
  const env: Env = loadEnv();

  const prisma = createPrismaClient({
    databaseUrl: env.DATABASE_URL,
    logQueries: env.LOG_QUERIES,
  });
  const database = createDatabaseLifecycle(prisma);

  await database.connect();

  registerProviders(prisma);

  const app = await Rikta.create({
    port: env.API_PORT,
    host: env.API_HOST,
    logger: false,
    // Explicit registration over filesystem discovery: discovery order is
    // implicit and its failures are hard to debug.
    autowired: false,
    controllers: [TrackController, HealthController],
    exceptionFilter: {
      // ADR-0002, verified finding 2: Rikta's default error response embeds a
      // full stack trace including absolute filesystem paths. That is an
      // information-disclosure bug the moment it reaches a deployed
      // environment.
      includeStack: !isProduction(env),
      logErrors: true,
    },
  });

  await app.listen();
  console.log(`API listening on http://${env.API_HOST}:${env.API_PORT}`);

  // Ordering (HTTP drain before database disconnect) lives in
  // ./lifecycle/graceful-shutdown.ts so it can be asserted by a test rather
  // than left to convention — ADR-0008.
  const shutdown = createGracefulShutdown({
    server: app,
    database,
    onExit: (code) => process.exit(code),
    log: (message) => console.log(`\n${message}`),
    logError: (message, error) => console.error(message, error),
  });

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  console.error("Failed to start API", error);
  process.exit(1);
});
