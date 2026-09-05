import { useState, type JSX } from "react";
import {
  Button,
  Input,
  ListBox,
  ListBoxItem,
  NumberField,
  Popover,
  Select,
  SelectValue,
  TextField,
} from "react-aria-components";
import { AlertTriangle, ArrowRight, ChevronDown, Pencil, Trash2 } from "lucide-react";
import {
  harmonicRelation,
  harmonicScore,
  parseKey,
  type HarmonicRelation,
} from "@flowgraph/domain";
import { Artwork, Bpm, CamelotKey, EmptyState, EnergyDots, Truncate, cx } from "../primitives.js";
import { Field, Pill, Section } from "../ui.js";
import {
  TECHNIQUES,
  TECHNIQUE_COLOR,
  bpmDelta,
  formatDuration,
  hotCuesFor,
  techniqueSpec,
  type WorkspaceTrack,
  type WorkspaceTransition,
  type HotCue,
  type TechniqueSpec,
} from "../../lib/workspace-data.js";
import { useTrackById, useWorkspace } from "../../state/workspace.js";

/**
 * Transition inspector — §10.
 *
 * An edge is its own subject, so selecting one replaces the track inspector
 * rather than extending it. Everything here answers one question: is this mix
 * going to work, and if not, which of the four things that can be wrong is
 * wrong. The header therefore leads with the pair, not with the technique.
 */

/** Camelot relations in prose. The wheel notation is for the key chips. */
const RELATION_LABEL: Readonly<Record<HarmonicRelation, string>> = {
  identical: "Same key",
  adjacent: "Adjacent",
  relative: "Relative",
  diagonal: "Diagonal",
  "energy-boost": "Energy boost",
  distant: "Distant",
};

const RELATION_TONE: Readonly<Record<HarmonicRelation, "ok" | "warn" | "danger">> = {
  identical: "ok",
  adjacent: "ok",
  relative: "ok",
  diagonal: "warn",
  "energy-boost": "warn",
  distant: "danger",
};

const MIN_BARS = 1;
const MAX_BARS = 128;
/**
 * React Aria renders `NaN` as an empty number field.
 *
 * An unset bar length has to look unset. Seeding the control with a
 * plausible 16 made the row read "16 bars" for a transition the API stores
 * no length for at all — the same invented-metadata problem the track
 * fields avoid, just in an input instead of a cell.
 */
const NO_BARS = Number.NaN;

/** A 4/4 bar at `bpm`. Every mix length in the UI is derived from this. */
function barSeconds(bpm: number): number {
  return (4 * 60) / bpm;
}

/**
 * Score → text colour.
 *
 * Decoration: the percentage sitting next to it is what carries the meaning,
 * which is what §17 requires of anything colour-coded.
 */
function scoreTone(value: number): string {
  if (value >= 0.8) return "text-ok";
  if (value >= 0.6) return "text-warn";
  return "text-danger";
}

export function TransitionInspector({ transition }: { transition: WorkspaceTransition }): JSX.Element {
  const from = useTrackById(transition.sourceTrackId);
  const to = useTrackById(transition.targetTrackId);

  if (from === null || to === null) {
    return (
      <EmptyState
        icon={<AlertTriangle size={22} aria-hidden="true" />}
        title="This transition points at a track that is no longer in the library"
        hint="Remove it from the graph, or restore the missing track and reselect the edge."
      />
    );
  }

  // Keyed by id: the notes draft and the remove confirmation are local state
  // seeded from the transition, and neither may survive a jump to a different
  // edge. Remounting beats syncing two pieces of state in an effect.
  return <TransitionBody key={transition.id} transition={transition} from={from} to={to} />;
}

/* ------------------------------------------------------------------ body -- */

