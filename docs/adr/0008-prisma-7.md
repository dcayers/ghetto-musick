# ADR-0008: Prisma 7 as the ORM, hand-wired into Rikta DI

- **Status:** Accepted
- **Date:** 2026-08-02
- **Plan reference:** §6.5, §7, §23

## Context

The data layer must support a schema of roughly thirty models with strict migration discipline: immutable migrations, expand/backfill/switch/contract for destructive changes, `migrate deploy` in production, and every migration tested from both an empty database and a representative prior snapshot (§23).

Two complications:

1. **Rikta ships no Prisma integration.** The official ORM package is `@riktajs/typeorm@0.12.0`. There is no `@riktajs/prisma`.
2. **Prisma 7 is a significant release.** The baseline plan predates it. Prisma 7 removed the Rust query engine in favour of a TypeScript-native client, which changes deployment shape, connection pooling behaviour, and instrumentation.

## Decision

Use **Prisma 7.9.1**, registered as a DI singleton in Rikta rather than via a framework integration package.

### Wiring

Prisma Client is framework-agnostic; the absence of `@riktajs/prisma` is an inconvenience, not a blocker.

- Instantiate one `PrismaClient` in a provider module in `packages/db`.
- Bind lifecycle to Rikta's hooks: `$connect()` on `OnProviderInit`, `$disconnect()` on `OnApplicationShutdown` — after HTTP draining, so in-flight requests complete first.
- Expose it **only to repository classes**. Controllers and domain code never see a `PrismaClient` (ADR-0002 rule 3).
- Register `@prisma/instrumentation` in `packages/observability` for OpenTelemetry spans.

Budget roughly thirty lines plus a test asserting connect/disconnect ordering under graceful shutdown.

**Implemented.** The ordering lives in `apps/api/src/lifecycle/graceful-shutdown.ts`, extracted from `bootstrap.ts` precisely so it can be tested, and is asserted by `graceful-shutdown.test.ts`. Writing that test surfaced a real defect in the original inline version: both calls sat in one `try` block, so a throwing `server.close()` skipped the database disconnect entirely and leaked the connection pool. The handler now attempts the disconnect regardless and reports a non-zero exit.

**Do not adopt `@riktajs/typeorm` alongside it.** Running two ORMs to gain lifecycle sugar for one is a worse trade than hand-wiring.

### Phase 0 validation

Prisma 7's engine change must be verified before the schema grows, and the result recorded here as an amendment:

- `prisma migrate deploy` against a real Postgres in CI.
- Connection pooling behaviour under the API's concurrency profile.
- OpenTelemetry span emission through `@prisma/instrumentation`.
- Testcontainers integration for the repository test layer (§21.1).

## Consequences

**Positive**

- Prisma Migrate is the most mature migration tooling in the TypeScript ecosystem, and §23's expand/contract discipline is exactly what it is built for. This is the decisive factor.
- The generated client gives full type safety across a large relational schema with heavy relation loading.
- Schema is declarative and reviewable in one file, which matters for a thirty-model domain.
- Prisma 7's TypeScript-native client removes the Rust binary, simplifying container images and eliminating a class of platform-specific deployment problems.
- Confining Prisma to repositories keeps ORM choice as reversible as framework choice.

**Negative / accepted costs**

- Hand-wired lifecycle: roughly thirty lines we own and must test, where a framework integration would provide it.
- Prisma 7 is new enough that its production characteristics are less documented than 6.x. Hence the Phase 0 validation gate.
- Prisma's raw-SQL escape hatch is less ergonomic than a query builder's. Relevant for the recursive CTEs that graph path-finding may need — those will be raw SQL in a repository, which is acceptable and localized.
- Postgres-specific by choice. There is no SQLite portability story, and none is wanted: the bridge does filesystem work, not local persistence.

## Alternatives considered

**Drizzle ORM** — lighter, SQL-native, better raw-query ergonomics, and trivially portable to SQLite. It was the earlier recommendation in this project's stack review, on the premise of a local-first SQLite architecture. **That premise no longer holds**: this is a server-authoritative Postgres application with a filesystem-only bridge, so the portability argument evaporates. On the criterion that actually matters here — migration tooling for §23's expand/contract discipline — `drizzle-kit` is less mature than Prisma Migrate. Rejected.

**`@riktajs/typeorm`** — the framework-native path, with lifecycle management provided. Rejected: TypeORM's migration story is weaker than Prisma's, its decorator-entity model would put ORM decorators throughout code that ADR-0002 requires to stay framework-agnostic, and adopting it to avoid thirty lines of wiring is a bad trade.

**Kysely** — excellent type-safe SQL builder with no ORM overhead, and the best raw-SQL ergonomics of the three. Rejected: it provides no migration tooling of Prisma Migrate's calibre, and a thirty-model schema with heavy relation loading is where a full ORM earns its cost.
