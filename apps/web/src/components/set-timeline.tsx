import { useMemo, useState, type DragEvent } from "react";
import {
  Button,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
} from "react-aria-components";
import {
  AlertTriangle,
  ChevronDown,
  ChevronsDownUp,
  Maximize2,
  Minimize2,
  Plus,
} from "lucide-react";
import {
  Artwork,
  Bpm,
  CamelotKey,
  EmptyState,
  EnergyDots,
  Panel,
  Truncate,
  Waveform,
  cx,
} from "./primitives.js";
import { IconButton, Pill } from "./ui.js";
import {
  TECHNIQUE_COLOR,
  activeSetTransitionIds,
  formatDuration,
  setDuration,
  techniqueSpec,
  transitionBetween,
  type DemoTrack,
  type DemoTransition,
} from "../lib/demo-data.js";
import { PANEL_LIMITS, useWorkspace, type OverlayMetric } from "../state/workspace.js";

/**
 * Set timeline — the ordered playback view under the canvas.
 *
 * The graph answers "what could follow what"; this answers "what actually
 * happens, in order". The overlay curve is the reason the panel earns its
 * vertical space: a set reads as a shape over time, and the shape is only
 * visible when the metric is plotted against position rather than listed.
 */

/**
 * Lane geometry in pixels rather than Tailwind spacing.
 *
 * Every control point on the curve has to sit dead centre under its card.
 * Deriving both the flex row and the SVG x positions from these four numbers is
 * the only way to guarantee that; a `gap-1.5` class would silently drift the
 * moment the root font size changed.
 */
const CARD_WIDTH = 150;
const TRANSITION_WIDTH = 18;
const LANE_GAP = 2;
/** Card + its trailing transition block, i.e. the distance between two cards. */
const SLOT_STEP = CARD_WIDTH + TRANSITION_WIDTH + LANE_GAP * 2;

const CHART_HEIGHT = 72;
/** Keeps the extreme points off the chart edges so their circles aren't clipped. */
const CHART_PAD = 10;
/** The axis gutter, pinned outside the scroller so it stays legible while panning. */
const AXIS_WIDTH = 24;

function laneWidth(count: number): number {
  if (count <= 0) return 0;
  return count * CARD_WIDTH + (count - 1) * (TRANSITION_WIDTH + LANE_GAP * 2);
}

const cardCenterX = (index: number): number => index * SLOT_STEP + CARD_WIDTH / 2;

/** Centre of the transition block that follows card `index`. */
const boundaryX = (index: number): number =>
  index * SLOT_STEP + CARD_WIDTH + LANE_GAP + TRANSITION_WIDTH / 2;

const METRICS: ReadonlyArray<{ id: OverlayMetric; label: string }> = [
  { id: "energy", label: "Energy" },
  { id: "bpm", label: "BPM" },
  { id: "key", label: "Key" },
];

/**
 * Each metric borrows the token already used for it elsewhere, so the curve
 * reads as the same quantity the cards show. Colour is never the only signal —
 * the Select names the metric and every point carries a text label.
 */
const METRIC_COLOR: Readonly<Record<OverlayMetric, string>> = {
  energy: "var(--color-energy)",
  bpm: "var(--color-bpm)",
  key: "var(--color-key)",
};

function isMetric(value: unknown): value is OverlayMetric {
  return METRICS.some((entry) => entry.id === value);
}

/** "8A" → 8. The number is the wheel position; the letter is the mode. */
function camelotNumber(key: string | null): number | null {
  if (!key) return null;
  const digits = /^(\d{1,2})/.exec(key.trim())?.[1];
  if (digits === undefined) return null;
  const position = Number(digits);
  return position >= 1 && position <= 12 ? position : null;
}

function metricValue(track: DemoTrack, metric: OverlayMetric): number | null {
  if (metric === "bpm") return track.bpm;
  if (metric === "key") return camelotNumber(track.keySignature);
  return track.energy;
}

function metricText(track: DemoTrack, metric: OverlayMetric): string {
  if (metric === "bpm") return track.bpm === null ? "BPM unknown" : `${track.bpm.toFixed(0)} BPM`;
  if (metric === "key") {
    return camelotNumber(track.keySignature) === null
      ? "Key unknown"
      : `Camelot ${track.keySignature ?? ""}`.trim();
  }
  return `Energy ${track.energy} of 5`;
}

