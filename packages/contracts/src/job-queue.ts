/**
 * Job queue port — ADR-0005.
 *
 * Application code depends on this interface, never on @riktajs/queue or
 * BullMQ directly. Queue usage is spread across the entire worker, so this is
 * where framework coupling would have been most expensive to unwind.
 *
 * Implementations:
 *   - `@riktajs/queue` (BullMQ-backed) — default, wired in bootstrap.ts
 *   - BullMQ directly — fallback if the wrapper proves limiting
 *   - in-memory — tests, so unit and integration runs need no Redis
 *
 * Note that user-visible job state is a durable projection in Postgres, not a
 * read against Redis. Redis is transport, not a source of truth.
 */

export const QUEUE_NAMES = [
  "imports",
  "analysis",
  "ai",
  "exports",
  "maintenance",
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

export type JobState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "dead-lettered";

export interface JobSpec<TPayload> {
  /** Stable name of the handler this job targets. */
  readonly name: string;
  readonly payload: TPayload;
  /**
   * Deduplication key. At-least-once delivery means handlers must be
   * idempotent regardless, but this prevents duplicate enqueue for
   * user-initiated work (imports, exports, AI generation).
   */
  readonly idempotencyKey?: string;
  readonly maxAttempts?: number;
}

export interface JobHandle {
  readonly id: string;
  readonly queue: QueueName;
}

export interface JobStatus {
  readonly handle: JobHandle;
  readonly state: JobState;
  readonly attempts: number;
  readonly progress?: number;
  readonly failureReason?: string;
}

export interface JobQueue {
  enqueue<TPayload>(queue: QueueName, job: JobSpec<TPayload>): Promise<JobHandle>;
  schedule<TPayload>(
    queue: QueueName,
    job: JobSpec<TPayload>,
    runAt: Date,
  ): Promise<JobHandle>;
  cancel(handle: JobHandle): Promise<void>;
  status(handle: JobHandle): Promise<JobStatus>;
}
