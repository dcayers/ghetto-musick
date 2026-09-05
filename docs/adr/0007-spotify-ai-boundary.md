# ADR-0007: Spotify content excluded from AI pipelines

- **Status:** Accepted
- **Date:** 2026-08-02
- **Plan reference:** §13.5, §14.5

## Context

FlowGraph uses Spotify to bootstrap a track library quickly (search, saved library, playlist import) and separately offers AI set generation and transition suggestions.

Spotify's developer terms restrict using Spotify content to train, fine-tune, or otherwise ingest into machine-learning models. The boundary between "metadata we imported" and "content we fed to a model" is easy to blur accidentally — a prompt builder that serializes a whole `Track` row would cross it silently, and the violation would be invisible in code review.

There is a second, independent reason for care: imported third-party text is **untrusted input**. Track titles, album names, and user-authored playlist descriptions reach our prompts, which makes them a prompt-injection vector.

## Decision

Maintain a **policy gate between the data layer and every AI pipeline.** The gate is code, not a convention.

1. **Spotify-origin fields are ineligible for AI input by default** — raw provider payloads, artwork, preview URLs, and any field whose provenance resolves to Spotify (§4.1).
2. AI operates on **user-authored tags and constraints, local-file analysis results, and FlowGraph-owned metadata**. A track imported only from Spotify and never matched to a local file contributes its FlowGraph-owned identity, not its Spotify payload.
3. The eligible-candidate envelope is **constructed explicitly** by the gate. Prompt builders never receive a domain entity and serialize it themselves; they receive a purpose-built DTO containing only eligible fields.
4. **All imported text is treated as untrusted data**, never as instruction. It is delimited and labelled as data in the prompt, and the model's output is constrained to IDs from the supplied candidate set (§14.4).
5. **Automated policy tests** assert that no prohibited field can reach a prompt. This is a release gate (§25.6 exit criteria), not a lint suggestion.
6. Widening the envelope requires **current written terms plus legal review**, recorded as a new ADR superseding this one. Default stays exclusion.

The product consequence is deliberate: **AI functionality must remain useful without Spotify.** Spotify import is a bootstrap convenience, and AI quality may not depend on it.

## Consequences

**Positive**

- Compliance is structural. The gate is a chokepoint that code review and automated tests can both target, rather than a rule everyone must remember at every call site.
- Aligns with the source-of-truth precedence already established in §4.1 — Serato/local data outranks Spotify anyway, so the AI pipeline runs on the better data.
- The same chokepoint that enforces policy also constrains prompt injection, because both problems are solved by "construct the envelope explicitly, never serialize the entity."
- Spotify API or policy changes cannot break the AI feature, since it never depended on Spotify data.

**Negative / accepted costs**

- A user whose library is Spotify-only gets weaker AI suggestions than one with analysed local files. This is the correct incentive — it points users toward the bridge, which is where the product's value is — but it must be communicated in the UI rather than presenting as a defect.
- The explicit-DTO rule is more code than passing entities to a prompt builder, and it must be maintained as fields are added.
- Provenance tracking must be reliable per field, not per record, since a single `Track` can carry Spotify-origin and local-origin fields simultaneously.

## Alternatives considered

**Allow Spotify metadata in prompts** — better cold-start suggestions, and arguably permissible for narrow inference use. Rejected: the terms are restrictive enough that this needs legal review to assert, and the failure mode is an account ban that removes the import feature entirely. Not worth trading for a marginal cold-start improvement.

**No AI features until the Serato path is complete** — sidesteps the question. Rejected: AI is a Phase 5 deliverable and the gate is cheap to build correctly from the start. Retrofitting a policy boundary into an existing prompt pipeline is exactly the migration this ADR exists to avoid.
