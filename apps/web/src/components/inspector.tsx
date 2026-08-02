import { useQuery } from "@tanstack/react-query";
import { suggestTransitions } from "../lib/graph-api.js";
import { Artwork, Bpm, CamelotKey, EmptyState, Panel } from "./primitives.js";

/**
 * Track inspector — plan §9.6.
 *
 * Shows what we actually have. The mockup's Hot Cues and Stems panels need
 * GEOB parsing and audio analysis of a local file; the S0 scan found most
 * library entries are streaming with no local file at all, so those are
 * stated as unavailable rather than rendered as empty chrome that looks
 * broken.
 */

export interface InspectorTrack {
  id: string;
  title: string;
  artist: string;
  bpm: number | null;
  keySignature: string | null;
}

const RELATION_LABEL: Record<string, string> = {
  identical: "Same key",
  adjacent: "Adjacent",
  relative: "Relative maj/min",
  diagonal: "Diagonal",
  "energy-boost": "Energy boost",
  distant: "Distant",
};

export function Inspector({ track }: { track: InspectorTrack | null }) {
  const { data: suggestions, isPending } = useQuery({
    queryKey: ["suggestions", track?.id],
    queryFn: () => suggestTransitions(track!.id, 8),
    enabled: track !== null,
  });

  if (!track) {
    return (
      <Panel title="Inspector" className="w-[300px] shrink-0">
        <EmptyState title="Select a track" hint="Click a node on the canvas." />
      </Panel>
    );
  }

  return (
    <Panel title="Inspector" className="w-[300px] shrink-0">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-border flex items-center gap-3 border-b p-3">
          <Artwork seed={track.id} size={48} />
          <div className="min-w-0">
            <p className="text-ink truncate text-sm font-medium">{track.title}</p>
            <p className="text-ink-muted truncate text-xs">{track.artist}</p>
            <div className="mt-1 flex items-center gap-2">
              <Bpm value={track.bpm} />
              <CamelotKey value={track.keySignature} />
            </div>
          </div>
        </div>

        <section className="border-border border-b p-3">
          <h3 className="text-ink-muted mb-2 text-[11px] font-medium tracking-wide uppercase">
            Suggested transitions
          </h3>

          {isPending ? (
            <p className="text-ink-subtle text-xs">Scoring…</p>
          ) : !suggestions || suggestions.length === 0 ? (
            <p className="text-ink-subtle text-xs">No other tracks to compare.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {suggestions.map((suggestion) => (
                <li
                  key={suggestion.track.id}
                  className="border-border bg-surface-raised rounded-md border px-2 py-1.5"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-ink truncate text-xs">
                      {suggestion.track.title}
                    </span>
                    <span className="text-ink font-mono text-xs tabular-nums">
                      {Math.round(suggestion.score * 100)}%
                    </span>
                  </div>
                  <div className="text-ink-subtle mt-0.5 flex items-center gap-2 text-[11px]">
                    <span>{suggestion.track.artist}</span>
                    <Bpm value={suggestion.track.bpm} />
                    <CamelotKey value={suggestion.track.keySignature} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {suggestion.harmonicRelation && (
                      <span className="border-border text-ink-muted rounded border px-1 py-px text-[10px]">
                        {RELATION_LABEL[suggestion.harmonicRelation] ??
                          suggestion.harmonicRelation}
                      </span>
                    )}
                    {suggestion.pitchAdjustment !== null &&
                      Math.abs(suggestion.pitchAdjustment) > 0.0005 && (
                        <span className="border-border text-ink-muted rounded border px-1 py-px text-[10px]">
                          {suggestion.pitchAdjustment > 0 ? "+" : ""}
                          {(suggestion.pitchAdjustment * 100).toFixed(1)}% pitch
                        </span>
                      )}
                    {suggestion.warnings.length > 0 && (
                      <span
                        className="text-warn text-[10px]"
                        title={suggestion.warnings.join("\n")}
                      >
                        {suggestion.warnings.length} warning
                        {suggestion.warnings.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Honest about what has no data source yet, rather than rendering
            empty chrome that reads as broken. */}
        <section className="p-3">
          <h3 className="text-ink-muted mb-2 text-[11px] font-medium tracking-wide uppercase">
            Not available yet
          </h3>
          <dl className="flex flex-col gap-1.5 text-[11px]">
            {[
              ["Hot cues", "Needs GEOB tags from a local file (Phase 4)"],
              ["Waveform", "Needs peak data from the desktop bridge"],
              ["Stems", "Out of MVP scope"],
              ["Energy", "Needs audio analysis"],
            ].map(([label, why]) => (
              <div key={label} className="flex justify-between gap-2">
                <dt className="text-ink-subtle">{label}</dt>
                <dd className="text-ink-subtle text-right">{why}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </Panel>
  );
}
