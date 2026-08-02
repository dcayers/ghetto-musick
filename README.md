# FlowGraph

A visual set-planning tool for DJs. Tracks are nodes, transitions are directed
edges, and a set is a versioned path through that graph.

- **Plan:** [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)
- **Decisions:** [docs/adr/](docs/adr/)

## Requirements

- Node 22 LTS
- pnpm 10
- Docker (Postgres, Redis, MinIO)

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm infra:up          # postgres, redis, minio
pnpm db:generate       # prisma client
pnpm db:migrate        # apply migrations
pnpm --filter @flowgraph/db run seed
pnpm dev:api           # http://127.0.0.1:4000
```

Verify:

```bash
curl -s http://127.0.0.1:4000/health/ready
```

The seed prints a workspace id. Until session-derived context lands
(ADR-0004), requests carry it explicitly:

```bash
curl -s http://127.0.0.1:4000/v1/tracks -H "x-workspace-id: <workspace-id>"
```

## Layout

```text
apps/
  api/              Rikta REST API
packages/
  contracts/        Zod schemas, DI-free ports, shared types
  db/               Prisma schema, client, migrations
infra/docker/       local Postgres, Redis, MinIO
docs/               plan and ADRs
```

## Checks

```bash
pnpm lint
pnpm -r --workspace-concurrency=1 typecheck
```

## Working rules

Two constraints matter more than the rest, and both are enforced rather than
documented:

**Framework containment (ADR-0002).** `@riktajs/*` and Fastify may only be
imported from `apps/api/src/**/*.controller.ts` and `apps/api/src/bootstrap.ts`.
Everything else stays framework-agnostic. ESLint fails the build otherwise.
Rikta is at `0.12.0` with ~40 weekly downloads; this rule is what keeps
replacing it a days-long job rather than a rewrite.

**Workspace scoping (plan §16.2).** Every repository method takes
`workspaceId` as its first argument. Scope at the query — never fetch and
then authorize.

## Notes

- `pnpm -r typecheck` needs `--workspace-concurrency=1`; Prisma 7's generated
  types are large enough that parallel `tsc` processes exhaust memory. The API
  package raises its own heap to 8 GB for the same reason.
- `zod` is pinned via a `pnpm.overrides` entry. `@riktajs/core` hard-depends on
  its own copy, and two copies in the tree typecheck as unrelated types
  (TS2589) even though they interoperate fine at runtime.
