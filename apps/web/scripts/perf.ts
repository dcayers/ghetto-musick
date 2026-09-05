import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";

/**
 * The 1k/3k performance gate — plan §9.4, P0 #14.
 *
 * Runs the harness page in a real Chromium and reports what it measures.
 * Scripted rather than hand-driven for the reason §9.4 gives it a gate at all:
 * the answer decides whether the renderer gets rewritten, so it has to be
 * reproducible by someone who was not there, and re-runnable when the canvas
 * changes.
 *
 *     pnpm perf                       # the gate: 1000 nodes, 3000 edges
 *     pnpm perf -- --nodes 250        # a smaller scene, for comparison
 *     pnpm perf -- --headed           # watch it
 *
 * Vite is started in-process so the run needs no separate dev server and
 * cannot accidentally measure a stale build.
 */

interface StepStats {
  steps: number;
  medianMs: number;
  p95Ms: number;
  worstMs: number;
  totalMs: number;
  overBudgetPercent: number;
  viewportMoved: boolean;
}

interface Measurement {
  label: string;
  scale: number;
  domNodes: number;
  domEdges: number;
  domElements: number;
  pan: StepStats;
  zoom: StepStats;
}

interface Scene {
  label: string;
  nodes: number;
  edges: number;
  generateMs: number;
  mountMs: number;
  at: Measurement[];
}

/** 60fps. Anything above this per interaction step cannot reach it. */
const FRAME_BUDGET_MS = 1000 / 60;

function readArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number.parseInt(process.argv[index + 1] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Waits for the scene to be genuinely ready.
 *
 * Nodes appear before edges do — React Flow renders an edge only once both of
 * its endpoints have been measured — so waiting on nodes alone would measure a
 * thousand-node graph with no edges and report it as the 1k/3k gate. That
 * mistake is silent, which is why it is asserted rather than slept through.
 */
async function waitForScene(page: Page, expectedNodes: number): Promise<void> {
  await page.waitForFunction(
    (nodes: number) =>
      document.querySelectorAll(".react-flow__node").length >= nodes &&
      document.querySelectorAll(".react-flow__edge").length > 0,
    expectedNodes,
    { timeout: 120_000 },
  );
}

async function measureScene(
  browser: Browser,
  origin: string,
  label: string,
  nodes: number,
  edges: number,
): Promise<Scene> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();

  const startedAt = Date.now();
  await page.goto(`${origin}/perf.html?nodes=${nodes}&edges=${edges}`, {
    waitUntil: "load",
  });
  await waitForScene(page, nodes);
  const mountMs = Date.now() - startedAt;

  const generateMs = await page.evaluate(() =>
    Number(
      /generated in (\d+)ms/.exec(
        document.querySelector('[data-testid="perf-legend"]')?.textContent ?? "",
      )?.[1] ?? 0,
    ),
  );

  /**
   * Measures at whatever zoom the viewport is currently at.
   *
   * DOM counts are read *after* the interactions rather than before, because
   * culling decides what to render from the viewport — a count taken at rest
   * would miss what a pan brings into and out of the tree.
   */
  async function measureHere(atLabel: string): Promise<Measurement> {
    // Panning first: it is the interaction a planner spends the most time in.
    const pan = (await page.evaluate(() => window.__perf!.pan(40))) as StepStats;
    const zoom = (await page.evaluate(() => window.__perf!.zoom(24))) as StepStats;
    const counts = await page.evaluate(() => ({
      scale: window.__perf!.scale(),
      domNodes: document.querySelectorAll(".react-flow__node").length,
      domEdges: document.querySelectorAll(".react-flow__edge").length,
      domElements: document.querySelectorAll("*").length,
    }));
    return { label: atLabel, ...counts, pan, zoom };
  }

  const at: Measurement[] = [];
  at.push(await measureHere("fit view — the whole graph on screen"));

  // Then a zoom a person would actually work at, where most of the graph is
  // off-screen. This is the state culling exists for, and the one the opening
  // fit-view hides.
  const reached = await page.evaluate(() => window.__perf!.zoomTo(1));
  at.push(await measureHere(`working zoom — scale ${reached.toFixed(2)}`));

  await context.close();
  return { label, nodes, edges, generateMs, mountMs, at };
}

function report(scene: Scene): void {
  const verdict = (stats: StepStats) =>
    !stats.viewportMoved
      ? "NO INTERACTION — measurement invalid"
      : stats.p95Ms <= FRAME_BUDGET_MS
        ? "within 60fps budget"
        : stats.p95Ms <= FRAME_BUDGET_MS * 2
          ? "within 30fps budget"
          : "OVER BUDGET";

  console.log(`\n── ${scene.label} ────────────────────────────────`);
  console.log(`  model build  ${scene.generateMs}ms`);
  console.log(`  ready in     ${scene.mountMs}ms from navigation`);

  for (const measurement of scene.at) {
    console.log(`\n  ${measurement.label}`);
    console.log(
      `    in DOM     ${measurement.domNodes} nodes, ${measurement.domEdges} edges ` +
        `(${measurement.domElements.toLocaleString()} elements)`,
    );
    for (const [name, stats] of [
      ["pan ", measurement.pan],
      ["zoom", measurement.zoom],
    ] as const) {
      console.log(
        `    ${name}       median ${stats.medianMs}ms · p95 ${stats.p95Ms}ms · worst ${stats.worstMs}ms ` +
          `· ${stats.overBudgetPercent}% over 16.7ms — ${verdict(stats)}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const nodes = readArg("nodes", 1000);
  const edges = readArg("edges", 3000);
  const headed = process.argv.includes("--headed");

  const server: ViteDevServer = await createServer({
    root: new URL("..", import.meta.url).pathname,
    server: { port: 0 },
    logLevel: "error",
  });
  await server.listen();

  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === "string") {
    throw new Error("Vite did not report a port");
  }
  const origin = `http://localhost:${address.port}`;

  const browser = await chromium.launch({ headless: !headed });

  try {
    const scenes: Scene[] = [];
    // A small scene first, as a control. Without it a slow number could be the
    // machine, the harness, or the browser rather than the node count, and the
    // gate would be recorded against the wrong cause.
    scenes.push(await measureScene(browser, origin, "control — 100 nodes / 300 edges", 100, 300));
    scenes.push(
      await measureScene(browser, origin, `gate — ${nodes} nodes / ${edges} edges`, nodes, edges),
    );

    for (const scene of scenes) report(scene);

    const gate = scenes.at(-1)!;
    // The gate is judged on the worst measured state, not the friendliest.
    const failed = gate.at.some(
      (measurement) =>
        !measurement.pan.viewportMoved ||
        !measurement.zoom.viewportMoved ||
        measurement.pan.p95Ms > FRAME_BUDGET_MS * 2 ||
        measurement.zoom.p95Ms > FRAME_BUDGET_MS * 2,
    );

    console.log(
      `\n${failed ? "GATE FAILED" : "GATE PASSED"} — record the result in an ADR either way (§9.4).\n`,
    );
    process.exitCode = failed ? 1 : 0;
  } finally {
    await browser.close();
    await server.close();
  }
}

await main();
