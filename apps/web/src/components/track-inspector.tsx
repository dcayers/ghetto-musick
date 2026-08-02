import { useMemo, useRef, useState } from "react";
import { Button, Group, Input, TextField } from "react-aria-components";
import { ArrowRight, Maximize2, Pencil, Repeat, Star, Trash2 } from "lucide-react";
import { Artwork, Bpm, CamelotKey, EmptyState, Panel, cx } from "./primitives.js";
import {
  DemoBadge,
  DetailWaveform,
  Field,
  IconButton,
  LevelSlider,
  MiniToggle,
  Pill,
  Section,
  StarRating,
  type WaveformCue,
} from "./ui.js";
import {
  CUE_COLORS,
  commentFor,
  durationFor,
  formatDuration,
  genreFor,
  hotCuesFor,
  ratingFor,
  stemsFor,
  yearFor,
} from "../lib/mock.js";

/**
 * Track inspector — plan §9.6.
 *
 * The densest surface in the app: header, waveform, and four collapsible
 * sections. Three of those sections are demo-backed and one (Suggest
 * Transitions) is live, so each demo section carries a `DemoBadge` — the
 * design can only be judged if it is obvious which numbers are real.
 */

export interface InspectorTrackSummary {
  id: string;
  title: string;
  artist: string;
  bpm: number | null;
  keySignature: string | null;
}

export interface TransitionSuggestion {
  track: InspectorTrackSummary;
  score: number;
  harmonicRelation: string | null;
  pitchAdjustment: number | null;
  warnings: string[];
}

export interface TrackInspectorProps {
  track: InspectorTrackSummary | null;
  suggestions: TransitionSuggestion[];
  isLoadingSuggestions: boolean;
  isFavourite: boolean;
  onToggleFavourite: (isFavourite: boolean) => void;
  onViewAllSuggestions: () => void;
  /** Fires when an edited comment is committed. Local until then. */
  onCommentChange?: ((trackId: string, comment: string) => void) | undefined;
  /**
   * Promotes the top suggestion to a real transition. The section's `+` only
   * appears when this is supplied — a button that silently does nothing is
   * worse than an absent one.
   */
  onAddTransition?: ((toTrackId: string) => void) | undefined;
}

/** Camelot relation → prose, matching the domain package's vocabulary. */
const RELATION_LABEL: Record<string, string> = {
  identical: "Same key",
  adjacent: "Adjacent",
  relative: "Relative",
  diagonal: "Diagonal",
  "energy-boost": "Energy boost",
  distant: "Distant",
};

/**
 * Match strength colour.
 *
 * Decoration only — the percentage beside it carries the meaning, which is
 * what §9.6 requires of anything colour-coded.
 */
function scoreTone(score: number): string {
  if (score >= 0.8) return "text-ok";
  if (score >= 0.55) return "text-warn";
  return "text-ink-muted";
}

/**
 * Demo marker for a section body.
 *
 * `Section` takes a plain string title, so the badge rides at the top of the
 * content rather than in the header. Pairing it with the reason keeps the
 * "why is this fake" answer next to the fake numbers.
 */
function DemoNote({ what, why }: { what: string; why: string }) {
  return (
    <p className="text-ink-subtle mb-2 flex items-center gap-1.5 text-[10px]">
      <DemoBadge what={what} />
      <span className="truncate">{why}</span>
    </p>
  );
}

export function TrackInspector({ track, ...rest }: TrackInspectorProps) {
  if (track === null) {
    return (
      <Panel title="Inspector" className="w-[300px] shrink-0">
        <EmptyState title="Select a track" hint="Click a node on the canvas." />
      </Panel>
    );
  }

  return (
    <Panel title="Inspector" className="w-[300px] shrink-0">
      {/* Keyed by track id: every editable block below is local state seeded
          from the track. Remounting is cheaper and far less error-prone than
          syncing six pieces of state in an effect on every selection change. */}
      <LoadedInspector key={track.id} track={track} {...rest} />
    </Panel>
  );
}

/* ---------------------------------------------------------------- loaded -- */

interface CueRow {
  /** Stable across renames and deletions; the displayed number is positional. */
  key: string;
  seconds: number;
  label: string;
  color: string;
}

