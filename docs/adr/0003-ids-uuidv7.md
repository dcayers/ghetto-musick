# ADR-0003: UUIDv7 for all primary keys

- **Status:** Accepted
- **Date:** 2026-08-02
- **Plan reference:** §6.3, §6.4

## Context

Every table needs a primary key strategy, chosen once before the first migration because changing it later rewrites every foreign key in the schema.

FlowGraph's access patterns push hard on two properties:

- **Cursor pagination** is used for tracks, jobs, imports, and audit events (§6.3). Cursors need a stable, orderable tiebreak.
- **High-volume append-only inserts** — `ImportItem`, `AuditEvent`, `OutboxEvent`, `GraphNode` — where index locality determines write throughput.

IDs are also exposed in URLs and sent to the desktop bridge, so they must not be guessable in sequence.

## Decision

Use **UUIDv7** for all primary keys, generated application-side.

- Generate in TypeScript rather than relying on `gen_random_uuid()` or Postgres 18's native `uuidv7()`, so IDs are available before insert and portable across dialects.
- Store as Postgres `uuid`, not `text` — 16 bytes versus 36, with a native index type.
- Expose as the canonical string form in JSON.

## Consequences

**Positive**

- **Time-ordered**, so inserts land at the right edge of the B-tree. This preserves index locality and avoids the page-split churn UUIDv4 causes on write-heavy tables.
- **Sortable**, so an ID is a valid cursor tiebreak — `ORDER BY created_at, id` is stable without a separate sequence column.
- Client-generatable, which enables optimistic UI: the web app can mint a graph node ID and reconcile after the server confirms.
- Globally unique, so the desktop bridge can generate IDs offline during a long scan without coordinating with the server.

**Negative / accepted costs**

- UUIDv7 embeds a millisecond timestamp, so IDs leak approximate creation time. Acceptable — creation timestamps are already returned on these resources. Do not use UUIDv7 for anything where creation time is itself a secret (session tokens, enrollment codes, signed bridge commands); those use dedicated random tokens.
- 16 bytes versus an 8-byte bigint. Accepted for global uniqueness and offline generation.

## Alternatives considered

**CUID2** — the other candidate in the original plan. Rejected on its central design property: CUID2 is *deliberately* not sortable, to avoid leaking creation ordering. That is an anti-goal here, where sortability is exactly what cursor pagination and insert locality need. Its collision resistance and opacity are real strengths, just not ones this system is asking for.

**UUIDv4** — random, so it fragments B-tree inserts on the highest-volume tables and provides no cursor ordering. Rejected.

**Auto-increment bigint** — best possible index locality and smallest storage, but enumerable in URLs, unusable for offline bridge generation, and unusable for optimistic client-side creation. Rejected.
