# ADR-0004: better-auth for sessions and OAuth linking

- **Status:** Accepted
- **Date:** 2026-08-02
- **Plan reference:** §16

## Context

FlowGraph needs four distinct authentication capabilities:

1. **Web sessions** — server-managed, cookie-based, with CSRF protection.
2. **OAuth account linking** — Spotify connected as an *integration*, not as a login identity, with encrypted tokens and server-side refresh under a per-account lock (§13.3).
3. **Device credentials** — the desktop bridge enrolls via a short-lived one-time code and holds a scoped credential that cannot reach account-management endpoints (§12.2).
4. **Passwordless-first login** — passkeys or magic links preferred; passwords only if operationally required.

The original plan left this open ("hosted auth implementation versus first-party session service").

## Decision

Use **better-auth** with `@better-auth/prisma-adapter`, self-hosted against the application's own Postgres.

- Sessions: `HttpOnly`, `Secure`, `SameSite=Lax` cookies with rotating, hashed session identifiers persisted in Postgres.
- Passkey and magic-link as the primary flows.
- OAuth account linking supplies the `ConnectedAccount` mechanism for Spotify rather than a second parallel system.
- better-auth owns its schema models; generate them into the shared Prisma schema rather than hand-authoring them.
- **Device credentials for the bridge are not better-auth sessions.** They are a separate, purpose-built scoped-token mechanism (ADR-0006), because their trust model, lifetime, and revocation semantics differ.

Explicitly **not** using `@riktajs/passport`.

## Consequences

**Positive**

- Resolves the hosted-versus-first-party question without a third-party dependency at the identity layer: better-auth *is* a first-party session service running against our own database, so user identity and data stay colocated and there is no per-MAU vendor cost.
- Passkeys and magic links are supported directly, satisfying the passwordless-first requirement without assembling WebAuthn plumbing by hand.
- OAuth linking and session management share one library, one schema, and one revocation path — so "disconnect Spotify" and "revoke all sessions" are not two independently-written flows.
- Prisma adapter means auth tables participate in the same migration discipline as everything else (ADR-0008).

**Negative / accepted costs**

- We operate authentication ourselves: session storage, rotation, CSRF, and rate limiting are our responsibility to configure and monitor. A hosted provider would absorb that.
- better-auth is a comparatively young library. Materially more established than Rikta, but it warrants the same treatment: pin the version, keep auth logic behind `common/auth/`, and never let its types leak into domain code.
- Adds tables to the shared schema that we do not fully control the shape of.

## Alternatives considered

**`@riktajs/passport`** — the framework-native option. Rejected on two grounds. Passport is session middleware from an earlier era with no first-class passkey or magic-link story, so we would build the passwordless flows ourselves. And adopting it deepens Rikta coupling in precisely the area ADR-0002 rule 2 works hardest to keep thin — authentication touches every request.

**Auth.js (NextAuth v5)** — mature and capable, but its centre of gravity is Next.js. We are on TanStack Start with a separate Rikta API, which is the configuration Auth.js handles least naturally.

**Hosted (Clerk, WorkOS, Auth0)** — least operational burden and excellent passkey support. Rejected for MVP: per-MAU pricing on a single-user-workspace product is poor value, user identity would live outside our database complicating account export and deletion (§16.3), and the offline-degradation principle (§4.8) is harder to honour when login depends on a third party.
