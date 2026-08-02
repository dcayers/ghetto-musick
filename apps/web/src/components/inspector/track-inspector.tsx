import { useMemo, useRef, useState, type JSX } from "react";
import { Button, Group, Input, TextField } from "react-aria-components";
import { ArrowRight, Check, Maximize2, Pencil, Repeat, Star, Trash2 } from "lucide-react";
import { rankCandidates, type HarmonicRelation, type TransitionScore } from "@flowgraph/domain";
import { Artwork, Bpm, CamelotKey, SourceDot, Truncate, cx } from "../primitives.js";
import {
  DetailWaveform,
  Field,
  IconButton,
  LevelSlider,
  MiniToggle,
  Pill,
  Section,
  StarRating,
  type WaveformCue,
} from "../ui.js";
import {
  formatDuration,
  hotCuesFor,
  stemsFor,
  type CueStatus,
  type DemoTrack,
  type Provenance,
  type TrackSource,
} from "../../lib/demo-data.js";
import { useWorkspace } from "../../state/workspace.js";

/**
 * Track inspector — §9.
 *
 * The densest surface in the app: a pinned identity header, the waveform, and
 * four collapsible sections. The caller owns the surrounding `Panel` and the
 * track/transition switch; this is only the scroll container.
 */

/* ---------------------------------------------------------------- labels -- */

type PillTone = "neutral" | "ok" | "warn" | "danger" | "accent" | "info";

const PROVENANCE_LABEL: Readonly<Record<Provenance, string>> = {
  manual: "Manual",
  serato: "Serato",
  analysis: "Analysis",
  spotify: "Spotify",
  ai: "AI",
};

/**
 * Manual is toned differently from the rest because it behaves differently:
 * §9 makes hand-entered values authoritative, so re-analysis and re-import
 * must leave them alone. Every other origin is overwritable.
 */
const PROVENANCE_TITLE: Readonly<Record<Provenance, string>> = {
  manual: "Entered by hand. Re-analysis and re-import will not overwrite this value.",
  serato: "Read from the Serato library. A manual edit takes precedence over it.",
  analysis: "Derived from the audio. A manual edit takes precedence over it.",
  spotify: "From the Spotify catalogue. A manual edit takes precedence over it.",
  ai: "Estimated by the model. A manual edit takes precedence over it.",
};

const SOURCE_SHORT: Readonly<Record<TrackSource, string>> = {
  local: "Local",
  streaming: "Streaming",
  missing: "File missing",
};

const CUE_STATUS: Readonly<Record<CueStatus, { label: string; tone: PillTone }>> = {
  imported: { label: "Imported", tone: "neutral" },
  suggested: { label: "Suggested", tone: "info" },
  approved: { label: "Approved", tone: "ok" },
};

/** Matches the vocabulary `@flowgraph/domain` scores with. */
const RELATION_LABEL: Readonly<Record<HarmonicRelation, string>> = {
  identical: "Same key",
  adjacent: "Adjacent",
  relative: "Relative",
  diagonal: "Diagonal",
  "energy-boost": "Energy boost",
  distant: "Distant",
};

/**
 * The palette `hotCuesFor` seeds cues with, restated as tokens.
 *
 * The dataset carries literal colours per cue; anything *this* file creates has
 * to come from the theme, so new cues draw from the token equivalents.
 */
const CUE_PALETTE = [
  "var(--color-ok)",
  "var(--color-warn)",
  "var(--color-energy-5)",
  "var(--color-tx-blend)",
  "var(--color-energy)",
] as const;

/**
 * Match strength band.
 *
 * Decoration only — the percentage beside the bar carries the value and the
 * bar's *length* carries the comparison, so neither depends on hue (§17).
 */
function confidenceBand(score: number): { readonly text: string; readonly fill: string } {
  if (score >= 0.8) return { text: "text-ok", fill: "var(--color-ok)" };
  if (score >= 0.55) return { text: "text-warn", fill: "var(--color-warn)" };
  return { text: "text-ink-muted", fill: "var(--color-ink-muted)" };
}

