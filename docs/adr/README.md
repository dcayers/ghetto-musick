# Architectural Decision Records

Decisions that shape the FlowGraph codebase. Each ADR is immutable once accepted — supersede it with a new record rather than editing it.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-rest-openapi.md) | REST + OpenAPI over GraphQL/tRPC | Accepted |
| [0002](0002-rikta.md) | Rikta as the backend framework, with containment and exit path | Accepted |
| [0003](0003-ids-uuidv7.md) | UUIDv7 for all primary keys | Accepted |
| [0004](0004-auth-better-auth.md) | better-auth for sessions and OAuth linking | Accepted |
| [0005](0005-queue-port.md) | Job queue behind an application port | Accepted |
| [0006](0006-desktop-bridge.md) | Tauri desktop bridge for Serato filesystem access | Accepted |
| [0007](0007-spotify-ai-boundary.md) | Spotify content excluded from AI pipelines | Accepted |
| [0008](0008-prisma-7.md) | Prisma 7 as the ORM, hand-wired into Rikta DI | Accepted |
| [0009](0009-ai-provider.md) | AI provider behind a port, defaulting to Claude | Accepted |
| [0010](0010-serato-format-scope.md) | Serato format scope — read everything, write crates only | Accepted |

## Format

```md
# ADR-NNNN: Title

- **Status:** Proposed | Accepted | Superseded by ADR-NNNN
- **Date:** YYYY-MM-DD
- **Plan reference:** §N

## Context
## Decision
## Consequences
## Alternatives considered
```

## Conventions

- Number sequentially, zero-padded to four digits.
- Status changes are appended, not rewritten.
- Any ADR carrying an *exit trigger* (currently 0002) must name the observable conditions that force a re-decision. Vague escape hatches are not exits.
