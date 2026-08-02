import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Artwork, Bpm, CamelotKey, EnergyDots } from "./primitives.js";

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

export const TrackNode = memo(function TrackNode({
  data,
  selected,
}: NodeProps<Node<TrackNodeData>>) {
  const border = selected ? "border-accent" : "border-border";

  if (data.simplified) {
    // Simplified rendering below the zoom threshold. Plan §9.8 lists this as
    // the first mitigation for the 1k-node budget: fewer DOM nodes per track
    // is the only thing that actually helps at that scale.
    return (
      <div
        className={`bg-surface-raised ${border} flex items-center gap-2 rounded-md border px-2 py-1`}
        title={`${data.artist} — ${data.title}`}
      >
        <Handle type="target" position={Position.Left} />
        <span className="text-ink max-w-[120px] truncate text-[11px]">{data.title}</span>
        <Bpm value={data.bpm} />
        <Handle type="source" position={Position.Right} />
      </div>
    );
  }

  return (
    <div
      className={`bg-surface-raised ${border} w-[220px] rounded-[10px] border p-2.5 shadow-lg`}
    >
      <Handle type="target" position={Position.Left} />

      <div className="flex items-start gap-2">
        <Artwork seed={data.trackId} size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-ink truncate text-[13px] font-medium">{data.title}</p>
          <p className="text-ink-muted truncate text-[11px]">{data.artist}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <Bpm value={data.bpm} />
          <CamelotKey value={data.keySignature} />
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between">
        {/* Waveform needs peak data from the desktop bridge (plan §15.2), and
            the S0 scan found most library entries are streaming with no local
            file at all. A placeholder bar keeps the layout honest rather than
            faking a waveform. */}
        <div className="bg-border h-[3px] flex-1 rounded-full" aria-hidden="true" />
        <div className="ml-2">
          <EnergyDots value={data.energy} />
        </div>
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
});