function TransitionBody({
  transition,
  from,
  to,
}: {
  transition: WorkspaceTransition;
  from: WorkspaceTrack;
  to: WorkspaceTrack;
}) {
  const updateTransition = useWorkspace((state) => state.updateTransition);
  const removeTransition = useWorkspace((state) => state.removeTransition);
  const announce = useWorkspace((state) => state.announce);

  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [draftNotes, setDraftNotes] = useState("");
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);

  const spec = techniqueSpec(transition.technique);

  const outCue = hotCuesFor(from).find((cue) => cue.id === transition.mixOutCueId) ?? null;
  const inCue = hotCuesFor(to).find((cue) => cue.id === transition.mixInCueId) ?? null;

  const delta = bpmDelta(from, to);
  const fromKey = parseKey(from.keySignature);
  const toKey = parseKey(to.keySignature);
  const relation = fromKey && toKey ? harmonicRelation(fromKey, toKey) : null;
  const harmonic = fromKey && toKey ? harmonicScore(fromKey, toKey) : null;
  // Null when either side is unscored: a delta against an unknown value is
  // not zero, and a "±0" pill would read as "these match".
  const energyDelta =
    to.energy === null || from.energy === null ? null : to.energy - from.energy;

  const mixSeconds =
    from.bpm === null || transition.bars === null
      ? null
      : barSeconds(from.bpm) * transition.bars;

  function commitNotes(next: string) {
    setIsEditingNotes(false);
    if (next !== transition.notes) updateTransition(transition.id, { notes: next });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Sticky so the pair stays visible while the detail list scrolls — the
            whole inspector is meaningless without knowing which mix it is. */}
        <header className="bg-surface border-border sticky top-0 z-10 border-b p-3">
          <p className="text-ink-subtle text-[10px] font-medium tracking-wide uppercase">
            Transition
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <TransitionEnd track={from} role="From" />
            <ArrowRight size={14} className="text-ink-subtle shrink-0" aria-hidden="true" />
            <TransitionEnd track={to} role="To" />
          </div>
        </header>

        <Section id="tx-detail" title="Detail">
          <dl>
            <Field
              label="Technique"
              aside={
                <Select
                  aria-label="Transition technique"
                  selectedKey={transition.technique}
                  onSelectionChange={(key) => {
                    if (typeof key === "string") {
                      updateTransition(transition.id, { technique: key });
                    }
                  }}
                >
                  <Button className="border-border bg-surface-raised text-ink hover:border-border-strong flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] outline-none">
                    <SelectValue />
                    <ChevronDown size={11} aria-hidden="true" className="shrink-0" />
                  </Button>
                  <Popover className="border-border bg-surface-overlay min-w-[var(--trigger-width)] rounded-md border p-1 shadow-lg">
                    <ListBox className="outline-none">
                      {Object.values(TECHNIQUES).map((entry) => (
                        <ListBoxItem
                          key={entry.id}
                          id={entry.id}
                          textValue={entry.label}
                          className="text-ink-muted data-[selected]:text-accent hover:bg-surface-raised flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[11px] outline-none"
                        >
                          <TechniqueMark spec={entry} />
                          {entry.label}
                        </ListBoxItem>
                      ))}
                    </ListBox>
                  </Popover>
                </Select>
              }
            >
              <span className="text-ink-subtle">{FAMILY_LABEL[spec.family]}</span>
            </Field>

            <Field
              label="Duration"
              aside={
                <span className="flex items-center gap-1">
                  <NumberField
                    aria-label="Mix duration in bars"
                    value={transition.bars ?? NO_BARS}
                    minValue={MIN_BARS}
                    maxValue={MAX_BARS}
                    step={1}
                    onChange={(value) => {
                      // RAC hands back NaN for an emptied field; committing it
                      // would render the whole timeline as "NaN bars".
                      if (!Number.isFinite(value)) return;
                      updateTransition(transition.id, {
                        bars: Math.min(MAX_BARS, Math.max(MIN_BARS, Math.round(value))),
                      });
                    }}
                  >
                    <Input className="border-border bg-surface-raised text-ink focus:border-accent w-11 rounded border px-1 py-0.5 text-right font-mono text-[11px] tabular-nums outline-none" />
                  </NumberField>
                  <span className="text-ink-subtle text-[10px]">bars</span>
                </span>
              }
            >
              <span className="text-ink-subtle font-mono tabular-nums">
                {mixSeconds === null ? "—" : `≈ ${formatDuration(mixSeconds)}`}
              </span>
            </Field>

            <Field label="Mix-out cue">
              <CueValue cue={outCue} />
            </Field>
            <Field label="Mix-in cue">
              <CueValue cue={inCue} />
            </Field>

            <Field
              label="BPM"
              aside={
                delta === null ? (
                  <Pill>Unknown</Pill>
                ) : (
                  <Pill tone={delta === 0 ? "ok" : Math.abs(delta) <= 3 ? "warn" : "danger"}>
                    {delta > 0 ? "+" : ""}
                    {delta}
                  </Pill>
                )
              }
            >
              <span className="inline-flex items-center gap-1">
                <Bpm value={from.bpm} />
                <ArrowRight size={9} className="text-ink-subtle" aria-hidden="true" />
                <Bpm value={to.bpm} />
              </span>
            </Field>

            <Field
              label="Key"
              aside={
                relation === null ? (
                  <Pill>Unknown</Pill>
                ) : (
                  <Pill tone={RELATION_TONE[relation]}>{RELATION_LABEL[relation]}</Pill>
                )
              }
            >
              <span className="inline-flex items-center gap-1">
                <CamelotKey value={from.keySignature} />
                <ArrowRight size={9} className="text-ink-subtle" aria-hidden="true" />
                <CamelotKey value={to.keySignature} />
              </span>
            </Field>

            <Field label="Harmonic match">
              {harmonic === null ? (
                <span className="text-ink-subtle">—</span>
              ) : (
                <span className={cx("font-mono tabular-nums", scoreTone(harmonic))}>
                  {Math.round(harmonic * 100)}%
                </span>
              )}
            </Field>

            <Field
              label="Energy"
              {...(energyDelta !== null
                ? {
                    aside: (
                      <Pill
                        tone={
                          Math.abs(energyDelta) >= 3
                            ? "danger"
                            : Math.abs(energyDelta) >= 2
                              ? "warn"
                              : "neutral"
                        }
                      >
                        {energyDelta > 0 ? "+" : energyDelta < 0 ? "−" : "±"}
                        {Math.abs(energyDelta)}
                      </Pill>
                    ),
                  }
                : {})}
            >
              <span className="inline-flex items-center gap-1.5">
                <EnergyDots value={from.energy} size={5} />
                <ArrowRight size={9} className="text-ink-subtle" aria-hidden="true" />
                <EnergyDots value={to.energy} size={5} />
              </span>
            </Field>

            {/* §10 asks for provenance beside the number: a 72% the DJ wrote and
                a 72% the model guessed are not the same claim. */}
            <Field
              label="Confidence"
              aside={
                <Pill tone={transition.origin === "ai" ? "accent" : "neutral"}>
                  {transition.origin === "ai" ? "AI suggested" : "Manual"}
                </Pill>
              }
            >
              {transition.confidence === null ? (
                <span className="text-ink-subtle font-mono tabular-nums">—</span>
              ) : (
                <span
                  className={cx("font-mono tabular-nums", scoreTone(transition.confidence))}
                >
                  {Math.round(transition.confidence * 100)}%
                </span>
              )}
            </Field>
          </dl>
        </Section>

        <Section id="tx-fx" title="FX / Instructions">
          {transition.fx.length === 0 ? (
            <p className="text-ink-subtle text-[11px]">No effects</p>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {transition.fx.map((effect) => (
                <li key={effect}>
                  <Pill tone="info">{effect}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="tx-notes" title="Notes">
          {isEditingNotes ? (
            <TextField
              aria-label="Transition notes"
              value={draftNotes}
              onChange={setDraftNotes}
              autoFocus
              // No "already handled" latch. Enter and Escape both unmount the
              // input, and a removed element never fires blur, so blur can only
              // mean the user clicked away mid-edit — which is a commit.
              onBlur={() => commitNotes(draftNotes.trim())}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitNotes(draftNotes.trim());
                } else if (event.key === "Escape") {
                  setIsEditingNotes(false);
                }
              }}
              className="w-full"
            >
              <Input className="border-border bg-surface-raised text-ink focus:border-accent w-full rounded border px-1.5 py-1 text-[11px] outline-none" />
            </TextField>
          ) : (
            <Button
              onPress={() => {
                setDraftNotes(transition.notes);
                setIsEditingNotes(true);
              }}
              aria-label="Edit transition notes"
              className="text-ink hover:text-accent border-border/0 hover:border-border flex w-full min-w-0 items-start justify-between gap-1 rounded border px-1.5 py-1 text-left text-[11px]"
            >
              <span className="min-w-0 flex-1 whitespace-pre-wrap">
                {transition.notes || "Add a note"}
              </span>
              <Pencil size={11} className="text-ink-subtle mt-px shrink-0" aria-hidden="true" />
            </Button>
          )}
        </Section>

        {/* Warnings are the reason a 94% mix can still be the wrong call, so
            they are body text rather than a tooltip — §17 keeps them reachable
            by keyboard and on touch. */}
        <Section
          id="tx-warnings"
          title="Warnings"
          {...(transition.warnings.length > 0
            ? { aside: <Pill tone="warn">{transition.warnings.length}</Pill> }
            : {})}
        >
          {transition.warnings.length === 0 ? (
            <p className="text-ink-subtle text-[11px]">Nothing flagged on this transition.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {transition.warnings.map((warning) => (
                <li key={warning} className="text-warn flex items-start gap-1.5 text-[11px]">
                  <AlertTriangle size={12} className="mt-px shrink-0" aria-hidden="true" />
                  <span className="min-w-0">{warning}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <footer className="border-border bg-surface shrink-0 border-t p-3">
        <div className="flex items-center gap-2">
          {/* Disabled rather than a button that shrugs: there is no persistence
              endpoint, and edits already reach the store the moment they are
              committed. The span carries the title because a disabled control
              receives no pointer events of its own. */}
          <span title="Edits apply immediately; there is no save endpoint yet.">
            <Button
              isDisabled
              className="border-border text-ink-muted rounded-md border px-2.5 py-1 text-[11px] disabled:opacity-50"
            >
              Save
            </Button>
          </span>

          <span className="flex-1" />

          {isConfirmingRemove ? (
            <>
              <Button
                onPress={() => setIsConfirmingRemove(false)}
                className="border-border text-ink-muted hover:bg-surface-raised hover:text-ink rounded-md border px-2.5 py-1 text-[11px]"
              >
                Cancel
              </Button>
              <Button
                autoFocus
                onPress={() => {
                  removeTransition(transition.id);
                  announce(`Removed the transition from ${from.title} to ${to.title}.`);
                }}
                className="border-danger text-danger hover:bg-danger/15 flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium"
              >
                <Trash2 size={12} aria-hidden="true" />
                Confirm remove
              </Button>
            </>
          ) : (
            <Button
              onPress={() => setIsConfirmingRemove(true)}
              className="border-border text-ink-muted hover:border-danger/40 hover:text-danger flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px]"
            >
              <Trash2 size={12} aria-hidden="true" />
              Remove transition
            </Button>
          )}
        </div>

        <p className="text-ink-subtle mt-1.5 text-[10px]">
          {isConfirmingRemove
            ? "This deletes the edge from the graph. The two tracks stay put."
            : "Edits apply immediately; there is no save endpoint yet."}
        </p>
      </footer>
    </div>
  );
}

/* -------------------------------------------------------------- fragments -- */

const FAMILY_LABEL: Readonly<Record<TechniqueSpec["family"], string>> = {
  blend: "Blend",
  effect: "Effect",
  filter: "Filter",
  energy: "Energy",
  cut: "Cut",
};

/**
 * The technique's edge styling, in miniature.
 *
 * Colour *and* dash, matching what the canvas draws, so the Select is
 * legible in greyscale and a technique is recognisable from the edge alone.
 */
function TechniqueMark({ spec }: { spec: TechniqueSpec }) {
  return (
    <svg width="18" height="6" viewBox="0 0 18 6" aria-hidden="true" className="shrink-0">
      <line
        x1="1"
        y1="3"
        x2="17"
        y2="3"
        strokeWidth="2"
        strokeLinecap="round"
        stroke={TECHNIQUE_COLOR[spec.family]}
        {...(spec.dash !== null ? { strokeDasharray: spec.dash } : {})}
      />
    </svg>
  );
}

function TransitionEnd({ track, role }: { track: WorkspaceTrack; role: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Artwork seed={track.id} size={32} />
      <div className="min-w-0">
        {/* The arrow is the only visual cue for direction; without this a
            screen reader hears two titles and no ordering. */}
        <span className="sr-only">{role}: </span>
        <Truncate className="text-ink text-[12px] font-medium">{track.title}</Truncate>
        <Truncate className="text-ink-muted text-[11px]">{track.artist}</Truncate>
      </div>
    </div>
  );
}

/**
 * A resolved cue, or the fact that it did not resolve.
 *
 * §7 treats a dangling marker id as a real state, not an error: cues live in
 * the track's GEOB tags and can be renumbered or deleted out from under a
 * transition that referenced them.
 */
function CueValue({ cue }: { cue: HotCue | null }) {
  if (cue === null) {
    return (
      <span className="text-warn inline-flex items-center gap-1">
        <AlertTriangle size={11} aria-hidden="true" className="shrink-0" />
        Missing marker binding
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-[2px]"
        style={{ background: cue.color }}
      />
      <span className="truncate">{cue.label}</span>
      <span className="text-ink-muted font-mono tabular-nums">{formatDuration(cue.seconds)}</span>
    </span>
  );
}
