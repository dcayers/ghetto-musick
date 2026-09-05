import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useStore,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { Button } from "react-aria-components";
import { AlertTriangle, Sparkles } from "lucide-react";
import { TECHNIQUE_COLOR, techniqueSpec } from "../../lib/workspace-data.js";
import { useTrackById, useWorkspace } from "../../state/workspace.js";
import { cx } from "../primitives.js";

/**
 * A transition on the canvas.
 *
 * §7 asks for a *readable* edge, which means the technique has to survive
 * greyscale: hue names the family, the dash pattern separates families that
 * sit near each other on the wheel, and the label spells it out. Any one of
 * the three alone is a guess.
 *
 * §13 governs the two weights. An edge off the active set is thinned and
 * quietened but never hidden — the alternatives are the point of the graph,
 * and a route you cannot see is a route you cannot take.
 */

export interface TransitionEdgeData extends Record<string, unknown> {
  readonly transitionId: string;
  readonly technique: string;
  /** Lateral offset among parallel routes on the same pair: 0, then alternating outward. */
  readonly parallelOffset: number;
  readonly inActiveSet: boolean;
  readonly isAiSuggested: boolean;
  readonly hasWarning: boolean;
}

/**
 * Zoom below which the label stops shrinking with the canvas.
 *
 * Mirrors `SIMPLIFY_BELOW_ZOOM` in graph-canvas.tsx deliberately rather than
 * importing it: graph-canvas imports this module, so the dependency would be
 * circular. Kept equal so a node dropping to its simplified chip and a label
 * reaching its floor happen at the same moment.
 */
const LABEL_ZOOM_FLOOR = 0.45;

/** Which of the three visual weights an edge is drawn at. */
type EdgeWeight = "selected" | "set" | "alt";

const STROKE_WIDTH: Readonly<Record<EdgeWeight, number>> = {
  selected: 4,
  set: 3,
  alt: 1.5,
};

const STROKE_OPACITY: Readonly<Record<EdgeWeight, number>> = {
  selected: 1,
  set: 1,
  alt: 0.45,
};

/** Arrowhead size in flow units. Fixed rather than stroke-relative so a 4px
 *  selected edge does not sprout an arrow three times the size of its neighbours. */
const MARKER_SIZE: Readonly<Record<EdgeWeight, number>> = {
  selected: 11,
  set: 10,
  alt: 8,
};

