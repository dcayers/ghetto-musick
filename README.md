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
openssl rand -hex 32    # paste into AUTH_SECRET in .env
pnpm infra:up           # postgres, redis, minio
pnpm db:generate        # prisma client
pnpm db:migrate         # apply migrations
pnpm dev:api            # http://127.0.0.1:4000
```

Verify:

```bash
curl -s http://127.0.0.1:4000/health/ready
```

## Signing in

There is no seed script — signing up *is* the setup. Creating an account
provisions a personal workspace automatically, and every request is scoped to
it from the session cookie.

```bash
curl -s -c cookies.txt -X POST http://127.0.0.1:4000/api/auth/sign-up/email \
  -H "content-type: application/json" -H "Origin: http://localhost:3000" \
  -d '{"email":"you@example.com","password":"a-long-passphrase","name":"You"}'
```

Then use the cookie jar:

```bash
curl -s -b cookies.txt http://127.0.0.1:4000/v1/tracks
```

**State-changing auth routes require an `Origin` header** from
`AUTH_TRUSTED_ORIGINS` — that is CSRF protection, not a bug. Without it,
sign-out returns 403 while sign-up and sign-in still work.

## API contract

`openapi.json` at the repo root is the contract of record — generated from the
controllers, checked in, and verified by CI. Browsable UI at
[/docs](http://127.0.0.1:4000/docs) while the API runs.

```bash
pnpm openapi              # regenerate openapi.json
pnpm api-client:generate  # regenerate the typed client from it
```

**Change an endpoint, regenerate, commit both.** CI fails if `openapi.json` is
stale, so a contract change always shows up in the same commit as the code
change. The generated client (`packages/api-client/src/generated/`) is *not*
checked in — it is derived from `openapi.json`, so committing it would add a
large mechanical diff with no review signal.

Generating needs no server and no database; it reads controller metadata only.

## Layout

```text
apps/
  api/              Rikta REST API
packages/
  contracts/        Zod schemas, DI-free ports, shared types
  db/               Prisma schema, client, migrations
  domain/           graph model, Camelot scoring, transition ranking
  serato/           read-only Serato library and crate parsing
  api-client/       typed client generated from openapi.json
infra/docker/       local Postgres, Redis, MinIO
docs/               plan and ADRs
openapi.json        API contract of record (generated, checked in)
```

## Scanning a Serato library

```bash
pnpm --filter @flowgraph/serato run scan          # default macOS locations
pnpm --filter @flowgraph/serato run scan <path>   # explicit _Serato_ root
```

**Safe to run against a real library — the package cannot write.** The parser
modules import no filesystem API at all, and the one module that does
(`read.ts`) imports read primitives only. A test asserts this, so an edit
adding a write import fails the build.

The scan checksums every file before and after parsing and reports byte-for-byte
verification. Findings from the first real run are in
[ADR-0010](docs/adr/0010-serato-format-scope.md).

## Importing a Serato library

Press **Import from Serato** in the library panel, or:

```bash
curl -s -b cookies.txt -X POST http://127.0.0.1:4000/v1/imports/serato \
  -H "content-type: application/json" -H "Origin: http://localhost:3000" -d '{}'
```

Read-only and idempotent: a local entry matches on its canonical path and a
streaming entry on the provider id Serato stores, so re-running updates rather
than duplicates. Tags, graph placement, and set membership are never touched.

**There is no desktop bridge yet.** Plan §12.1 requires one because a *hosted*
service cannot reach a DJ's local files — but deployment is local-only for now
(decision 18), so the API reads the library directly as the user who started
it. `SeratoSource` in `apps/api/src/imports/` is the seam: a bridge implements
that interface and posts the same manifests, and nothing downstream changes.

## Checks

```bash
pnpm lint
pnpm -r --workspace-concurrency=1 typecheck
pnpm test              # unit — about a second, needs nothing
pnpm test:integration  # repository and integration — needs Docker
```

```bash
pnpm perf                          # the §9.4 gate: 1000 nodes, 3000 edges
pnpm perf -- --nodes 2000          # a larger scene
pnpm perf -- --headed              # watch it
```

`pnpm perf` measures the graph canvas against the §3.5 budget and exits
non-zero if it regresses. It starts Vite in-process and drives the real
canvas in Chromium, so it needs no running dev server. The measured result
and the decision it produced are in
[ADR-0011](docs/adr/0011-graph-render-budget.md).

`pnpm test:integration` starts its own PostgreSQL through Testcontainers and
applies the real migrations to it, so it neither touches nor depends on the
development database from `pnpm infra:up`. It covers what a mocked Prisma
cannot: workspace scoping reaching the `WHERE` clause, optimistic-concurrency
rollback, the unique indexes the migrations actually produced, and whether
Postgres orders set ranks the way the client assumes.

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
