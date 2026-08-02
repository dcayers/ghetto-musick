# ADR-0001: REST + OpenAPI over GraphQL/tRPC

- **Status:** Accepted
- **Date:** 2026-08-02
- **Plan reference:** §5.3, §8

## Context

FlowGraph has three distinct API consumers with different needs:

1. The **TanStack Start web app** — rich, interactive, benefits from generated types.
2. The **Tauri desktop bridge** — a separate process on the user's machine, enrolled by device credential, running long import/export operations.
3. **Future integrations** — anything scripting against a published set.

The API surface is dominated by resource CRUD (tracks, graphs, transitions, sets, markers) plus long-running operations (imports, exports, AI generation) that need job semantics.

## Decision

Use **REST with an OpenAPI document generated from Zod schemas** via `@riktajs/swagger`.

- Base path `/v1`, JSON camelCase.
- `202 Accepted` returning a job resource for long-running work.
- Cursor pagination, `ETag`/`If-Match` for optimistic concurrency, `Idempotency-Key` for mutations.
- RFC 9457 problem details for errors.
- The OpenAPI document is a **checked-in build artifact**; CI fails on an uncommitted diff.
- A typed client is generated into `packages/api-client` and consumed by both web and bridge. Handwritten duplicate request types are prohibited.

## Consequences

**Positive**

- The desktop bridge gets a plain HTTP contract with no framework coupling — important because it is a separately shipped, separately versioned artifact.
- Job endpoints, conditional requests, and upload handshakes are natural in REST and awkward in GraphQL.
- OpenAPI gives contract tests, generated clients, and documentation from one source.
- Zod schemas in `packages/contracts` serve validation, OpenAPI generation, and TypeScript inference simultaneously.

**Negative / accepted costs**

- Clients over-fetch relative to GraphQL. Acceptable: the graph canvas loads bounded working sets, not arbitrary nested selections.
- Keeping the generated client in sync requires CI enforcement rather than being structurally impossible (as with tRPC).
- Versioning the API is a manual discipline.

## Alternatives considered

**tRPC** — excellent DX for a TypeScript monorepo, but it couples the client to server types at build time. The desktop bridge is a separate release train that may run an older version against a newer API; a hard type coupling makes that painful. Rejected.

**GraphQL** — solves over-fetching and would suit the graph domain conceptually. But it adds a schema layer, resolver plumbing, N+1 defenses, and query-cost limiting for a first release whose access patterns are known and narrow. The "it's a graph, so use GraphQL" intuition is a pun, not an argument. Rejected for MVP; revisit if third-party API consumers appear.