export const TransitionEdge = memo(function TransitionEdge({
  data,
  selected,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
}: EdgeProps<Edge<TransitionEdgeData>>) {
  // `transform[2]` is the viewport scale. Subscribing to just that number keeps
  // a pan from re-rendering every edge on the canvas.
  const zoom = useStore((state) => state.transform[2]);
  const transitionId = data?.transitionId ?? null;
  const selectTransition = useWorkspace((state) => state.selectTransition);
  // Read the transition rather than widening `data`: bars, endpoints, and
  // warning text are editable through the inspector, and a copy baked into the
  // edge payload would go stale the moment one of them changed.
  const transition = useWorkspace((state) =>
    transitionId === null
      ? null
      : (state.transitions.find((tx) => tx.id === transitionId) ?? null),
  );

  // Parallel routes bow apart. Curvature rather than a translated copy, so
  // both still meet their handles exactly and the arcs read as alternatives
  // between the same two tracks rather than as edges to somewhere else.
  const offset = data?.parallelOffset ?? 0;
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.25 + offset * 0.45,
  });

  const spec = techniqueSpec(data?.technique ?? "blend");
  const color = TECHNIQUE_COLOR[spec.family];
  const inActiveSet = data?.inActiveSet ?? false;
  const isAiSuggested = data?.isAiSuggested ?? false;
  const hasWarning = data?.hasWarning ?? false;

  const weight: EdgeWeight = selected ? "selected" : inActiveSet ? "set" : "alt";
  const strokeWidth = STROKE_WIDTH[weight];
  const strokeOpacity = STROKE_OPACITY[weight];

  // Keyed by family and weight, not by edge id. Every arrowhead drawn at the
  // same family and weight is pixel-identical, so one definition serves them
  // all; keying it any coarser would let one family's colour bleed into
  // another's arrows, and any finer would mint a marker per edge.
  const markerId = `fg-arrow-${spec.family}-${weight}`;
  const markerSize = MARKER_SIZE[weight];

  const from = useTrackById(transition?.sourceTrackId);
  const to = useTrackById(transition?.targetTrackId);
  const endpoints = from && to ? ` from ${from.title} to ${to.title}` : "";
  // Omitted when the length has not been chosen: a template literal reads a
  // null as the word "null", so this announced "Echo out, null bars" for every
  // transition drawn on the canvas and not yet refined.
  const length =
    transition?.bars === null || transition?.bars === undefined
      ? ""
      : `, ${transition.bars} bars`;
  const ariaLabel =
    `${spec.label}${endpoints}${length}` +
    (isAiSuggested ? ", AI suggested" : "") +
    // The quieter stroke is the only thing that says "alternative" on screen;
    // it has to be said out loud too (§17).
    (inActiveSet ? "" : ", alternative route") +
    (selected ? ", selected" : "");

  const warnings = transition?.warnings ?? [];
  const warningLabel =
    warnings.length > 0 ? `Warning: ${warnings.join(". ")}` : "This transition has a warning";

  return (
    <>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth={markerSize}
          markerHeight={markerSize}
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path d="M0.5 1 L9 5 L0.5 9 Z" fill={color} opacity={strokeOpacity} />
        </marker>
      </defs>

      {selected && (
        // A halo rather than a colour change: the technique hue has to stay
        // readable while selected, so selection is carried by the extra
        // outline instead of overwriting the one signal the edge exists for.
        <path
          d={path}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={strokeWidth + 6}
          strokeOpacity={0.3}
          strokeLinecap="round"
          className="pointer-events-none"
        />
      )}

      <BaseEdge
        path={path}
        markerEnd={`url(#${markerId})`}
        style={{
          stroke: color,
          strokeWidth,
          strokeLinecap: "round",
          opacity: strokeOpacity,
          ...(spec.dash !== null ? { strokeDasharray: spec.dash } : {}),
        }}
      />

      <EdgeLabelRenderer>
        <div
          // The renderer's container is pointer-events:none so edges stay
          // clickable through it; the label has to opt back in.
          className="nodrag nopan absolute flex items-center gap-1"
          onClick={(event) => event.stopPropagation()}
          style={{
            /*
             * Counter-scaled against the viewport.
             *
             * `EdgeLabelRenderer` portals *inside* React Flow's transformed
             * viewport, so an 11px label renders at 11 × zoom. The canvas
             * allows zoom down to 0.1 and `fitView` opens below 1.0 whenever
             * the graph does not fit — so the technique labels routinely
             * opened at two or three pixels. Nodes already have a fallback for
             * this (they drop to a simplified chip below 0.45); edges had none.
             *
             * Only ever scaled *up*, never down: past 1.0 the label is already
             * legible and enlarging it would swamp the canvas.
             */
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px) scale(${Math.min(1 / zoom, 1 / LABEL_ZOOM_FLOOR)})`,
            pointerEvents: "all",
          }}
        >
          <Button
            isDisabled={transitionId === null}
            onPress={() => {
              if (transitionId !== null) selectTransition(transitionId);
            }}
            aria-label={ariaLabel}
            className={cx(
              "bg-canvas/75 flex items-center gap-1 rounded px-1 py-px text-label font-medium whitespace-nowrap",
              selected && "ring-accent ring-1",
            )}
            style={{
              // Dynamic per technique, so it cannot come from a utility class.
              color,
              /*
               * The label is never dimmed.
               *
               * An alternative route is signalled by its stroke — 1.5px at 45%
               * opacity — and that is the whole of the signal. Fading the label
               * as well pushed three of the six technique hues under AA (cut
               * and effect to ~4.3, the unmapped fallback to 2.68), and the
               * label is the greyscale-survivable half of the triple encoding
               * that PRODUCT.md requires. Quietening the route is the point;
               * quietening the word for it is not.
               */
            }}
          >
            {isAiSuggested && <Sparkles size={9} aria-hidden="true" className="text-accent-text" />}
            {spec.label}
          </Button>

          {hasWarning && (
            <span
              role="img"
              aria-label={warningLabel}
              title={warningLabel}
              className="text-warn grid place-items-center"
            >
              <AlertTriangle size={11} aria-hidden="true" />
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
