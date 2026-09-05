import "reflect-metadata";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Rikta, container, type FastifyInstance } from "@riktajs/core";
import { registerSwagger } from "@riktajs/swagger";
import {
  createPrismaClient,
  createDatabaseLifecycle,
  type PrismaClient,
} from "@flowgraph/db";

import { loadEnv, isProduction, type Env } from "./config/env.js";
import { createGracefulShutdown } from "./lifecycle/graceful-shutdown.js";
import { createAuth, type Auth } from "./auth/auth.js";
import { WorkspaceContextService } from "./auth/workspace-context.js";
import { WorkspaceProvisioningService } from "./auth/workspace-provisioning.js";
import {
  TRACK_SERVICE,
  HEALTH_SERVICE,
  WORKSPACE_CONTEXT,
  GRAPH_SERVICE,
  SET_SERVICE,
  IMPORT_SERVICE,
} from "./tokens.js";
import { TrackRepository } from "./tracks/track.repository.js";
import { TrackService } from "./tracks/track.service.js";
import { GraphRepository } from "./graphs/graph.repository.js";
import { GraphService } from "./graphs/graph.service.js";
import { SetRepository } from "./sets/set.repository.js";
import { SetService } from "./sets/set.service.js";
import { ImportRepository } from "./imports/import.repository.js";
import { ImportService } from "./imports/import.service.js";
import { LocalSeratoSource } from "./imports/serato-source.js";
import { HealthService } from "./health/health.service.js";
import { API_CONTROLLERS, OPENAPI_CONFIG } from "./openapi.js";
import { restoreNullability } from "./openapi-nullability.js";

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
function registerProviders(prisma: PrismaClient, auth: Auth, env: Env): void {
  const trackRepository = new TrackRepository(prisma);

  container.registerValue(TRACK_SERVICE, new TrackService(trackRepository));
  container.registerValue(HEALTH_SERVICE, new HealthService(prisma));
  container.registerValue(GRAPH_SERVICE, new GraphService(new GraphRepository(prisma)));
  container.registerValue(SET_SERVICE, new SetService(new SetRepository(prisma)));
  // The local reader is the only `SeratoSource` today. A desktop bridge
  // (ADR-0006) registers a different one here and nothing else changes.
  container.registerValue(
    IMPORT_SERVICE,
    new ImportService(
      new ImportRepository(prisma),
      new LocalSeratoSource(homedir(), env.SERATO_ROOTS),
    ),
  );
  container.registerValue(WORKSPACE_CONTEXT, new WorkspaceContextService(auth, prisma));
}

/**
 * Mounts better-auth's routes on the underlying Fastify instance.
 *
 * better-auth speaks the web `Request`/`Response` interface, so the Fastify
 * request is translated across the boundary. Fastify has already parsed the
 * JSON body by this point, hence the re-serialization — that avoids
 * overriding the global content-type parser, which would affect every other
 * route in the application.
 */
function mountAuthRoutes(server: FastifyInstance, auth: Auth): void {
  server.all("/api/auth/*", async (request, reply) => {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item);
      } else if (value !== undefined) {
        headers.append(key, value);
      }
    }

    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const response = await auth.handler(
      new Request(url.toString(), {
        method: request.method,
        headers,
        ...(hasBody && request.body !== undefined
          ? { body: JSON.stringify(request.body) }
          : {}),
      }),
    );

    reply.status(response.status);
    // Must use append, not header: better-auth emits multiple Set-Cookie
    // headers, and replacing would drop all but the last.
    response.headers.forEach((value, key) => {
      reply.raw.appendHeader(key, value);
    });

    return reply.send(response.body ? await response.text() : null);
  });
}

async function main(): Promise<void> {
  const env: Env = loadEnv();

  const prisma = createPrismaClient({
    databaseUrl: env.DATABASE_URL,
    logQueries: env.LOG_QUERIES,
  });
  const database = createDatabaseLifecycle(prisma);

  await database.connect();

  const provisioning = new WorkspaceProvisioningService(prisma);
  const auth = createAuth({
    prisma,
    secret: env.AUTH_SECRET,
    baseUrl: env.AUTH_BASE_URL,
    trustedOrigins: env.AUTH_TRUSTED_ORIGINS,
    isProduction: isProduction(env),
    onUserCreated: async (user) => {
      await provisioning.provisionPersonalWorkspace(user);
    },
  });

  registerProviders(prisma, auth, env);

  const app = await Rikta.create({
    port: env.API_PORT,
    host: env.API_HOST,
    logger: false,
    // Explicit registration over filesystem discovery: discovery order is
    // implicit and its failures are hard to debug.
    autowired: false,
    // Shared with the OpenAPI generator so a route cannot be served but
    // undocumented, or documented but unrouted.
    controllers: [...API_CONTROLLERS],
    exceptionFilter: {
      // ADR-0002, verified finding 2: Rikta's default error response embeds a
      // full stack trace including absolute filesystem paths. That is an
      // information-disclosure bug the moment it reaches a deployed
      // environment.
      includeStack: !isProduction(env),
      logErrors: true,
    },
  });

  mountAuthRoutes(app.server, auth);

  // Same controllers and same config as `pnpm openapi`, so the served spec
  // matches the checked-in artifact. That equality is asserted by a test
  // (openapi.test.ts) rather than assumed — the two documents are built by
  // separate code paths and would otherwise drift unnoticed.
  //
  // The plugin builds its own document rather than accepting one, so the
  // nullability repair has to be applied here too, via the `transform` hook
  // it provides for exactly this. Without it the served spec and the Swagger
  // UI would keep understating nullability after the checked-in artifact
  // stopped — the same defect, in the place people read the API by hand.
  //
  // UI is development-only; the JSON stays available everywhere so the
  // generated client can be rebuilt against a deployed environment.
  await registerSwagger(app.server, {
    config: OPENAPI_CONFIG,
    controllers: [...API_CONTROLLERS],
    jsonPath: "/openapi.json",
    uiPath: "/docs",
    exposeUI: !isProduction(env),
    exposeSpec: true,
    transform: restoreNullability,
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
