import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "../styles/theme.css";

import { GraphCanvas } from "../components/graph/graph-canvas.js";
import { useWorkspace } from "../state/workspace.js";
import { generateGraph } from "./generate.js";
import { installProbe, type PerfProbe } from "./probe.js";

/**
 * The 1k/3k performance harness — plan §9.4, P0 #14.
 *
 * A separate Vite entry rather than a route, for two reasons. Vite's default
 * build input is `index.html` alone, so this page cannot reach a production
 * bundle by accident; and the gate is about the canvas, so measuring it inside
 * the full workspace shell would fold the library's virtualization and the
 * timeline's SVG into a number that is supposed to be about `@xyflow/react`.
 *
 * It renders the *real* `GraphCanvas` against the *real* store. A harness that
 * rendered a simplified stand-in would measure the stand-in, and §9.4 exists
 * precisely because the real component's DOM-per-node rendering is the thing
 * in doubt.
 *
 *     /perf.html?nodes=1000&edges=3000
 */

declare global {
  interface Window {
    __perf?: PerfProbe;
  }
}

function readCount(name: string, fallback: number): number {
  const raw = new URLSearchParams(window.location.search).get(name);
  const value = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function Harness() {
  const nodeCount = readCount("nodes", 1000);
  const edgeCount = readCount("edges", 3000);
  const [buildMs, setBuildMs] = useState<number | null>(null);

  useEffect(() => {
    const startedAt = performance.now();
    const graph = generateGraph(nodeCount, edgeCount);

    useWorkspace.setState({
      source: "demo",
      tracks: graph.tracks,
      nodes: graph.nodes,
      transitions: graph.transitions,
      set: graph.set,
      selectedTrackId: null,
      selectedTransitionId: null,
      multiSelectedTrackIds: [],
    });

    setBuildMs(Math.round(performance.now() - startedAt));
  }, [nodeCount, edgeCount]);

  useEffect(() => installProbe(), []);

  return (
    <div className="bg-canvas h-screen w-screen">
      <div
        data-testid="perf-legend"
        className="text-ink-muted bg-surface/80 pointer-events-none absolute top-2 left-2 z-50 rounded px-2 py-1 font-mono text-[11px]"
      >
        {nodeCount} nodes · {edgeCount} edges
        {buildMs === null ? " · generating…" : ` · generated in ${buildMs}ms`}
      </div>
      <GraphCanvas />
    </div>
  );
}

const container = document.getElementById("root")!;
createRoot(container).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
