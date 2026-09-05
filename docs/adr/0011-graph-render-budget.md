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

**Mount time fails its bar and is the real problem.** 2.5 seconds to an interactive canvas at the gate size is worse for a planner than a few milliseconds of pan cost, because it is paid on every load rather than during a gesture.

> **Correction, same day.** This originally continued: "for mount it is viewport culling that matters, and that is now the first optimisation to reach for." Culling was then enabled and measured, and **mount time did not move** — see the amendment below. The prediction was wrong and the reason is obvious in hindsight: the canvas fits the whole graph to view on load, so at the exact moment mount cost is paid there is nothing off-screen to cull.

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

**Enable `onlyRenderVisibleElements` now.** Deferred rather than rejected, so that the unmitigated baseline above was recorded first. It has since been enabled — see the amendment.

**Measure presented frame times instead.** The honest measurement, and the one to use if this is ever run headed. It was not available here: `requestAnimationFrame` does not fire on a schedule in the headless pane, so an rAF probe hangs rather than reporting a slow number — a failure mode that looks exactly like a performance finding.

---

## Amendment (2026-09-05): viewport culling enabled

`onlyRenderVisibleElements` is now on. It is the pair to `SIMPLIFY_BELOW_ZOOM` rather than a duplicate of it: zoomed out, everything is on screen but each node is a cheap chip; zoomed in, each node is a full card but almost all of them are off-viewport. Simplification answers the first, culling the second, and neither helps where the other does.

### The measurement changed shape first

The original numbers were taken at the opening fit-view, which is the *friendliest* state for culling to be judged in and the least representative: fit-view puts every node on screen, so nothing can be culled and the optimisation appears worthless. The harness now measures at two viewports per scene — fit-view, and a zoom a person would actually work at — and the gate is judged on the worse of them.

That second state also turned out to be the heavier one before culling. At scale 1 the nodes render full detail rather than simplified chips, so the DOM was **82,653 elements against fit-view's 33,510** — the state the original measurement never visited.

### Result at 1,000 nodes / 2,934 edges

| | DOM elements | Nodes in DOM | Pan p95 | Zoom p95 |
|---|---|---|---|---|
| Working zoom, before | 82,653 | 1,000 | 8.1ms | 11.7ms |
| Working zoom, after | **4,926** | **42** | **2.1ms** | **1.5ms** |
| Fit view, before | 33,510 | 1,000 | 8.9ms | 10.0ms |
| Fit view, after | 32,001 | 936 | 9.9ms | 12.7ms |

Roughly **17× fewer DOM elements and 4–8× faster interaction** where a planner actually works. At fit-view the change is within run-to-run noise in both directions, which is the expected result when there is nothing off-screen to skip.

### Mount time is unchanged, and that falsifies the prediction above

2,471 / 2,542 / 2,501ms with culling, against 2,669 / 2,524 / 2,509ms without. Statistically identical.

The reason is that `fitView` runs on mount, so every node is inside the viewport exactly when the first render happens. Culling can only skip what is off-screen, and at that instant nothing is. **Mount remains unfixed, and the fix is not this.** The candidates are opening at a working zoom over a region rather than fitting the whole graph, or deferring node detail until after first paint — both product decisions rather than renderer flags, which is why neither is taken here.

### Accepted cost: off-screen nodes leave the DOM

A node outside the viewport is no longer focusable or reachable by a screen reader, where before it was — invisibly, but present. §9.9 requires keyboard and screen-reader coverage of core editing, so this is a real trade rather than a free win.

It is accepted because the alternative was never usable: tabbing through a thousand invisible nodes is not a workflow, and the routes that matter still work. Selecting a track in the library or the timeline focuses it on the canvas and brings it into view, at which point it is rendered, focusable, and described. The graph is reachable through the library; it is the canvas that is now viewport-bound.
