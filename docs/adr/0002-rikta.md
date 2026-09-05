# ADR-0002: Rikta as the backend framework, with containment and exit path

- **Status:** Accepted
- **Date:** 2026-08-02
- **Plan reference:** §2, §6.6, §27

## Context

Rikta was selected as the backend framework by product direction. It is a Fastify-backed TypeScript framework offering zero-config autowiring, decorator-based DI, native Zod validation, and OpenAPI generation — a NestJS-shaped developer experience on a lighter runtime.

Its maturity, verified against the npm registry on 2026-08-02, is the material risk:

| Signal | `@riktajs/core` | Fastify | NestJS |
|---|---|---|---|
| Version | **0.12.0** (pre-1.0) | 5.11.0 | 13.x |
| First published | **2025-12-19** | — | — |
| Releases since | **39** | — | — |
| Weekly downloads | **40** | 10,607,453 | 13,089,082 |

A pre-1.0 package with ~40 weekly downloads has fast breaking-change velocity, a thin support surface, and few independent eyes on releases — including security-relevant ones.

### Verified behaviour

The following was established empirically against `@riktajs/core@0.12.0` before this decision, not assumed:

1. **Cross-instance Zod validation works.** `@riktajs/core` hard-depends on `zod@4.3.5` and `fastify@5.3.2` as *direct* dependencies, not peers, so an install contains two copies of each. A schema built with app-level `zod@4.4.3` and passed to `@Body(schema)` still validates correctly — Rikta duck-types via `.safeParse()` rather than `instanceof`. **The `packages/contracts` rule in §6.6 is therefore safe.**
2. **Default error responses leak stack traces.** A validation failure returns HTTP 400 with a full `stack` string in the JSON body, including absolute filesystem paths. This must be disabled outside development.
3. **Property-based `@Autowired()` requires `emitDecoratorMetadata`.** Without it — for example under esbuild/tsx — resolution fails with "could not infer type". Explicit tokens (`@Autowired(TrackService)`) work regardless of transpiler.
4. **Rikta uses its own bundled Fastify.** Request handling runs through `fastify@5.3.2` nested under `@riktajs/core`, not any app-level Fastify. Pinning Fastify at the app level has no effect.
5. **`@riktajs/swagger` drops `nullable` from generated schemas.** It asks Zod for OpenAPI 3.0 JSON Schema — which is correct, `nullable: true` included — and then re-copies that result through a property whitelist that has no `nullable` entry, so the flag is discarded on the way out. `bpm: z.number().nullable()` reaches the document as `{"type": "number"}`. Nothing else is lost: unions still arrive as `anyOf`, and the library's own `OpenApiSchemaObject` type declares `nullable`, so this is an omitted whitelist entry rather than a design choice. It matters because the document is the contract of record — `openapi-typescript` faithfully turned the wrong document into `bpm: number`, and any consumer trusting that crashes on the null the API genuinely returns for a track with no analysed tempo.

## Decision

**Adopt Rikta**, and treat its replaceability as a first-class design constraint rather than a footnote.

### Containment rules

1. **Exact-pin every `@riktajs/*` package.** No `^`, no `~`. Under npm semver, `^0.12.0` still admits `0.12.x`; with 39 releases in seven months that is unacceptable drift.
2. **No `@riktajs/*` import outside `apps/api/src/**/*.controller.ts` and `apps/api/src/bootstrap.ts`.** Enforced by an ESLint `no-restricted-imports` rule, run in CI, and asserted as a property test. *This is the single most important rule in the codebase.*
3. **Services accept plain interfaces**, never Rikta or Fastify request/reply types. Controllers translate at the boundary.
4. **All Zod schemas live in `packages/contracts`**, never inline in decorators. Verified safe by finding 1.
5. **Prefer explicit DI tokens** — `@Autowired(Token)` over bare `@Autowired()`. Removes the `emitDecoratorMetadata` dependency (finding 3) and survives a transpiler change.
6. **Disable stack traces in non-development error responses** (finding 2), configured in `bootstrap.ts`.
7. **Do not pin Fastify at the app level** for the API (finding 4). It is misleading. Depend on what Rikta bundles and record the effective version in the lockfile.
8. **Version bumps get their own PR**, never bundled with feature work, with the full integration suite green.
9. **Exclude `@riktajs/*` from dependency auto-merge**; enable lockfile-diff alerts on the scope.
10. **Restore nullability on the generated document** (finding 5), in `apps/api/src/openapi-nullability.ts`. Applied both by `generateOpenApiDocument()` and by the runtime plugin's `transform` hook, so the checked-in artifact and the served spec cannot disagree. Deliberately a post-processing step rather than pre-converting the schemas handed to each decorator: the decorator approach has to be remembered at every `@ApiOkResponse`, and the day it is forgotten the field silently loses its null again. The repair operates on plain JSON and imports no `@riktajs/*`, so unlike the binding layer it survives the exit path rather than being deleted with it.

### Exit triggers

Re-open this decision when **any** of the following is observed:

- An unpatched security advisory against `@riktajs/*` older than 14 days.
- No upstream release for 90 consecutive days while open issues affecting us remain. **Clock started 2026-07-03**, the most recent publish; `0.12.0` is still the latest release as of 2026-08-02, so roughly one month has elapsed. Re-check this date at each milestone.
- A breaking change whose absorption is estimated at more than one sprint.
- A required capability that cannot be implemented without violating containment rule 2.

### Exit path

Rikta is Fastify-backed and its useful surface is decorators, DI, and OpenAPI wiring. The fallback is **plain Fastify plus a minimal DI container** (`awilix`, or hand-rolled — the container needs are modest). With rules 2–4 held, the migration rewrites controllers and `bootstrap.ts` and touches nothing else: domain logic, contracts, repositories, and tests are framework-agnostic by construction. Estimated at days, not weeks.

## Consequences

**Positive**

- Fast, ergonomic development with DI, Zod validation, and OpenAPI generation out of the box.
- Containment rules produce a cleaner architecture than the framework would require on its own — pure domain, thin controllers, portable contracts. These are good rules even if Rikta thrives.
- The exit is costed and triggered in advance rather than discovered during an incident.

**Negative / accepted costs**

- Rule 2 forbids convenient framework features in services (request-scoped injection of Fastify types, framework-specific decorators in the domain). This is deliberate friction.
- Two copies each of Zod and Fastify in the dependency tree; slightly larger installs and one more thing to reason about during upgrades.
- We carry supply-chain risk that Fastify or NestJS would not present. Mitigated by pinning, lockfile-diff alerts, and excluding the scope from auto-merge — not eliminated.
- `@riktajs/typeorm` exists but `@riktajs/prisma` does not; Prisma requires hand-wiring (see ADR-0008).

## Alternatives considered

**Fastify + awilix directly** — no framework risk, maximum control, but we would hand-build DI, decorator routing, Zod binding, and OpenAPI generation. This is precisely what Rikta provides, and it is the documented exit path, so nothing is lost by trying Rikta first.

**NestJS** — the mature incumbent with the same shape (13M weekly downloads). The strongest risk-adjusted choice on the merits. Not selected: Rikta was chosen by product direction, and the containment rules above make that choice cheap to reverse.
