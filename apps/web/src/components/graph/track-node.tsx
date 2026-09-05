import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Layers, Sparkles, TriangleAlert } from "lucide-react";
import { useTrackById, useWorkspace } from "../../state/workspace.js";
import {
  Artwork,
  Bpm,
  CamelotKey,
  EnergyDots,
  SourceDot,
  Truncate,
  Waveform,
  cx,
} from "../primitives.js";
import { Pill } from "../ui.js";

/**
 * A track on the canvas.
 *
 * Fixed dimensions rather than intrinsic sizing: the canvas needs the size to
 * place a dropped track under the cursor and to reason about overlap, and a
 * node whose height depends on how many badges it happens to carry makes edge
 * anchors drift as data changes.
 */
export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 104;

export interface TrackNodeData extends Record<string, unknown> {
  readonly trackId: string;
  /** Below the zoom threshold the node renders as a compact chip. */
  readonly simplified: boolean;
  readonly inActiveSet: boolean;
  /** 1-based position in the active set, or null when not a member. */
  readonly setPosition: number | null;
  readonly isAiSuggested: boolean;
}

export const TrackNode = memo(function TrackNode({
  data,
  selected,
  dragging,
}: NodeProps<Node<TrackNodeData>>) {
  /*
   * Both selectors return a boolean, so zustand re-renders only the two or
   * three nodes whose answer actually flipped. §18 forbids repainting the
   * whole graph on a selection change, and subscribing to the selection object
   * itself would do exactly that.
   */
  const isPrimary = useWorkspace(
    (state) => state.selectedTrackId === data.trackId,
  );
  const inMultiSelection = useWorkspace((state) =>
    state.multiSelectedTrackIds.includes(data.trackId),
  );

  const track = useTrackById(data.trackId);

  // Mutually exclusive by construction: a member of a group that is not the
  // primary reads as multi-selected even while React Flow also flags it
  // `selected`, which it does for the whole rectangle during a box-select.
  const isMultiSelected = inMultiSelection && !isPrimary;
  const isSelected = !isMultiSelected && (selected || isPrimary);

  if (!track) {
    // A node can outlive its track — a graph saved before a library re-import,
    // say. Rendering the id keeps the edge topology intact and debuggable
    // instead of dropping a hole in the middle of the path.
    return (
      <div
        role="img"
        aria-label="Track unavailable"
        style={{ width: NODE_WIDTH }}
        className="border-border-strong bg-surface-card text-ink-subtle rounded-card flex h-8 items-center border border-dashed px-2 text-node-label"
      >
        <Handle type="target" position={Position.Left} />
        <Truncate className="flex-1">{`Track unavailable — ${data.trackId}`}</Truncate>
        <Handle type="source" position={Position.Right} />
      </div>
    );
  }

  const missing = track.source === "missing";

  if (data.simplified) {
    /*
     * Below the zoom threshold, the budget is DOM nodes, not fidelity: at a
     * thousand tracks the artwork, waveform, and badges cost more than they
     * communicate at 8px tall. The set bar rides on the left border so the
     * chip keeps its element count.
     */
    return (
      <div
        aria-hidden="true"
        style={{
          width: NODE_WIDTH,
          ...(data.inActiveSet ? { borderLeftColor: "var(--color-accent)" } : {}),
        }}
        className={cx(
          "rounded-control flex items-center gap-2 border px-2 py-1",
          data.inActiveSet && "border-l-[3px]",
          isSelected
            ? "border-accent bg-surface-selected ring-accent/60 ring-1"
            : isMultiSelected
              ? "border-accent/70 bg-surface-raised"
              : cx(
                  "bg-surface-card hover:border-border-strong",
                  data.isAiSuggested ? "border-accent/50 border-dashed" : "border-border",
                ),
          dragging && "opacity-90 shadow-lg shadow-black/60",
        )}
      >
        <Handle type="target" position={Position.Left} />
        <Truncate className="text-ink flex-1 text-node-label">{track.title}</Truncate>
        <Bpm value={track.bpm} />
        <Handle type="source" position={Position.Right} />
      </div>
    );
  }

  return (
    /*
     * The React Flow wrapper is a focusable, labelled button. Everything inside
     * is visual decoration for that control, so it stays out of the accessibility
     * tree instead of presenting the selectable node as an image.
     */
    <div
      aria-hidden="true"
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      className={cx(
        "rounded-card relative flex flex-col justify-between gap-1.5 border px-2.5 py-2 transition-colors",
        // Selection is a border, a raised surface, *and* a ring; the ring is
        // what survives greyscale and what separates it from set membership,
        // which paints a bar and nothing else (§17).
        isSelected
          ? "border-accent bg-surface-selected ring-accent/60 shadow-lg shadow-black/40 ring-1"
          : isMultiSelected
            ? // A group member: same violet, no ring and no tint. The
              // difference is geometric, not chromatic.
              "border-accent/70 bg-surface-raised shadow-md shadow-black/30"
            : cx(
                "bg-surface-card hover:border-border-strong hover:bg-surface-hover",
                data.isAiSuggested
                  ? // Dashed reads as provisional at any zoom and in any
                    // palette — the Sparkles pill is the second cue.
                    "border-accent/50 border-dashed"
                  : missing
                    ? "border-danger/45"
                    : "border-border",
              ),
        dragging && "opacity-90 shadow-2xl shadow-black/60",
      )}
    >
      <Handle type="target" position={Position.Left} />

      {data.inActiveSet && (
        <span
          aria-hidden="true"
          className="bg-accent/80 absolute inset-y-2 left-0 w-[3px] rounded-r-full"
        />
      )}

      <div className="flex items-start gap-2">
        <Artwork seed={track.id} size={40} />
        <div className="min-w-0 flex-1">
          <Truncate className="text-ink text-node-title leading-tight font-medium">
            {track.title}
          </Truncate>
          <Truncate className="text-ink-muted text-node-label leading-tight">{track.artist}</Truncate>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <Bpm value={track.bpm} />
          <CamelotKey value={track.keySignature} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Muted where there is no local file: the peaks would be invented. */}
        <Waveform
          trackId={track.id}
          bars={28}
          energy={track.energy}
          muted={track.source !== "local"}
          {...(isSelected ? { color: "var(--color-waveform-active)" } : {})}
          className="flex-1"
        />
        <EnergyDots value={track.energy} size={5} />
      </div>

      <div className="flex h-3.5 items-center gap-1.5">
        {data.setPosition !== null && (
          <Pill tone="accent" title={`Position ${data.setPosition} in the set`}>
            #{data.setPosition}
          </Pill>
        )}
        {track.source !== "local" && <SourceDot source={track.source} />}
        {missing && (
          <span title="Local file missing" className="text-danger inline-flex">
            <TriangleAlert size={11} aria-hidden="true" />
          </span>
        )}
        {data.isAiSuggested && (
          <Pill tone="info" title="Suggested by AI">
            <Sparkles size={9} aria-hidden="true" />
            AI
          </Pill>
        )}
        {track.hasStems && (
          <span title="Stems available" className="text-ink-subtle inline-flex">
            <Layers size={11} aria-hidden="true" />
          </span>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
});
