import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { Button } from "react-aria-components";
import { AlertTriangle, Sparkles } from "lucide-react";
import { TECHNIQUE_COLOR, techniqueSpec, trackById } from "../../lib/demo-data.js";
import { useWorkspace } from "../../state/workspace.js";
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
  readonly inActiveSet: boolean;
  readonly isAiSuggested: boolean;
  readonly hasWarning: boolean;
}

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

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
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

  const from = trackById(transition?.sourceTrackId);
  const to = trackById(transition?.targetTrackId);
  const endpoints = from && to ? ` from ${from.title} to ${to.title}` : "";
  const length = transition ? `, ${transition.bars} bars` : "";
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
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
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
              "bg-surface-overlay flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium whitespace-nowrap",
              isAiSuggested ? "border-dashed" : "border-solid",
              selected && "ring-accent ring-1",
            )}
            style={{
              // Dynamic per technique, so it cannot come from a utility class.
              color,
              borderColor: isAiSuggested
                ? "var(--color-accent)"
                : selected || inActiveSet
                  ? color
                  : "var(--color-border-strong)",
              opacity: weight === "alt" ? 0.6 : 1,
            }}
          >
            {isAiSuggested && <Sparkles size={9} aria-hidden="true" className="text-accent" />}
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