function ProvenanceMark({ source }: { source: Provenance | undefined }) {
  if (source === undefined) return null;
  return (
    <Pill tone={source === "manual" ? "accent" : "neutral"} title={PROVENANCE_TITLE[source]}>
      {PROVENANCE_LABEL[source]}
    </Pill>
  );
}

/* ------------------------------------------------------------------ shell -- */

export function TrackInspector({ track }: { track: DemoTrack }): JSX.Element {
  // Every editable block below is local state seeded from the track, so the
  // body is keyed by id. Remounting is cheaper and far less error-prone than
  // syncing seven pieces of state in an effect on every selection change —
  // and keying here rather than at the call site means it holds however the
  // caller chooses to render us.
  return <InspectorBody key={track.id} track={track} />;
}

/* ------------------------------------------------------------------- body -- */

interface CueRow {
  /** Stable across renames and deletions; the displayed number is positional. */
  key: string;
  seconds: number;
  label: string;
  color: string;
  status: CueStatus;
}

interface StemRow {
  name: string;
  level: number;
  solo: boolean;
  mute: boolean;
  loop: boolean;
  expanded: boolean;
}

interface SuggestionRow {
  track: DemoTrack;
  score: TransitionScore;
}

const COLLAPSED_SUGGESTIONS = 5;