interface StemRow {
  name: string;
  level: number;
  solo: boolean;
  mute: boolean;
  loop: boolean;
  expanded: boolean;
}

type LoadedInspectorProps = Omit<TrackInspectorProps, "track"> & {
  track: InspectorTrackSummary;
};

function LoadedInspector({
  track,
  suggestions,
  isLoadingSuggestions,
  isFavourite,
  onToggleFavourite,
  onViewAllSuggestions,
  onCommentChange,
  onAddTransition,
}: LoadedInspectorProps) {
  const duration = durationFor(track.id);

  const [rating, setRating] = useState(() => ratingFor(track.id));
  const [comment, setComment] = useState(() => commentFor(track.id));
  const [isEditingComment, setIsEditingComment] = useState(false);
  const [draftComment, setDraftComment] = useState("");

  const [cues, setCues] = useState<CueRow[]>(() =>
    hotCuesFor(track.id).map((cue, index) => ({
      key: `cue-${index}`,
      seconds: cue.seconds,
      label: cue.label,
      color: cue.color,
    })),
  );
  const nextCueKey = useRef(cues.length);

  const [stems, setStems] = useState<StemRow[]>(() =>
    stemsFor(track.id).map((stem) => ({ ...stem, loop: false, expanded: false })),
  );

  function commitComment(next: string) {
    setComment(next);
    setIsEditingComment(false);
    if (next !== comment) onCommentChange?.(track.id, next);
  }

  /**
   * The waveform spans the whole track.
   *
   * An earlier version drew a "working window" starting 18% in — but
   * `DetailWaveform` always renders peaks across the full track, so the labels
   * and every cue marker were offset from the bars they described. Since there
   * is no transport to scrub with yet, a zoom that only the labels believed in
   * bought nothing and lied about the drawing.
   */
  const waveformCues = useMemo<WaveformCue[]>(
    () =>
      cues.map((cue, index) => ({
        seconds: cue.seconds,
        color: cue.color,
        label: `${index + 1}. ${cue.label}`,
      })),
    [cues],
  );

  function addCue() {
    // A real add drops a cue at the playhead; there is no transport yet, so
    // new cues land at the midpoint and are spread apart so two adds are
    // distinguishable rather than stacking on the same pixel.
    setCues((current) => {
      const ordinal = nextCueKey.current;
      nextCueKey.current += 1;
      return [
        ...current,
        {
          key: `cue-${ordinal}`,
          seconds: Math.min(duration, Math.round(duration * 0.5) + ordinal * 8),
          label: "New cue",
          // Keyed off a monotonic counter, not the live length: deleting two
          // cues and adding one must not reuse a colour already on screen.
          color: CUE_COLORS[ordinal % CUE_COLORS.length] ?? CUE_COLORS[0],
        },
      ];
    });
  }

  function updateStem(name: string, patch: Partial<StemRow>) {
    setStems((current) =>
      current.map((stem) => (stem.name === name ? { ...stem, ...patch } : stem)),
    );
  }

  const topSuggestion = suggestions[0];
  const addTransitionProps =
    onAddTransition && topSuggestion
      ? {
          onAdd: () => onAddTransition(topSuggestion.track.id),
          addLabel: `Add transition to ${topSuggestion.track.title}`,
        }
      : {};

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <header className="border-border flex items-start gap-3 border-b p-3">
        <Artwork seed={track.id} size={48} />
        <div className="min-w-0 flex-1">
          <p className="text-ink truncate text-sm font-medium">{track.title}</p>
          <p className="text-ink-muted truncate text-xs">{track.artist}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="flex items-baseline gap-1">
              <Bpm value={track.bpm} />
              {track.bpm !== null && <span className="text-bpm text-[10px]">BPM</span>}
            </span>
            <CamelotKey value={track.keySignature} />
          </div>
        </div>
        <IconButton
          icon={Star}
          // The name states the outcome so the star's fill is never the only
          // thing distinguishing the two states.
          label={isFavourite ? "Remove from favourites" : "Add to favourites"}
          isActive={isFavourite}
          onPress={() => onToggleFavourite(!isFavourite)}
          {...(isFavourite ? { iconClassName: "fill-energy text-energy" } : {})}
        />
      </header>

      <div className="border-border border-b p-3">
        <DetailWaveform trackId={track.id} durationSeconds={duration} cues={waveformCues} />
        <div className="text-ink-subtle mt-1.5 flex items-center justify-between gap-2 font-mono text-[10px] tabular-nums">
          <span>0:00</span>
          <DemoBadge what="Waveform peaks and cue positions" />
          <span>{formatDuration(duration)}</span>
        </div>
      </div>

      <Section title="Metadata">
        <DemoNote what="Genre, year, duration, rating, comment" why="No metadata endpoint yet" />
        <dl>
          <Field label="Key">
            <CamelotKey value={track.keySignature} />
          </Field>
          <Field label="BPM">
            <Bpm value={track.bpm} />
          </Field>
          <Field label="Genre">{genreFor(track.id)}</Field>
          <Field label="Year">{yearFor(track.id)}</Field>
          <Field label="Duration">{formatDuration(duration)}</Field>
          <Field label="Rating">
            <StarRating value={rating} onChange={setRating} />
          </Field>
        </dl>

        {/* Outside the <dl>: `Field`'s value cell is a shrink-to-fit, truncating
            flex item, which would clip the input and its focus ring. */}
        <div className="mt-2">
          <p className="text-ink-subtle mb-1 text-[11px]">Comment</p>
          {isEditingComment ? (
            <TextField
              aria-label="Track comment"
              value={draftComment}
              onChange={setDraftComment}
              autoFocus
              // No "already handled" latch here. Enter and Escape both unmount
              // the input, and browsers do not fire blur for a removed element,
              // so blur can only mean "the user clicked away while still
              // editing" — which is exactly a commit.
              onBlur={() => commitComment(draftComment.trim())}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitComment(draftComment.trim());
                } else if (event.key === "Escape") {
                  setIsEditingComment(false);
                }
              }}
              className="w-full"
            >
              <Input className="border-border bg-surface-raised text-ink focus:border-accent w-full rounded border px-1.5 py-1 text-[11px] outline-none" />
            </TextField>
          ) : (
            <Button
              onPress={() => {
                setDraftComment(comment);
                setIsEditingComment(true);
              }}
              aria-label="Edit comment"
              className="text-ink hover:text-accent border-border/0 hover:border-border flex w-full min-w-0 items-center justify-between gap-1 rounded border px-1.5 py-1 text-left text-[11px]"
            >
              <span className="truncate">{comment || "Add a comment"}</span>
              <Pencil size={11} className="text-ink-subtle shrink-0" aria-hidden="true" />
            </Button>
          )}
        </div>
      </Section>

      <Section title="Hot Cues" onAdd={addCue} addLabel="Add hot cue">
        <DemoNote what="Hot cues" why="GEOB tags need a local file (ADR-0010)" />
        <ul className="flex flex-col gap-1">
          {cues.map((cue, index) => (
            <li key={cue.key} className="flex items-center gap-2">
              {/* The chip's colour is decoration; the number inside it and the
                  input's accessible name both carry the identity. */}
              <span
                aria-hidden="true"
                className="grid size-4 shrink-0 place-items-center rounded text-[9px] font-semibold text-black"
                style={{ background: cue.color }}
              >
                {index + 1}
              </span>
              <span className="text-ink-muted shrink-0 font-mono text-[11px] tabular-nums">
                {formatDuration(cue.seconds)}
              </span>
              <TextField
                aria-label={`Label for hot cue ${index + 1} at ${formatDuration(cue.seconds)}`}
                value={cue.label}
                onChange={(value) =>
                  setCues((current) =>
                    current.map((row) => (row.key === cue.key ? { ...row, label: value } : row)),
                  )
                }
                className="min-w-0 flex-1"
              >
                <Input className="border-border/0 hover:border-border focus:border-accent text-ink w-full rounded border bg-transparent px-1 py-0.5 text-[11px] outline-none" />
              </TextField>
              <IconButton
                icon={Trash2}
                label={`Delete hot cue ${index + 1}, ${cue.label}`}
                onPress={() => setCues((current) => current.filter((row) => row.key !== cue.key))}
                size={12}
              />
            </li>
          ))}
        </ul>
      </Section>

      {/* Stems are out of MVP scope (plan §3.4). This section exists only to
          evaluate whether the mockup's four-control row survives at the
          inspector's real width — nothing here is on the roadmap. */}
      <Section title="Stems">
        <DemoNote what="Stems" why="Out of MVP scope (plan §3.4) — layout study" />
        <ul className="flex flex-col gap-1.5">
          {stems.map((stem) => (
            <li key={stem.name}>
              {/* MiniToggle's accessible name is its visible glyph ("S"/"M"),
                  so the row group supplies the context a screen reader needs. */}
              <Group aria-label={`${stem.name} stem`} className="flex items-center gap-1.5">
                <span className="text-ink-muted w-12 shrink-0 truncate text-[11px]">
                  {stem.name}
                </span>
                <MiniToggle
                  label="S"
                  isSelected={stem.solo}
                  onChange={(solo) => updateStem(stem.name, { solo })}
                />
                <MiniToggle
                  label="M"
                  isSelected={stem.mute}
                  onChange={(mute) => updateStem(stem.name, { mute })}
                  tone="warn"
                />
                <LevelSlider
                  label={`${stem.name} level`}
                  value={stem.level}
                  onChange={(level) => updateStem(stem.name, { level })}
                />
                <IconButton
                  icon={Repeat}
                  label={`Loop ${stem.name}`}
                  isActive={stem.loop}
                  onPress={() => updateStem(stem.name, { loop: !stem.loop })}
                  size={12}
                />
                <IconButton
                  icon={Maximize2}
                  label={`Details for ${stem.name}`}
                  isActive={stem.expanded}
                  onPress={() => updateStem(stem.name, { expanded: !stem.expanded })}
                  size={12}
                />
              </Group>
              {stem.expanded && (
                <p className="text-ink-subtle pl-[3.25rem] text-[10px]">
                  Level {Math.round(stem.level * 100)}% — separation not implemented
                </p>
              )}
            </li>
          ))}
        </ul>
      </Section>

      {/* The only live section: no DemoBadge, because every value below comes
          from /v1/transitions/suggestions. Nothing here is invented — an
          earlier version mapped the harmonic relation to a plausible mixing
          technique, which put a fabricated string beside real scores. */}
      <Section title="Suggest Transitions" {...addTransitionProps}>
        {isLoadingSuggestions ? (
          <p className="text-ink-subtle text-[11px]">Scoring…</p>
        ) : suggestions.length === 0 ? (
          <p className="text-ink-subtle text-[11px]">No other tracks to compare.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-0.5">
              {suggestions.map((suggestion) => (
                <li
                  key={suggestion.track.id}
                  className="hover:bg-surface-raised rounded-md px-1 py-1"
                >
                  <div className="flex items-center gap-2">
                    <ArrowRight size={12} className="text-ink-subtle shrink-0" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-ink truncate text-[11px]">{suggestion.track.title}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1">
                        <Bpm value={suggestion.track.bpm} />
                        <CamelotKey value={suggestion.track.keySignature} />
                        {suggestion.harmonicRelation && (
                          <Pill>
                            {RELATION_LABEL[suggestion.harmonicRelation] ??
                              suggestion.harmonicRelation}
                          </Pill>
                        )}
                        {suggestion.pitchAdjustment !== null &&
                          Math.abs(suggestion.pitchAdjustment) > 0.0005 && (
                            <Pill tone="accent">
                              {suggestion.pitchAdjustment > 0 ? "+" : ""}
                              {(suggestion.pitchAdjustment * 100).toFixed(1)}%
                            </Pill>
                          )}
                      </p>
                    </div>
                    <span
                      className={cx(
                        "shrink-0 font-mono text-[11px] tabular-nums",
                        scoreTone(suggestion.score),
                      )}
                    >
                      {Math.round(suggestion.score * 100)}%
                    </span>
                  </div>

                  {/* Rendered as text, not a title tooltip: a tooltip is
                      unreachable by keyboard and on touch, and the warning is
                      the reason a high score might still be a bad idea. */}
                  {suggestion.warnings.length > 0 && (
                    <ul className="text-warn mt-0.5 pl-5 text-[10px]">
                      {suggestion.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>

            <Button
              onPress={onViewAllSuggestions}
              className="border-border text-ink-muted hover:bg-surface-raised hover:text-ink mt-2 w-full rounded-md border px-2 py-1.5 text-[11px]"
            >
              View All Suggestions
            </Button>
          </>
        )}
      </Section>
    </div>
  );
}
