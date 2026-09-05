/**
 * Interaction cost measurement for the §9.4 gate.
 *
 * ## What this measures, and why not frame times
 *
 * The obvious measurement is the wall clock between presented frames during a
 * drag. It is also unavailable here: the harness is driven from a headless
 * browser pane where `requestAnimationFrame` does not fire on a schedule, so
 * an rAF-based probe hangs rather than reporting a slow number — which is a
 * far worse failure, because it looks like a performance finding.
 *
 * So this measures **main-thread cost per interaction step**: dispatch one
 * real pointer or wheel event, force the browser to complete style and layout
 * synchronously, and time it. That is a strict lower bound on frame time. If
 * one step costs more than 16.7ms of main-thread work, 60fps is impossible no
 * matter how fast the compositor is, and the gate fails on this number alone.
 * If it costs well under, the gate is not yet proven — paint and composite are
 * still unmeasured — but the DOM-per-node concern §9.4 raises is answered,
 * because that concern is about main-thread work.
 *
 * Events are dispatched at the pane so React Flow's own handlers, its viewport
 * transform, and React's re-render all sit inside the timing. Calling
 * `setViewport` directly would skip the part under suspicion.
 */

export interface StepStats {
  readonly steps: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly worstMs: number;
  readonly totalMs: number;
  /** Steps costing more than one 60fps frame, as a percentage. */
  readonly overBudgetPercent: number;
  /**
   * True when the viewport changed at any point during the interaction.
   *
   * Sampled per step rather than compared start-to-end. The zoom sweep
   * alternates in and out so the canvas does not shrink to nothing by the
   * last step, which means it finishes roughly where it began — an
   * end-to-end comparison reported `false` and made a working interaction
   * look like a dead one.
   */
  readonly viewportMoved: boolean;
}

export interface PerfProbe {
  ready(): boolean;
  nodeCount(): number;
  edgeCount(): number;
  domElements(): number;
  viewport(): string;
  pan(steps?: number): Promise<StepStats>;
  zoom(steps?: number): Promise<StepStats>;
  /**
   * Wheels the viewport to roughly `scale`, and reports what it reached.
   *
   * Measuring only at the opening fit-view is misleading once culling is in
   * play: fit-view puts every node on screen, so nothing is off-viewport to
   * cull and the optimisation looks worthless. A DJ works at a zoom where
   * they can read a node, and that is where culling earns its keep — so the
   * harness has to be able to get there.
   */
  zoomTo(scale: number): Promise<number>;
  scale(): number;
}

/** 60fps. The budget ADR-0011 is written against. */
const FRAME_BUDGET_MS = 1000 / 60;

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

const round = (value: number) => Math.round(value * 100) / 100;

function summarise(samples: readonly number[], viewportMoved: boolean): StepStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const over = samples.filter((value) => value > FRAME_BUDGET_MS).length;
  return {
    steps: samples.length,
    medianMs: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    worstMs: round(sorted.at(-1) ?? 0),
    totalMs: round(samples.reduce((sum, value) => sum + value, 0)),
    overBudgetPercent: round(samples.length === 0 ? 0 : (over / samples.length) * 100),
    viewportMoved,
  };
}

/**
 * Forces style, layout, and React's flush to complete before the clock stops.
 *
 * Without this the browser is free to defer the expensive part past the
 * measurement, and every step reports a microsecond.
 */
function flush(): void {
  const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
  void viewport?.getBoundingClientRect();
  void document.body.offsetHeight;
}

/** Yields to the task queue so React can commit between steps. */
const yieldToTasks = () => new Promise((resolve) => setTimeout(resolve, 0));

function pane(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".react-flow__pane");
  if (element === null) throw new Error("Canvas pane not mounted");
  return element;
}

const transform = (): string =>
  document.querySelector<HTMLElement>(".react-flow__viewport")?.style.transform ?? "";

function currentScale(): number {
  const parsed = /scale\(([\d.]+)\)/.exec(transform());
  return parsed === null ? 1 : Number.parseFloat(parsed[1] ?? "1");
}

/**
 * A mouse event, not a pointer event.
 *
 * React Flow pans through d3-zoom, which binds `mousedown` on the pane and
 * then `mousemove`/`mouseup` on the *view* — the window. Synthetic
 * `PointerEvent`s dispatched at the pane are therefore ignored entirely: the
 * first version of this probe reported a comfortable 0.3ms median while the
 * viewport never moved, which is why `viewportMoved` is now part of the
 * result rather than an assumption.
 */
function mouse(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === "mouseup" ? 0 : 1,
  });
}

export function installProbe(): () => void {
  const probe: PerfProbe = {
    ready: () => document.querySelectorAll(".react-flow__node").length > 0,
    nodeCount: () => document.querySelectorAll(".react-flow__node").length,
    edgeCount: () => document.querySelectorAll(".react-flow__edge").length,
    domElements: () => document.querySelectorAll("*").length,
    viewport: transform,
    scale: currentScale,

    async zoomTo(target) {
      const element = pane();
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;

      // Wheeled rather than set, so React Flow's own clamping and transform
      // apply — a viewport written directly could sit outside minZoom/maxZoom
      // and measure a state the app can never be in.
      for (let attempt = 0; attempt < 400; attempt += 1) {
        const scale = currentScale();
        if (Math.abs(scale - target) / target < 0.05) break;
        element.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: x,
            clientY: y,
            deltaY: scale < target ? -40 : 40,
          }),
        );
        await yieldToTasks();
      }
      return currentScale();
    },

    async pan(steps = 40) {
      const target = pane();
      const box = target.getBoundingClientRect();
      let x = box.left + box.width * 0.7;
      const y = box.top + box.height * 0.5;
      let previous = transform();
      let moved = false;
      const samples: number[] = [];

      target.dispatchEvent(mouse("mousedown", x, y));
      window.dispatchEvent(mouse("mousemove", x - 2, y));
      await yieldToTasks();

      for (let step = 0; step < steps; step += 1) {
        // Small, even steps. One large jump would let the browser coalesce
        // work that a real drag cannot.
        x -= 6;
        const startedAt = performance.now();
        window.dispatchEvent(mouse("mousemove", x, y));
        flush();
        samples.push(performance.now() - startedAt);

        const now = transform();
        if (now !== previous) moved = true;
        previous = now;
        await yieldToTasks();
      }

      window.dispatchEvent(mouse("mouseup", x, y));
      return summarise(samples, moved);
    },

    async zoom(steps = 24) {
      const target = pane();
      const box = target.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      let previous = transform();
      let moved = false;
      const samples: number[] = [];

      for (let step = 0; step < steps; step += 1) {
        const startedAt = performance.now();
        target.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: x,
            clientY: y,
            // Alternating, so the viewport oscillates instead of zooming out
            // until the canvas is empty and the last steps measure nothing.
            deltaY: step % 2 === 0 ? -50 : 50,
          }),
        );
        flush();
        samples.push(performance.now() - startedAt);

        const now = transform();
        if (now !== previous) moved = true;
        previous = now;
        await yieldToTasks();
      }

      return summarise(samples, moved);
    },

  };

  window.__perf = probe;
  return () => {
    delete window.__perf;
  };
}