function InspectorBody({ track }: { track: DemoTrack }) {
  const tracks = useWorkspace((state) => state.tracks);
  const announce = useWorkspace((state) => state.announce);

  const [isFavourite, setIsFavourite] = useState(false);
  const [position, setPosition] = useState(0);
  const [rating, setRating] = useState(track.rating);
  const [comment, setComment] = useState(track.comment);
  const [isEditingComment, setIsEditingComment] = useState(false);
  const [draftComment, setDraftComment] = useState("");
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);

  const [cues, setCues] = useState<CueRow[]>(() =>
    hotCuesFor(track).map((cue) => ({
      key: cue.id,
      seconds: cue.seconds,
      label: cue.label,
      color: cue.color,
      status: cue.status,
    })),
  );
  const nextCueOrdinal = useRef(cues.length);

  const [stems, setStems] = useState<StemRow[]>(() =>
    stemsFor(track).map(({ name, level }) => ({
      name,
      level,
      solo: false,
      mute: false,
      loop: false,
      expanded: false,
    })),
  );

  const waveformCues = useMemo<WaveformCue[]>(
    () =>
      cues.map((cue, index) => ({
        seconds: cue.seconds,
        color: cue.color,
        label: `${index + 1}. ${cue.label}`,
      })),
    [cues],
  );

  /**
   * Real candidates, scored by the domain package.
   *
   * `rankCandidates` returns the `ScorableTrack` it was handed, which has no
   * title — so the ids are resolved back to full tracks rather than the row
   * inventing a display shape of its own.
   */
  const suggestions = useMemo<SuggestionRow[]>(() => {
    const byId = new Map(tracks.map((entry) => [entry.id, entry]));
    return rankCandidates(track, tracks).flatMap((candidate) => {
      const full = byId.get(candidate.track.id);
      return full ? [{ track: full, score: candidate.score }] : [];
    });
  }, [track, tracks]);

  const visibleSuggestions = showAllSuggestions
    ? suggestions
    : suggestions.slice(0, COLLAPSED_SUGGESTIONS);

  function commitComment(next: string) {
    setComment(next);
    setIsEditingComment(false);
  }

  function addCue() {
    setCues((current) => {
      const ordinal = nextCueOrdinal.current;
      nextCueOrdinal.current += 1;
      return [
        ...current,
        {
          key: `${track.id}-cue-new-${ordinal}`,
          // A cue is dropped where you are listening, and the playhead is the
          // one piece of transport that actually moves here.
          seconds: Math.round(position),
          label: "New cue",
          // Keyed off the monotonic ordinal, not the live length: deleting two
          // cues and adding one must not reuse a colour already on screen.
          color: CUE_PALETTE[ordinal % CUE_PALETTE.length] ?? CUE_PALETTE[0],
          status: "approved",
        },
      ];
    });
  }

  function updateCue(key: string, patch: Partial<CueRow>) {
    setCues((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function updateStem(name: string, patch: Partial<StemRow>) {
    setStems((current) =>
      current.map((stem) => (stem.name === name ? { ...stem, ...patch } : stem)),
    );
  }

  const stemsUnavailable = !track.hasStems;
  /** Appended to every stem control's name so the reason survives the tooltip. */
  const stemSuffix = stemsUnavailable ? " — unavailable, this track has no stems" : "";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Pinned: the sections below run long, and "which track am I editing"
          must never be a scroll away. Opaque, not translucent — the waveform
          would otherwise smear through it. */}
      <header className="bg-surface border-border sticky top-0 z-10 flex items-start gap-3 border-b p-3">
        <Artwork seed={track.id} size={48} />
        <div className="min-w-0 flex-1">
          <Truncate className="text-ink text-sm font-medium">{track.title}</Truncate>
          <Truncate className="text-ink-muted text-xs">{track.artist}</Truncate>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="flex items-baseline gap-1">
              <Bpm value={track.bpm} />
              {track.bpm !== null && <span className="text-bpm text-[10px]">BPM</span>}
            </span>
            <CamelotKey value={track.keySignature} />
            <span className="text-ink-subtle flex items-center gap-1 text-[10px]">
              <SourceDot source={track.source} />
              {SOURCE_SHORT[track.source]}
            </span>
          </div>
        </div>
        <IconButton
          icon={Star}
          // The name states the outcome, so the star's fill is never the only
          // thing distinguishing the two states.
          label={isFavourite ? "Remove from favourites" : "Add to favourites"}
          isActive={isFavourite}
          onPress={() => setIsFavourite((value) => !value)}
          {...(isFavourite ? { iconClassName: "fill-warn text-warn" } : {})}
        />
      </header>

      {/* Outside the collapsible stack: the waveform is the track's identity as
          much as its title, and collapsing it would strip the cue markers every
          section below refers to. */}
      <div className="border-border border-b p-3">
        <DetailWaveform
          trackId={track.id}
          durationSeconds={track.durationSeconds}
          energy={track.energy}
          cues={waveformCues}
          positionSeconds={position}
          onSeek={setPosition}
        />
        <div className="text-ink-subtle mt-1.5 flex items-center justify-between gap-2 font-mono text-[10px] tabular-nums">
          <span>{formatDuration(position)}</span>
          <span>{formatDuration(track.durationSeconds)}</span>
        </div>
      </div>

      <Section id="track-metadata" title="Metadata">
        <dl>
          <Field label="Key" aside={<ProvenanceMark source={track.provenance.keySignature} />}>
            <CamelotKey value={track.keySignature} />
          </Field>
          <Field label="BPM" aside={<ProvenanceMark source={track.provenance.bpm} />}>
            <Bpm value={track.bpm} decimals={1} />
          </Field>
          <Field label="Genre" aside={<ProvenanceMark source={track.provenance.genre} />}>
            {track.genre}
          </Field>
          <Field label="Year" aside={<ProvenanceMark source={track.provenance.year} />}>
            {track.year}
          </Field>
          <Field label="Duration">{formatDuration(track.durationSeconds)}</Field>
          <Field label="Rating" aside={<ProvenanceMark source={track.provenance.rating} />}>
            <StarRating value={rating} onChange={setRating} />
          </Field>

          {isEditingComment ? (
            // `Field`'s value cell is a shrink-to-fit, truncating flex item,
            // which clips an input and its focus ring — so editing takes the
            // full row width instead of squeezing into the right-hand column.
            <div className="py-[3px]">
              <dt className="text-ink-subtle mb-1 text-[11px]">Comment</dt>
              <dd>
                <TextField
                  aria-label="Track comment"
                  value={draftComment}
                  onChange={setDraftComment}
                  autoFocus
                  // No "already handled" latch. Enter and Escape both unmount
                  // the input, and browsers do not fire blur for a removed
                  // element, so blur can only mean "clicked away while still
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
              </dd>
            </div>
          ) : (
            <Field label="Comment" aside={<ProvenanceMark source={track.provenance.comment} />}>
              <Button
                onPress={() => {
                  setDraftComment(comment);
                  setIsEditingComment(true);
                }}
                aria-label="Edit comment"
                className="text-ink hover:text-accent flex min-w-0 items-center gap-1"
              >
                <span className="min-w-0 truncate" title={comment || "Add a comment"}>
                  {comment || "Add a comment"}
                </span>
                <Pencil size={10} className="text-ink-subtle shrink-0" aria-hidden="true" />
              </Button>
            </Field>
          )}

          <Field label="Tags" aside={<ProvenanceMark source={track.provenance.tags} />}>
            {track.tags.length > 0 ? (
              <span className="inline-flex items-center gap-1">
                {track.tags.map((tag) => (
                  <Pill key={tag}>{tag}</Pill>
                ))}
              </span>
            ) : (
              "None"
            )}
          </Field>
        </dl>
      </Section>

      <Section id="track-cues" title="Hot Cues" onAdd={addCue} addLabel="Add hot cue">
        <ul className="flex flex-col gap-1">
          {cues.map((cue, index) => {
            const status = CUE_STATUS[cue.status];
            const timestamp = formatDuration(cue.seconds);
            return (
              <li key={cue.key} className="flex flex-wrap items-center gap-1.5">
                {/* The chip's colour is decoration; the number inside it and
                    the input's accessible name both carry the identity. */}
                <span
                  aria-hidden="true"
                  className="text-canvas grid size-4 shrink-0 place-items-center rounded text-[9px] font-semibold"
                  style={{ background: cue.color }}
                >
                  {index + 1}
                </span>
                <span className="text-ink-muted shrink-0 font-mono text-[11px] tabular-nums">
                  {timestamp}
                </span>
                <TextField
                  aria-label={`Label for hot cue ${index + 1} at ${timestamp}`}
                  value={cue.label}
                  onChange={(value) => updateCue(cue.key, { label: value })}
                  className="min-w-[5rem] flex-1"
                >
                  <Input className="border-border/0 hover:border-border focus:border-accent text-ink w-full rounded border bg-transparent px-1 py-0.5 text-[11px] outline-none" />
                </TextField>
                <Pill tone={status.tone}>{status.label}</Pill>
                {cue.status === "suggested" && (
                  <IconButton
                    icon={Check}
                    label={`Approve suggested cue ${index + 1}, ${cue.label}`}
                    onPress={() => {
                      updateCue(cue.key, { status: "approved" });
                      announce(`Hot cue ${index + 1}, ${cue.label}, approved.`);
                    }}
                    size={12}
                  />
                )}
                <IconButton
                  icon={Trash2}
                  label={`Delete hot cue ${index + 1}, ${cue.label}`}
                  tone="danger"
                  onPress={() => setCues((current) => current.filter((row) => row.key !== cue.key))}
                  size={12}
                />
              </li>
            );
          })}
        </ul>
      </Section>

      <Section id="track-stems" title="Stems">
        {stemsUnavailable && (
          <p className="text-ink-subtle mb-2 text-[11px] leading-relaxed">
            No separated stems for this track. Separation needs a local file and an analysis pass,
            so the controls below are inactive.
          </p>
        )}
        <ul className="flex flex-col gap-1.5">
          {stems.map((stem) => (
            <li key={stem.name}>
              {/* MiniToggle's visible glyph is one letter, so the row group
                  supplies the context around the per-control description. */}
              <Group aria-label={`${stem.name} stem`} className="flex items-center gap-1.5">
                <span className="text-ink-muted w-12 shrink-0 truncate text-[11px]">
                  {stem.name}
                </span>
                <MiniToggle
                  label="S"
                  description={`Solo ${stem.name.toLowerCase()} stem${stemSuffix}`}
                  isSelected={stem.solo}
                  onChange={(solo) => updateStem(stem.name, { solo })}
                  isDisabled={stemsUnavailable}
                />
                <MiniToggle
                  label="M"
                  description={`Mute ${stem.name.toLowerCase()} stem${stemSuffix}`}
                  isSelected={stem.mute}
                  onChange={(mute) => updateStem(stem.name, { mute })}
                  isDisabled={stemsUnavailable}
                  tone="warn"
                />
                <LevelSlider
                  label={`${stem.name} level${stemSuffix}`}
                  value={stem.level}
                  onChange={(level) => updateStem(stem.name, { level })}
                  isDisabled={stemsUnavailable}
                />
                <IconButton
                  icon={Repeat}
                  label={`Loop ${stem.name}${stemSuffix}`}
                  isActive={stem.loop}
                  isDisabled={stemsUnavailable}
                  onPress={() => updateStem(stem.name, { loop: !stem.loop })}
                  size={12}
                />
                <IconButton
                  icon={Maximize2}
                  label={`Details for ${stem.name}${stemSuffix}`}
                  isActive={stem.expanded}
                  isDisabled={stemsUnavailable}
                  onPress={() => updateStem(stem.name, { expanded: !stem.expanded })}
                  size={12}
                />
              </Group>
              {stem.expanded && (
                <p className="text-ink-subtle pl-[3.25rem] text-[10px] tabular-nums">
                  Level {Math.round(stem.level * 100)}%
                </p>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section id="track-suggestions" title="Suggested Transitions">
        {suggestions.length === 0 ? (
          <p className="text-ink-subtle text-[11px]">No other tracks to compare against.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-0.5">
              {visibleSuggestions.map(({ track: candidate, score }) => {
                const percent = Math.round(score.overall * 100);
                const band = confidenceBand(score.overall);
                return (
                  <li
                    key={candidate.id}
                    className="hover:bg-surface-raised rounded-md px-1 py-1"
                  >
                    <div className="flex items-center gap-2">
                      <ArrowRight
                        size={12}
                        className="text-ink-subtle shrink-0"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <Truncate className="text-ink text-[11px]">{candidate.title}</Truncate>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1">
                          <Bpm value={candidate.bpm} />
                          <CamelotKey value={candidate.keySignature} />
                          {score.harmonicRelation !== null && (
                            <Pill>{RELATION_LABEL[score.harmonicRelation]}</Pill>
                          )}
                        </span>
                      </div>
                      {/* Bar length is the scannable comparison, the digits are
                          the value; the band colour only reinforces both. */}
                      <span
                        role="img"
                        aria-label={`${percent} percent compatible`}
                        className="flex shrink-0 items-center gap-1.5"
                      >
                        <span className="bg-border-strong block h-1 w-8 overflow-hidden rounded-full">
                          <span
                            className="block h-full rounded-full"
                            style={{ width: `${percent}%`, background: band.fill }}
                          />
                        </span>
                        <span className={cx("font-mono text-[11px] tabular-nums", band.text)}>
                          {percent}%
                        </span>
                      </span>
                    </div>

                    {/* Text, not a title tooltip: a tooltip is unreachable by
                        keyboard and on touch, and the warning is the reason a
                        high score can still be a bad idea. */}
                    {score.warnings.length > 0 && (
                      <ul className="text-warn mt-0.5 pl-5 text-[10px]">
                        {score.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>

            <Button
              onPress={() => setShowAllSuggestions((value) => !value)}
              className="border-border text-ink-muted hover:bg-surface-raised hover:text-ink mt-2 w-full rounded-md border px-2 py-1.5 text-[11px]"
            >
              {showAllSuggestions
                ? `Show top ${COLLAPSED_SUGGESTIONS}`
                : `View All Suggestions (${suggestions.length})`}
            </Button>
          </>
        )}
      </Section>
    </div>
  );
}
