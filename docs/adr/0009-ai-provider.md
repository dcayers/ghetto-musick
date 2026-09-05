# ADR-0009: AI provider behind a port, defaulting to Claude

- **Status:** Accepted
- **Date:** 2026-08-02
- **Plan reference:** §14, §31 open decision 6

## Context

Plan §14 specifies AI set generation and transition suggestions as a **hybrid** pipeline: deterministic code filters candidates and validates results, and the model does interpretation, selection among viable candidates, naming, and explanation. §14.4 requires the model to return IDs drawn **only** from a supplied candidate set, schema-validated, with exactly one repair attempt before failing.

The provider should be configurable rather than hard-wired, and Claude is the starting default.

## Decision

Define an **`AiProvider` port** in `packages/contracts`, mirroring the `JobQueue` port from ADR-0005, with an Anthropic adapter as the default implementation.

```ts
export interface AiProvider {
  generate<T>(request: AiRequest<T>): Promise<AiResult<T>>;
}
```

The port speaks in domain terms — a prompt, a JSON schema, a candidate envelope, a policy classification — never in vendor SDK types. Provider selection is configuration, validated at boot alongside the rest of the environment.

### Default: Claude Opus 5

| Setting | Value |
|---|---|
| Model | `claude-opus-5` |
| SDK | `@anthropic-ai/sdk` 0.115.0 |
| Pricing | $5 / $25 per MTok (input / output) |
| Context | 1M tokens |
| Max output | 128K |

### Implementation constraints

These are current-API facts, not style preferences. Getting them wrong produces 400s:

1. **Thinking is on by default.** Omitting the `thinking` parameter runs adaptive thinking; `{type: "adaptive"}` is equivalent. Control depth with `output_config.effort`, not a token budget — `budget_tokens` is removed and returns 400.
2. **Sampling parameters are removed.** `temperature`, `top_p`, and `top_k` all return 400. Steer with prompting. Any instinct to "set temperature to 0 for determinism" has nowhere to go here — and never guaranteed identical output anyway.
3. **Use structured outputs for the §14.4 contract.** `output_config: {format: {type: "json_schema", schema}}` constrains the response to our schema at the API level. This turns "the model should return valid JSON" from a hope into an enforced property, and it is why §14.4's one-repair-attempt rule should rarely fire.
4. **Handle `stop_reason: "refusal"` before reading `content`.** Safety classifiers can decline a request, returning HTTP 200 with an empty or partial `content` array. Code that indexes `content[0]` unconditionally breaks. Opt into server-side fallbacks (`fallbacks: "default"` with beta `server-side-fallback-2026-07-01`) so a decline is recovered rather than surfaced as a failure.
5. **Set `max_tokens` deliberately.** It caps thinking *plus* response text together. Stream anything above ~16K.
6. **Pin the model ID.** `claude-opus-5` is a fixed identifier with no date suffix. Plan §14.5 requires pinning model versions in production and evaluating before upgrades; record the model and prompt version on every `AiGeneration` row.

### Policy gate sits above the port

ADR-0007's Spotify exclusion is enforced **before** the port is called. The adapter receives an already-filtered eligible-candidate envelope and cannot widen it. That ordering matters: a policy boundary implemented inside a swappable adapter would have to be reimplemented for every provider.

## Consequences

**Positive**

- Swapping providers is a one-file change, and the deterministic scoring in `packages/domain` is untouched by the choice — the model never computes; it selects and explains.
- Structured outputs enforce the §14.4 output contract at the API layer rather than in a parse-and-retry loop.
- The port makes a fake provider trivial, so §21.2's "deterministic AI fake for most tests" costs nothing and CI never calls a live model.
- Cost, latency, and validation outcomes are recorded per generation regardless of provider (§14.5).

**Negative / accepted costs**

- The port is a lowest-common-denominator interface. Provider-specific capabilities — extended thinking, prompt caching, server-side fallbacks — either sit behind optional config or stay inside the adapter. Do not leak SDK types through the port to reach them.
- Prompt tuning is not portable. A prompt tuned against Claude will not transfer cleanly to another provider, so "configurable" means the plumbing swaps, not that quality carries over. The §14.6 evaluation suite has to be re-run per provider.
- Structured outputs and refusal fallbacks are Claude-specific behaviours the port cannot assume; another adapter may need its own parse-and-repair path.

## Alternatives considered

**Call the SDK directly, no port** — less code, and full access to provider-specific features. Rejected: it hard-wires a vendor into `apps/worker`, and it puts the ADR-0007 policy gate inside vendor-specific code where it is easy to bypass by accident.

**A third-party abstraction layer** (LangChain, Vercel AI SDK) — a ready-made multi-provider interface. Rejected: our AI surface is narrow — one structured generation call with a constrained candidate set — so a general-purpose framework is far more dependency than the requirement justifies, and it would obscure exactly the provider-specific features (structured outputs, refusal handling) that make the §14.4 contract enforceable.

**Claude Sonnet 5 as the default** ($3/$15, cheaper) — attractive on cost. Rejected for now: set generation is a low-volume, high-value operation where quality matters more than per-call price, and §14.6 measures acceptance rate. Revisit once the evaluation suite can measure the quality difference on our own data rather than guessing.
