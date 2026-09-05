# ADR-0011: React Flow clears the 1k/3k graph budget; no Sigma fallback

- **Status:** Accepted
- **Date:** 2026-09-05
- **Plan reference:** §3.5, §9.3, §9.4, §21.1, P0 #14
- **Supersedes:** the open question in §9.4 — "record the measured result in an ADR either way"

## Context

§3.5 requires graph interactions to stay responsive at **1,000 nodes and 3,000 edges**. §9.4 turns that into an explicit gate, because `@xyflow/react` renders a DOM element per node and that is precisely where DOM-based renderers degrade. Decision 7 hedges it: graphology owns the model (§9.3) so a swap to Sigma 3.0.3 costs a renderer rewrite — roughly one to two weeks — and no domain code.

Phase 2's exit criterion was the reference graph meeting "agreed frame and interaction budgets, **or** the Sigma fallback decision recorded in an ADR". Until now it was neither: the harness (P0 #14) did not exist, and the budget it refers to had never been agreed anywhere in the plan. §3.5 says "responsive"; nothing states a number.

## The budget, now stated

**A single interaction step must cost under 16.7ms of main-thread work at the p95, at 1,000 nodes and 3,000 edges.**

16.7ms is one frame at 60fps. Main-thread cost per step is a strict *lower bound* on frame time, so exceeding it makes 60fps impossible regardless of how fast the compositor is. Staying under it does not by itself prove 60fps — see the limits below — but it does answer the specific concern §9.4 raises, which is about main-thread work.

A secondary bar, failed: **time to an interactive canvas should stay under two seconds.**

## Method

`pnpm perf` (`apps/web/scripts/perf.ts`) starts Vite in-process, opens `perf.html` in Chromium via Playwright, generates a deterministic synthetic graph, and drives the **real `GraphCanvas` against the real store**. A simplified stand-in would have measured the stand-in.

Each step dispatches one real mouse or wheel event at the pane — so React Flow's handlers, its viewport transform, and React's re-render are all inside the timing — then forces style and layout to complete synchronously before stopping the clock. Every run measures a 100-node control scene first, so a slow number can be attributed to the node count rather than to the machine, the harness, or the browser.

Two measurement bugs were found and fixed while building it, both of which produced *encouraging* wrong answers:

- Synthetic `PointerEvent`s never reached d3-zoom, which binds `mousedown` on the pane and `mousemove`/`mouseup` on the window. The probe reported a comfortable 0.3ms median while the viewport never moved. `viewportMoved` is now part of every result rather than an assumption.
- The zoom sweep alternates in and out so the canvas does not shrink to nothing, which means it ends roughly where it began. Comparing only start to end reported "no interaction" for a working zoom. Movement is now sampled per step.

## Results

Apple Silicon, 12 cores, headless Chromium, 1600×1000 viewport. Median of three runs; the run-to-run spread was under 1ms.

| Nodes | Edges in DOM | DOM elements | Interactive after | Pan median | Pan p95 | Zoom median | Zoom p95 |
|---|---|---|---|---|---|---|---|
| 100 | 278 | 8,321 | 0.6s | 0.5ms | 0.7ms | 0.8ms | 0.9ms |
| **1,000** | **2,934** | **33,510** | **2.5s** | **6.2ms** | **6.5ms** | **5.7ms** | **6.4ms** |
| 2,000 | 5,908 | 67,276 | 5.7s | 13.1ms | 14.0ms | 13.8ms | 17.9ms |
| 3,000 | 8,888 | 101,096 | 8.7s | 19.9ms | 24.7ms | 19.4ms | 25.3ms |

Cost is linear in node count at roughly **6.3ms per 1,000 nodes**, and the 60fps ceiling is crossed between 2,000 and 2,500 nodes.

Note that **nothing is culled**: all 1,000 nodes and 2,934 edges are in the DOM simultaneously at the gate size. `onlyRenderVisibleElements` is off, so this is the unmitigated case.

## Decision

**Stay on `@xyflow/react`. Do not swap to Sigma.**

The gate passes at p95 6.5ms against a 16.7ms budget — about 60% headroom — with none of §9.4's four mitigations applied beyond the simplified-node rendering that already exists. Spending one to two weeks on a renderer rewrite to buy headroom that is not needed would be the wrong trade, and §9.3's hedge remains available if that changes.

**Revisit when a real workspace approaches 2,000 nodes.** That is where the measured curve reaches the budget, and it is a concrete trigger rather than a feeling.

**Mount time fails its bar and is the real problem.** 2.5 seconds to an interactive canvas at the gate size is worse for a planner than a few milliseconds of pan cost, because it is paid on every load rather than during a gesture. §9.4's mitigation list is ordered for frame rate; for mount it is viewport culling that matters, and that is now the first optimisation to reach for rather than the second.

## What this does not prove

Stated plainly, because a performance ADR that overclaims is worse than none:

- **Paint and composite are not measured.** Headless Chromium has no real compositor. The main-thread numbers are a lower bound, and a machine with a weaker GPU could miss 60fps while matching them exactly.
- **This is not "a reference laptop"** (§3.5). It is a 12-core Apple Silicon machine, which is faster than the floor the plan intends. The linear scaling makes extrapolation reasonable; the absolute numbers should not be quoted as a guarantee.
- **The scene is synthetic.** Edges connect grid neighbours, which is deliberate — long-range edges have larger bounding boxes and stay on screen longer — but a real graph with hub tracks would render differently.
- **2,934 edges, not 3,000.** The generator refuses duplicate ordered pairs and self-loops, matching what `buildTrackGraph` enforces, so a handful near the grid boundary are dropped rather than silently discarded later.
- **Only pan and zoom.** Node drag, marquee selection, and adding an edge while 1,000 nodes are mounted are unmeasured.

## Consequences

**Positive**

- Phase 2's exit criterion is met with a number rather than an assumption, and P0 #14 is closed.
- `pnpm perf` is repeatable and takes about a minute, so a change that regresses the canvas can be caught rather than discovered.
- The harness is a separate Vite entry, so it cannot reach a production bundle: Vite's default build input is `index.html` alone.

**Negative / accepted costs**

- Playwright and a Chromium download are now a development dependency. They were already in the plan's tooling (decision 8) for E2E, so this pulls that forward rather than adding it.
- The harness is not in CI. It measures wall-clock on shared runners, where the variance would exceed the signal; running it is a deliberate act before and after canvas work. If it ever gains a CI role it should compare against the control scene rather than an absolute threshold.

## Alternatives considered

**Swap to Sigma 3.0.3 pre-emptively.** WebGL rendering would remove the DOM ceiling entirely. Rejected: the measurement says the ceiling is more than twice the required size, and §9.3's decoupling means this stays cheap to do later. Doing it now would be a rewrite justified by a fear the numbers do not support.

**Enable `onlyRenderVisibleElements` now.** It would improve mount time, which is the bar that actually failed. Deferred rather than rejected — it changes what the gate measures, so the unmitigated baseline above is worth having recorded first.

**Measure presented frame times instead.** The honest measurement, and the one to use if this is ever run headed. It was not available here: `requestAnimationFrame` does not fire on a schedule in the headless pane, so an rAF probe hangs rather than reporting a slow number — a failure mode that looks exactly like a performance finding.
