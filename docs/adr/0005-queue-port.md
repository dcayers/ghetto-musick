# ADR-0005: Job queue behind an application port

- **Status:** Accepted
- **Date:** 2026-08-02
- **Plan reference:** §17

## Context

Five workloads need durable background execution: `imports`, `analysis`, `ai`, `exports`, and `maintenance` (§17.2). All are long-running, must survive process restarts, and must be idempotent under at-least-once delivery.

`@riktajs/queue@0.12.0` exists and is BullMQ-based. Using it directly would mean queue access — one of the most pervasive concerns in the worker — is framework-coupled, which collides with the ADR-0002 containment rules.

## Decision

Define a **`JobQueue` port** in `packages/contracts` and depend only on that from application code.

```ts
export interface JobQueue {
  enqueue<T>(queue: QueueName, job: JobSpec<T>): Promise<JobHandle>;
  schedule<T>(queue: QueueName, job: JobSpec<T>, runAt: Date): Promise<JobHandle>;
  cancel(handle: JobHandle): Promise<void>;
  status(handle: JobHandle): Promise<JobStatus>;
}
```

- Default implementation: `@riktajs/queue` (BullMQ-based), registered in DI at `bootstrap.ts`.
- Fallback implementation: **BullMQ directly**, if the Rikta wrapper proves limiting during the foundation spike or if ADR-0002's exit triggers fire.
- A third in-memory implementation exists for tests, so unit and integration tests need no Redis.
- Job *state visible to users* is a durable projection in Postgres (`Job`), written by handlers — never read from Redis directly. Redis is transport, not a source of truth.

Every handler must be idempotent, keyed by `Idempotency-Key` for user-initiated work. Outbox events bridge database commits to queue publication (§17.3).

## Consequences

**Positive**

- Swapping `@riktajs/queue` for raw BullMQ is a one-file change. Given that queue usage is spread across the entire worker, this is where framework coupling would have been most expensive to unwind.
- The in-memory implementation removes Redis from the unit and integration test path entirely, which materially speeds CI.
- Keeping user-visible job state in Postgres means job history survives a Redis flush, and the UI queries one store rather than two.

**Negative / accepted costs**

- The port is a lowest-common-denominator interface. BullMQ features not expressed in it (flows, repeatable job patterns, priorities beyond a simple field) require either widening the port or an escape hatch. Widen deliberately; do not leak BullMQ types through it.
- Dual bookkeeping between the Redis queue and the Postgres `Job` projection. Accepted: the projection is what makes progress durable and auditable.

## Alternatives considered

**Use `@riktajs/queue` directly, no port** — less code today. Rejected: it puts framework coupling in the highest-volume, highest-spread part of the worker, which is exactly what ADR-0002 exists to prevent.

**BullMQ directly, no port** — removes a layer and one dependency, but forgoes the in-memory test implementation, which is the port's largest day-to-day benefit.

**Postgres-backed queue (pgboss, or a hand-rolled `SKIP LOCKED` queue)** — one less managed service, and transactional enqueue with the outbox for free. Genuinely attractive, and worth revisiting if Redis proves to be the only reason we run Redis. Rejected for now because rate limiting and short-lived locks (§17.1) also want Redis, so it is not a service we avoid by changing queues.
