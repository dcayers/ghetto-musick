import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Artwork, Bpm, CamelotKey, EnergyDots, cx } from "./primitives.js";
import { MiniWaveform } from "./ui.js";

/**
 * A track on the canvas.
 *
 * `memo` matters here rather than being cargo-cult: React Flow re-renders
 * every node on viewport change, and plan §3.5 targets 1,000 nodes. Without
 * memoisation each pan repaints the whole graph.
 */
export interface TrackNodeData extends Record<string, unknown> {
  readonly trackId: string;
  readonly title: string;
  readonly artist: string;
  readonly bpm: number | null;
  readonly keySignature: string | null;
  readonly energy: number | null;
  /** Below this zoom the node renders as a simplified chip — plan §9.8. */
  readonly simplified: boolean;
}

const HANDLE = "!size-2.5 !border-2 !border-border-strong !bg-surface-overlay";

export const TrackNode = memo(function TrackNode({
  data,
  selected,
}: NodeProps<Node<TrackNodeData>>) {
  if (data.simplified) {
    // Simplified rendering below the zoom threshold. Plan §9.8 lists this as
    // the first mitigation for the 1k-node budget, and fewer DOM nodes per
    // track is the only thing that actually helps at that scale — so this
    // variant drops the artwork, waveform, and energy entirely.
    return (
      <div
        className={cx(
          "bg-surface-raised flex items-center gap-2 rounded-md border px-2 py-1",
          selected ? "border-accent" : "border-border",
        )}
        title={`${data.artist} — ${data.title}`}
      >
        <Handle type="target" position={Position.Left} className={HANDLE} />
        <span className="text-ink max-w-[120px] truncate text-[11px]">{data.title}</span>
        <Bpm value={data.bpm} />
        <Handle type="source" position={Position.Right} className={HANDLE} />
      </div>
    );
  }

  return (
    <div
      className={cx(
        "bg-surface-raised w-[230px] rounded-[10px] border p-2.5 shadow-lg transition-colors",
        selected ? "border-accent ring-accent/30 ring-2" : "border-border",
      )}
    >
      <Handle type="target" position={Position.Left} className={HANDLE} />

      <div className="flex items-start gap-2">
        <Artwork seed={data.trackId} size={38} />
        <div className="min-w-0 flex-1">
          <p className="text-ink truncate text-[13px] font-medium">{data.title}</p>
          <p className="text-ink-muted truncate text-[11px]">{data.artist}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <Bpm value={data.bpm} />
          <CamelotKey value={data.keySignature} />
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <MiniWaveform trackId={data.trackId} bars={32} className="h-3 flex-1" />
        <EnergyDots value={data.energy} />
      </div>

      <Handle type="source" position={Position.Right} className={HANDLE} />
    </div>
  );
});
