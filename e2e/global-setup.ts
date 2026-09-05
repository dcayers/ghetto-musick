import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createServer, type ViteDevServer } from "vite";

import { writeFixtureLibrary } from "./fixture-library.js";

/**
 * The whole stack, started fresh for one end-to-end run — plan §21.1.
 *
 * Database, API, and web server, none of them shared with development. That
 * costs about twenty seconds of startup and buys the only property that makes
 * an end-to-end suite worth trusting: a failure means the product is broken,
 * not that the machine had leftover state. A suite run against the dev stack
 * either destroys the data you were working with or is written so defensively
 * it stops asserting anything.
 *
 * The Serato library is a fixture written to a temp directory and pointed at
 * with `SERATO_ROOTS`. Reading the real `~/Music/_Serato_` would make the
 * import assertions depend on whatever is installed — passing locally, failing
 * in CI, and meaning nothing either way.
 */

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const DB_PACKAGE = join(ROOT, "packages/db");
const API_PACKAGE = join(ROOT, "apps/api");

let container: StartedPostgreSqlContainer | undefined;
let api: ChildProcess | undefined;
let web: ViteDevServer | undefined;
let workspace: string | undefined;

/** Polls until the process answers, so tests never race the boot. */
async function waitForHealth(url: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "never responded";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((wake) => setTimeout(wake, 400));
  }
  throw new Error(`${url} did not become healthy: ${lastError}`);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  workspace = mkdtempSync(join(tmpdir(), "flowgraph-e2e-"));
  const seratoRoot = writeFixtureLibrary(workspace);

  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("flowgraph_e2e")
    .withUsername("flowgraph")
    .withPassword("flowgraph")
    // The data does not outlive the run, so durability is wasted latency.
    .withCommand(["postgres", "-c", "fsync=off", "-c", "synchronous_commit=off"])
    .start();

  const databaseUrl = container.getConnectionUri();

  // `migrate deploy`, not `db push` — the production command, so the run also
  // proves the migrations produce a schema the app can actually boot against.
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: DB_PACKAGE,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });

  const apiPort = 4310;
  const webPort = 3310;
  const webOrigin = `http://localhost:${webPort}`;

  api = spawn("pnpm", ["exec", "tsx", "src/bootstrap.ts"], {
    cwd: API_PACKAGE,
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      API_PORT: String(apiPort),
      AUTH_SECRET: randomBytes(32).toString("hex"),
      AUTH_BASE_URL: `http://127.0.0.1:${apiPort}`,
      // The web app is same-origin through Vite's proxy, so this is the origin
      // the browser sends. Without it every state-changing auth route is a 403.
      AUTH_TRUSTED_ORIGINS: webOrigin,
      SERATO_ROOTS: seratoRoot,
    },
    stdio: "pipe",
  });

  const apiLog: string[] = [];
  api.stdout?.on("data", (chunk: Buffer) => apiLog.push(chunk.toString()));
  api.stderr?.on("data", (chunk: Buffer) => apiLog.push(chunk.toString()));
  api.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`API exited with ${code}:\n${apiLog.join("")}`);
    }
  });

  try {
    await waitForHealth(`http://127.0.0.1:${apiPort}/health/ready`);
  } catch (error) {
    // Without this the failure reads as a timeout rather than the config or
    // migration error that actually caused it.
    console.error(`API never became healthy:\n${apiLog.join("")}`);
    throw error;
  }

  // Vite is started here rather than through Playwright's `webServer` so the
  // API port is known before the proxy is configured. `webServer` starts
  // independently of global setup, which would make that a race.
  // Set before `createServer`, because `vite.config.ts` reads it at
  // config-load time in Node. A `define` would not reach it: that substitutes
  // into browser code, and this decides where the dev server proxies.
  process.env.VITE_API_PROXY_TARGET = `http://127.0.0.1:${apiPort}`;

  web = await createServer({
    root: join(ROOT, "apps/web"),
    server: { port: webPort, strictPort: true },
    logLevel: "error",
  });
  await web.listen();

  await waitForHealth(`${webOrigin}/health/ready`);

  writeFileSync(
    join(workspace, "state.json"),
    JSON.stringify({ apiPort, webPort, webOrigin, seratoRoot, databaseUrl }, null, 2),
  );

  // Returned rather than exported: Playwright treats a function returned from
  // global setup as the teardown, which keeps the started handles in one
  // closure instead of module-level state a second file has to reach into.
  return teardown;
}

async function teardown(): Promise<void> {
  await web?.close();
  api?.kill("SIGTERM");
  await container?.stop();
  if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true });
}