/**
 * Energy and Camelot have fixed ranges, so they get fixed domains — otherwise a
 * set of six flat tracks would draw a dramatic mountain range out of a one-step
 * difference. BPM has no natural bounds, so it is scaled to the set with
 * headroom, and a set that is all one tempo still draws a flat line rather than
 * dividing by zero.
 */
function domainFor(metric: OverlayMetric, values: number[]): { min: number; max: number } {
  if (metric === "energy") return { min: 1, max: 5 };
  if (metric === "key") return { min: 1, max: 12 };
  if (values.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? { min: min - 4, max: max + 4 } : { min: min - 2, max: max + 2 };
}

/**
 * Axis endpoints.
 *
 * "High"/"Low" would be a lie for Camelot — 12A is adjacent to 1A, not above it
 * — and it makes the gutter cost 38px to say nothing. Printing the actual
 * domain endpoints means a value can be read off the curve.
 */
function axisLabels(
  metric: OverlayMetric,
  domain: { min: number; max: number },
): { top: string; bottom: string } {
  if (metric === "key") return { top: "12A", bottom: "1A" };
  if (metric === "energy") return { top: "High", bottom: "Low" };
  return { top: `${Math.round(domain.max)}`, bottom: `${Math.round(domain.min)}` };
}

/** A set entry that resolved to a real track, carrying its true set index. */
interface Slot {
  readonly index: number;
  readonly track: DemoTrack;
}

export function SetTimeline() {
  const set = useWorkspace((state) => state.set);
  const tracks = useWorkspace((state) => state.tracks);
  const transitions = useWorkspace((state) => state.transitions);
  const overlayMetric = useWorkspace((state) => state.overlayMetric);
  const setOverlayMetric = useWorkspace((state) => state.setOverlayMetric);
  const selectedTrackId = useWorkspace((state) => state.selectedTrackId);
  const selectedTransitionId = useWorkspace((state) => state.selectedTransitionId);
  const selectTrack = useWorkspace((state) => state.selectTrack);
  const selectTransition = useWorkspace((state) => state.selectTransition);
  const reorderSet = useWorkspace((state) => state.reorderSet);
  const togglePanel = useWorkspace((state) => state.togglePanel);
  const setPanelSize = useWorkspace((state) => state.setPanelSize);
  const panelHeight = useWorkspace((state) => state.panels.timeline.size);
  const announce = useWorkspace((state) => state.announce);

  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  /**
   * Carrying the original index alongside the track keeps `reorderSet` honest
   * when an id in the set has no matching track: the rendered position and the
   * index the store splices on must be the same number.
   */
  const slots = useMemo<Slot[]>(() => {
    const byId = new Map(tracks.map((track) => [track.id, track]));
    return set.trackIds.flatMap((id, index) => {
      const track = byId.get(id);
      return track ? [{ index, track }] : [];
    });
  }, [set.trackIds, tracks]);

  const domain = useMemo(
    () =>
      domainFor(
        overlayMetric,
        slots
          .map((slot) => metricValue(slot.track, overlayMetric))
          .filter((value): value is number => value !== null),
      ),
    [slots, overlayMetric],
  );
  const axis = axisLabels(overlayMetric, domain);

  // Adjacent pairs the graph has no edge for. A reordered set can put two
  // tracks side by side that were never linked, and a planner needs to see it.
  const gaps = Math.max(
    0,
    set.trackIds.length - 1 - activeSetTransitionIds(set, transitions).length,
  );

  const isMaximized = panelHeight >= PANEL_LIMITS.timeline.max;

  function move(from: number, to: number, title: string): void {
    if (from === to || to < 0 || to >= set.trackIds.length) return;
    reorderSet(from, to);
    announce(`${title} moved to position ${to + 1} of ${set.trackIds.length}.`);
  }

  return (
    <Panel
      className="min-h-0"
      title={
        <span className="flex items-baseline gap-2 whitespace-nowrap">
          Set Timeline
          {slots.length > 0 && (
            <span className="text-ink-subtle text-xs font-normal tabular-nums">
              {slots.length} track{slots.length === 1 ? "" : "s"} ·{" "}
              {formatDuration(setDuration(set, tracks, transitions))}
            </span>
          )}
          {gaps > 0 && (
            <Pill tone="warn" title="Adjacent tracks with no planned transition">
              {gaps} gap{gaps === 1 ? "" : "s"}
            </Pill>
          )}
        </span>
      }
      actions={
        <>
          <Select
            aria-label="Overlay metric"
            selectedKey={overlayMetric}
            onSelectionChange={(key) => {
              if (isMetric(key)) setOverlayMetric(key);
            }}
            isDisabled={slots.length === 0}
          >
            <Button className="border-border bg-surface-raised text-ink hover:border-border-strong rounded-control flex items-center gap-1.5 border px-2 py-1 text-[11px] outline-none disabled:opacity-50">
              <SelectValue />
              <ChevronDown size={12} aria-hidden="true" />
            </Button>
            <Popover className="border-border bg-surface-overlay min-w-[var(--trigger-width)] rounded-md border p-1 shadow-lg">
              <ListBox className="outline-none">
                {METRICS.map((entry) => (
                  <ListBoxItem
                    key={entry.id}
                    id={entry.id}
                    // `data-[selected]` rather than a `selected:` variant — that
                    // needs the React Aria Tailwind plugin, which is not installed.
                    className="text-ink-muted data-[selected]:text-accent data-[focused]:bg-surface-raised cursor-pointer rounded px-2 py-1 text-[11px] outline-none"
                  >
                    {entry.label}
                  </ListBoxItem>
                ))}
              </ListBox>
            </Popover>
          </Select>

          <IconButton
            icon={isMaximized ? Minimize2 : Maximize2}
            label={isMaximized ? "Restore timeline height" : "Maximize timeline"}
            isActive={isMaximized}
            onPress={() => {
              const next = isMaximized
                ? PANEL_LIMITS.timeline.initial
                : PANEL_LIMITS.timeline.max;
              setPanelSize("timeline", next);
              announce(isMaximized ? "Set timeline restored." : "Set timeline maximized.");
            }}
          />
          {/* Only where collapsing does something. The compact (<md) layout
              renders the timeline as a tab and ignores `panels.timeline.visible`,
              so pressing this there is invisible yet still persists a collapsed
              timeline into the next desktop session. `md` is the same query
              `useLayoutMode` reads, so the two can never disagree. */}
          <span className="hidden md:flex">
            <IconButton
              icon={ChevronsDownUp}
              label="Collapse set timeline"
              onPress={() => togglePanel("timeline")}
            />
          </span>
        </>
      }
    >
      {slots.length === 0 ? (
        <EmptyState
          title="No tracks in this set"
          hint="Drag tracks onto the canvas and order them to build the timeline."
        />
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* The gutter stays outside the horizontal scroller so it survives a
              pan, but it is a cell of the same flex row and its labels are the
              last item of a column laid out exactly like the lane's — same
              bottom padding, same CHART_HEIGHT band. Absolutely positioning it
              against the panel's bottom edge instead made it agree with the
              chart at exactly one panel height, because the chart was placed by
              `mt-auto` inside a scroller that clips whenever the cards do not
              fit. Sharing the layout removes the second box that could drift. */}
          <div
            className="text-ink-subtle pointer-events-none flex shrink-0 flex-col justify-end pr-1.5 pb-7 text-right font-mono text-[9px] tabular-nums"
            style={{ width: AXIS_WIDTH }}
          >
            <div
              className="flex shrink-0 flex-col justify-between"
              style={{ height: CHART_HEIGHT }}
            >
              <span>{axis.top}</span>
              <span>{axis.bottom}</span>
            </div>
          </div>

          {/* Cards and curve share one scroller. Two synchronised scrollers
              would let the curve drift out of alignment with its cards, which
              is the one thing this panel cannot get wrong. */}
          <div className="h-full min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
            <div className="flex h-full w-max flex-col gap-2 pt-2 pr-1 pl-0.5">
              {/* The lane gets the leftover height and keeps its natural size
                  inside it (`min-h-0` so the cards cannot push the band down).
                  That is what fixes the band to CHART_HEIGHT above the bottom
                  edge at every panel height, which is what the gutter mirrors. */}
              <div className="min-h-0 flex-1">
                <div className="flex items-start" style={{ gap: LANE_GAP }}>
                  {slots.map((slot, position) => {
                    const next = slots[position + 1];
                    return (
                      <TrackSlotWithLink
                        key={slot.track.id}
                        slot={slot}
                        next={next}
                        total={set.trackIds.length}
                        isSelected={slot.track.id === selectedTrackId}
                        isDropTarget={dragOver === slot.index && dragFrom !== slot.index}
                        isDragging={dragFrom === slot.index}
                        transition={
                          next ? transitionBetween(transitions, slot.track.id, next.track.id) : null
                        }
                        selectedTransitionId={selectedTransitionId}
                        onSelectTrack={selectTrack}
                        onSelectTransition={selectTransition}
                        onAnnounce={announce}
                        onMove={move}
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/plain", String(slot.index));
                          event.dataTransfer.effectAllowed = "move";
                          setDragFrom(slot.index);
                        }}
                        onDragOver={(event) => {
                          // Only our own cards are droppable; a library row would
                          // otherwise appear to be accepted and then do nothing.
                          if (dragFrom === null) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          setDragOver(slot.index);
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const from = Number.parseInt(
                            event.dataTransfer.getData("text/plain"),
                            10,
                          );
                          setDragFrom(null);
                          setDragOver(null);
                          if (Number.isInteger(from)) move(from, slot.index, slot.track.title);
                        }}
                        onDragEnd={() => {
                          setDragFrom(null);
                          setDragOver(null);
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Opaque: a lane taller than the space left over slides behind
                  the band rather than through the curve. Flex items paint
                  atomically in order, so this later sibling covers it. */}
              <div className="bg-surface shrink-0 pb-7">
                <MetricCurve
                  slots={slots}
                  metric={overlayMetric}
                  domain={domain}
                  selectedTrackId={selectedTrackId}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

/**
 * One card and the block that links it to the next track.
 *
 * They are rendered together because the transition only exists as a function
 * of the pair — splitting them would require the lane to re-derive adjacency it
 * already knows.
 */
function TrackSlotWithLink({
  slot,
  next,
  total,
  isSelected,
  isDropTarget,
  isDragging,
  transition,
  selectedTransitionId,
  onSelectTrack,
  onSelectTransition,
  onAnnounce,
  onMove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  slot: Slot;
  next: Slot | undefined;
  total: number;
  isSelected: boolean;
  isDropTarget: boolean;
  isDragging: boolean;
  transition: DemoTransition | null;
  selectedTransitionId: string | null;
  onSelectTrack: (trackId: string) => void;
  onSelectTransition: (transitionId: string) => void;
  onAnnounce: (message: string) => void;
  onMove: (from: number, to: number, title: string) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  const { track, index } = slot;

  return (
    <>
      {/* The drag wrapper is a plain element on purpose: React Aria's `Button`
          deliberately does not forward drag-and-drop props, so the HTML5 source
          has to sit outside it. */}
      <div
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        className={cx(
          "h-[88px] shrink-0 rounded-lg",
          isDragging && "opacity-40",
          // Not colour alone: the drop target grows a dashed outline offset
          // clear of the card's own border.
          isDropTarget && "outline-accent outline-2 outline-offset-2 outline-dashed",
        )}
        style={{ width: CARD_WIDTH }}
      >
        <Button
          onPress={() => onSelectTrack(track.id)}
          // `aria-current` rather than `aria-pressed`: the card is not a toggle,
          // it is the one item of the set currently in focus elsewhere.
          {...(isSelected ? { "aria-current": "true" as const } : {})}
          onKeyDown={(event) => {
            if (!event.altKey) return;
            const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
            if (delta === 0) return;
            // Alt+Arrow is the pointer-free equivalent of the drag; the browser
            // would otherwise scroll the lane out from under the card.
            event.preventDefault();
            onMove(index, index + delta, track.title);
          }}
          className={cx(
            "bg-surface-raised flex h-full w-full flex-col gap-1 rounded-lg border p-1.5 text-left outline-none transition-colors",
            // Selection is not signalled by hue alone: the ring adds visible
            // weight, which survives any colour vision deficiency.
            isSelected
              ? "border-accent ring-accent bg-surface-selected ring-1"
              : "border-border hover:bg-surface-overlay hover:border-border-strong",
          )}
        >
          <div className="flex items-start gap-2">
            <div className="relative shrink-0">
              <Artwork seed={track.id} size={32} />
              <span
                className={cx(
                  "absolute -top-1.5 -right-1.5 grid size-[17px] place-items-center rounded-full border text-[9px] font-semibold tabular-nums",
                  isSelected
                    ? "border-accent bg-accent text-white"
                    : "border-border bg-surface text-ink-muted",
                )}
              >
                <span className="sr-only">Position </span>
                {index + 1}
                <span className="sr-only"> of {total}</span>
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <Truncate className="text-ink text-[11px] font-medium">{track.title}</Truncate>
              <Truncate className="text-ink-muted text-[10px]">{track.artist}</Truncate>
            </div>
          </div>

          <Waveform
            trackId={track.id}
            bars={24}
            energy={track.energy}
            className="h-3"
            {...(isSelected ? { color: "var(--color-waveform-active)" } : {})}
          />

          <div className="mt-auto flex items-center gap-1.5">
            <Bpm value={track.bpm} />
            <CamelotKey value={track.keySignature} />
            <EnergyDots value={track.energy} size={4} />
            <span className="text-ink-subtle ml-auto font-mono text-[10px] tabular-nums">
              {formatDuration(track.durationSeconds)}
            </span>
          </div>
        </Button>
      </div>

      {next &&
        (transition ? (
          <TransitionBlock
            transition={transition}
            fromTitle={track.title}
            toTitle={next.track.title}
            isSelected={transition.id === selectedTransitionId}
            onPress={() => onSelectTransition(transition.id)}
          />
        ) : (
          <AddTransitionBlock
            fromTitle={track.title}
            toTitle={next.track.title}
            onPress={() =>
              // The live region is driven by a store value, and setting it to
              // the string it already holds re-announces nothing. Naming the
              // positions as well as the titles is what keeps two *different*
              // gaps from producing the same message — a set may list the same
              // track more than once, so the titles alone are not unique.
              onAnnounce(
                `No transition from ${track.title} to ${next.track.title}, positions ${index + 1} and ${next.index + 1}. Connect the two nodes on the canvas to plan one.`,
              )
            }
          />
        ))}
    </>
  );
}

/**
 * The link between two adjacent tracks.
 *
 * Styled from the same `TECHNIQUE_COLOR`/dash pair the graph edge uses, so a
 * filter sweep is recognisably the same object in both surfaces — and the dash
 * is drawn as a real line, not implied, because §7 forbids colour as the only
 * cue for technique.
 */
function TransitionBlock({
  transition,
  fromTitle,
  toTitle,
  isSelected,
  onPress,
}: {
  transition: DemoTransition;
  fromTitle: string;
  toTitle: string;
  isSelected: boolean;
  onPress: () => void;
}) {
  const spec = techniqueSpec(transition.technique);
  const color = TECHNIQUE_COLOR[spec.family];
  const warnings = transition.warnings.length;

  const label =
    `${spec.label} from ${fromTitle} to ${toTitle}, ${transition.bars} bars` +
    (warnings > 0 ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : "");

  return (
    <span
      className="relative inline-flex h-[88px] shrink-0 items-center justify-center"
      style={{ width: TRANSITION_WIDTH }}
      title={label}
    >
      <Button
        onPress={onPress}
        {...(isSelected ? { "aria-current": "true" as const } : {})}
        aria-label={label}
        className={cx(
          "relative grid size-5 place-items-center rounded-full outline-none transition-colors",
          isSelected
            ? "bg-surface-selected ring-accent ring-2"
            : "hover:bg-surface-overlay",
        )}
      >
        <svg width={20} height={20} aria-hidden="true">
          <line
            x1={0}
            y1={10}
            x2={20}
            y2={10}
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            {...(spec.dash !== null ? { strokeDasharray: spec.dash } : {})}
          />
          <circle cx={10} cy={10} r={3} fill="var(--color-surface)" stroke={color} strokeWidth={2} />
        </svg>
        {warnings > 0 && (
          <AlertTriangle
            size={10}
            aria-hidden="true"
            className="text-warn absolute -top-1.5 -right-1.5"
          />
        )}
      </Button>
    </span>
  );
}

function AddTransitionBlock({
  fromTitle,
  toTitle,
  onPress,
}: {
  fromTitle: string;
  toTitle: string;
  onPress: () => void;
}) {
  const label = `Add a transition from ${fromTitle} to ${toTitle}`;
  return (
    <span
      className="inline-flex h-[88px] shrink-0 items-center justify-center"
      style={{ width: TRANSITION_WIDTH }}
      title={label}
    >
      <Button
        onPress={onPress}
        aria-label={label}
        className="border-border-strong text-ink-subtle hover:border-accent hover:text-accent grid size-5 place-items-center rounded-full border border-dashed outline-none transition-colors"
      >
        <Plus size={11} aria-hidden="true" />
      </Button>
    </span>
  );
}

/**
 * The set's shape over time.
 *
 * Hand-rolled SVG rather than a chart library: this is one smooth path over at
 * most a few dozen points whose x positions are dictated by the lane above, and
 * no charting library gives that alignment for less code than this.
 */
function smoothPath(points: ReadonlyArray<{ x: number; y: number }>): string {
  const first = points[0];
  if (!first) return "";
  if (points.length === 1) return `M ${first.x} ${first.y}`;

  const segments = [`M ${first.x} ${first.y}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const after = points[index + 2] ?? next;
    if (!previous || !current || !next || !after) continue;

    const control1 = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6,
    };
    const control2 = {
      x: next.x - (after.x - current.x) / 6,
      y: next.y - (after.y - current.y) / 6,
    };
    segments.push(
      `C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${next.x} ${next.y}`,
    );
  }
  return segments.join(" ");
}

function MetricCurve({
  slots,
  metric,
  domain,
  selectedTrackId,
}: {
  slots: Slot[];
  metric: OverlayMetric;
  domain: { min: number; max: number };
  selectedTrackId: string | null;
}) {
  const width = laneWidth(slots.length);
  const color = METRIC_COLOR[metric];
  const metricLabel = METRICS.find((entry) => entry.id === metric)?.label ?? "Energy";
  const span = domain.max - domain.min || 1;
  const plotHeight = CHART_HEIGHT - CHART_PAD * 2;

  const points = slots.map((slot, position) => {
    const value = metricValue(slot.track, metric);
    // An unknown value still needs a y or the polyline breaks into segments;
    // the midline is the least misleading placement, and the point is drawn
    // hollow with an "unknown" title so it is never read as real data.
    const ratio = value === null ? 0.5 : (value - domain.min) / span;
    return {
      track: slot.track,
      value,
      x: cardCenterX(position),
      y: CHART_PAD + (1 - Math.max(0, Math.min(1, ratio))) * plotHeight,
    };
  });

  const first = points[0];
  const last = points[points.length - 1];
  // A single point has no line and no area. The dot alone is the honest
  // rendering of a one-track set.
  const hasCurve = points.length >= 2 && first !== undefined && last !== undefined;
  const curve = hasCurve ? smoothPath(points) : "";
  const area = hasCurve
    ? `${curve} L ${last.x} ${CHART_HEIGHT} L ${first.x} ${CHART_HEIGHT} Z`
    : "";

  return (
    <div>
      <svg
        width={width}
        height={CHART_HEIGHT}
        viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
        role="img"
        aria-label={`${metricLabel} across ${slots.length} tracks in set order`}
        className="block"
      >
        {/* One guide per track boundary, sitting under the transition block it
            belongs to — it is what ties a step in the curve to the mix causing it. */}
        {points.slice(0, -1).map((point, position) => (
          <line
            key={`guide-${point.track.id}`}
            x1={boundaryX(position)}
            y1={0}
            x2={boundaryX(position)}
            y2={CHART_HEIGHT}
            stroke="var(--color-border)"
            strokeWidth={1}
          />
        ))}

        {hasCurve && (
          <>
            <path d={area} fill={color} opacity={0.2} />
            <path
              d={curve}
              fill="none"
              stroke={color}
              strokeWidth={2.25}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </>
        )}

        {points.map((point) => {
          const isSelected = point.track.id === selectedTrackId;
          return (
            <circle
              key={point.track.id}
              cx={point.x}
              cy={point.y}
              r={isSelected ? 4.5 : 3}
              fill={point.value === null ? "var(--color-surface)" : color}
              stroke={
                point.value === null
                  ? "var(--color-danger)"
                  : isSelected
                    ? "var(--color-ink)"
                    : "var(--color-surface)"
              }
              strokeWidth={1.5}
            >
              <title>{`${point.track.title} — ${metricText(point.track, metric)}`}</title>
            </circle>
          );
        })}
      </svg>

      {/* The curve is a picture; this is the same data as text, so the panel is
          not shape-and-colour-only for anyone using a screen reader. */}
      <ol className="sr-only">
        {points.map((point, position) => (
          <li key={point.track.id}>
            {position + 1}. {point.track.title} — {metricText(point.track, metric)}
          </li>
        ))}
      </ol>
    </div>
  );
}
