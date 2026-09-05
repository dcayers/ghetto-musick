import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

/**
 * One PostgreSQL container for the whole integration run — plan §21.1.
 *
 * Testcontainers rather than the compose stack (decision 8) for two reasons.
 * A test that shares the development database either destroys the data you
 * were working with or is written timidly enough to prove nothing; and CI
 * needs a database it can create and discard without a service definition
 * that has to be kept in step with `docker-compose.yml`.
 *
 * The schema comes from `prisma migrate deploy`, not `db push`. These tests
 * exist partly to check that the *migrations* produce the constraints the code
 * relies on — a unique index that only exists in `schema.prisma` and never
 * reached a migration would pass a pushed schema and fail in production.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PACKAGE = resolve(HERE, "../../../../packages/db");

let container: StartedPostgreSqlContainer | undefined;

export async function setup(project: TestProject): Promise<void> {
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("flowgraph_test")
    .withUsername("flowgraph")
    .withPassword("flowgraph")
    // The data does not outlive the run, so durability is wasted latency.
    .withCommand(["postgres", "-c", "fsync=off", "-c", "synchronous_commit=off"])
    .start();

  const databaseUrl = container.getConnectionUri();

  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: DB_PACKAGE,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });

  // `provide` is how a global setup reaches the test workers, which run in
  // their own processes and do not inherit anything set on `process.env` here.
  project.provide("databaseUrl", databaseUrl);
}

export async function teardown(): Promise<void> {
  await container?.stop();
}

declare module "vitest" {
  interface ProvidedContext {
    databaseUrl: string;
  }
}
