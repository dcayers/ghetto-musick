import {
  Button,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
} from "react-aria-components";
import { ChevronDown, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Artwork, Bpm, CamelotKey, EnergyDots, EmptyState, Panel, cx } from "./primitives.js";
import { DemoBadge, IconButton, MiniWaveform } from "./ui.js";
import { durationFor, energyFor, formatDuration } from "../lib/mock.js";

/**
 * Set timeline — the ordered playback view under the canvas.
 *
 * The graph answers "what could follow what"; this answers "what actually
 * happens, in order". The energy curve is the reason the panel earns its
 * vertical space: a set reads as a shape over time, and the shape is only
 * visible when the metric is plotted against position rather than listed.
 */

export type SetTimelineMetric = "energy" | "bpm" | "key";

export interface SetTimelineTrack {
  id: string;
  title: string;
  artist: string;
  bpm: number | null;
  keySignature: string | null;
}

export interface SetTimelineProps {
  /** Tracks in set order; index 0 opens the set. */
  tracks: SetTimelineTrack[];
  selectedTrackId?: string | null | undefined;
  onSelect: (trackId: string) => void;
  metric: SetTimelineMetric;
  onMetricChange: (metric: SetTimelineMetric) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

/**
 * Card geometry in pixels rather than Tailwind spacing.
 *
 * The curve's data points must sit dead centre under their card. Deriving the
 * x positions from the same two numbers the layout uses is the only way to
 * guarantee that; a `gap-3` class would silently drift if the root font size
 * were ever changed.
 */
const CARD_WIDTH = 152;
const CARD_GAP = 12;

const CHART_HEIGHT = 76;
/** Keeps the extreme points off the chart's edges so their circles aren't clipped. */
const CHART_PAD = 10;
/** Width of the High/Low axis gutter, which sits outside the horizontal scroller. */
const AXIS_WIDTH = 36;

const METRICS: ReadonlyArray<{ id: SetTimelineMetric; label: string }> = [
  { id: "energy", label: "Energy" },
  { id: "bpm", label: "BPM" },
  { id: "key", label: "Key" },
];

/**
 * Each metric borrows the token already used for it elsewhere, so the curve
 * reads as the same quantity the cards show. Colour is never the only signal —
 * the Select names the metric and every point carries a text label.
 */
const METRIC_COLOR: Record<SetTimelineMetric, string> = {
  energy: "var(--color-energy)",
  bpm: "var(--color-bpm)",
  key: "var(--color-key)",
};

/** "8A" → 8. The number is the wheel position; the letter is the mode. */
function camelotNumber(key: string | null): number | null {
  if (!key) return null;
  const match = /^(\d{1,2})/.exec(key.trim());
  const digits = match?.[1];
  if (digits === undefined) return null;
  const position = Number(digits);
  return position >= 1 && position <= 12 ? position : null;
}

function isMetric(value: unknown): value is SetTimelineMetric {
  return METRICS.some((entry) => entry.id === value);
}

function metricValue(track: SetTimelineTrack, metric: SetTimelineMetric): number | null {
  if (metric === "bpm") return track.bpm;
  if (metric === "key") return camelotNumber(track.keySignature);
  return energyFor(track.id);
}

function metricText(track: SetTimelineTrack, metric: SetTimelineMetric): string {
  if (metric === "bpm") return track.bpm === null ? "BPM unknown" : `${track.bpm.toFixed(0)} BPM`;
  if (metric === "key") {
    return camelotNumber(track.keySignature) === null
      ? "Key unknown"
      : `Camelot ${track.keySignature}`;
  }
  return `Energy ${energyFor(track.id)} of 5`;
}

/**
 * Energy and Camelot have fixed ranges, so they get fixed domains — otherwise
 * a set of four flat tracks would draw a dramatic mountain range out of a
 * one-step difference. BPM has no natural bounds, so it is scaled to the set
 * with headroom, and a set that is all one tempo still draws a flat line
 * rather than dividing by zero.
 */
function domainFor(metric: SetTimelineMetric, values: number[]): { min: number; max: number } {
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
 * "High"/"Low" would be a lie for Camelot — position 12 is not higher than 1,
 * it is adjacent to it — and it makes the gutter cost 36px to say nothing.
 * Printing the actual domain endpoints means a value can be read off the curve.
 */
function axisLabels(
  metric: SetTimelineMetric,
  domain: { min: number; max: number },
): { top: string; bottom: string } {
  if (metric === "key") return { top: "12A", bottom: "1A" };
  if (metric === "energy") return { top: "5", bottom: "1" };
  return { top: `${Math.round(domain.max)}`, bottom: `${Math.round(domain.min)}` };
}

export function SetTimeline({
  tracks,
  selectedTrackId,
  onSelect,
  metric,
  onMetricChange,
  isExpanded,
  onToggleExpand,
}: SetTimelineProps) {
  const totalSeconds = tracks.reduce((sum, track) => sum + durationFor(track.id), 0);
  const metricLabel = METRICS.find((entry) => entry.id === metric)?.label ?? "Energy";

  // Computed here rather than inside the chart so the axis gutter and the
  // curve cannot disagree about what the vertical extent means.
  const domain = domainFor(
    metric,
    tracks
      .map((track) => metricValue(track, metric))
      .filter((value): value is number => value !== null),
  );
  const axis = axisLabels(metric, domain);

  return (
    <Panel
      className="min-h-0"
      title={
        <span className="flex items-baseline gap-2 whitespace-nowrap">
          Set Timeline
          {tracks.length > 0 && (
            <span className="text-ink-subtle text-xs font-normal tabular-nums">
              {tracks.length} track{tracks.length === 1 ? "" : "s"} ·{" "}
              {formatDuration(totalSeconds)}
            </span>
          )}
        </span>
      }
      actions={
        <div className="flex items-center gap-2">
          {/* One badge, not two. Durations and waveforms are always demo data;
              the energy series is demo only when it is the chosen metric, so
              the wording widens rather than a second badge appearing. */}
          {tracks.length > 0 && (
            <DemoBadge
              what={
                metric === "energy"
                  ? "Durations, waveforms, and the energy curve"
                  : "Track durations and waveforms"
              }
            />
          )}

          <Select
            aria-label="Curve metric"
            selectedKey={metric}
            onSelectionChange={(key) => {
              if (isMetric(key)) onMetricChange(key);
            }}
            isDisabled={tracks.length === 0}
          >
            <Button className="border-border bg-surface-raised text-ink hover:border-border-strong flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] outline-none disabled:opacity-50">
              <SelectValue />
              <ChevronDown size={12} aria-hidden="true" />
            </Button>
            <Popover className="border-border bg-surface-overlay min-w-[var(--trigger-width)] rounded-md border p-1 shadow-lg">
              <ListBox className="outline-none">
                {METRICS.map((entry) => (
                  <ListBoxItem
                    key={entry.id}
                    id={entry.id}
                    // `data-[selected]` rather than the `selected:` variant —
                    // that variant needs the React Aria Tailwind plugin, which
                    // this app does not install.
                    className="text-ink-muted data-[selected]:text-accent hover:bg-surface-raised cursor-pointer rounded px-2 py-1 text-[11px] outline-none"
                  >
                    {entry.label}
                  </ListBoxItem>
                ))}
              </ListBox>
            </Popover>
          </Select>

          {/* The panel's height belongs to the parent layout; this only reports
              the intent, which is why it is a callback rather than local state. */}
          <IconButton
            icon={isExpanded ? ChevronsDownUp : ChevronsUpDown}
            label={isExpanded ? "Collapse set timeline" : "Expand set timeline"}
            onPress={onToggleExpand}
            isActive={isExpanded}
          />
        </div>
      }
    >
      {tracks.length === 0 ? (
        <EmptyState
          title="No tracks in this set"
          hint="Drag tracks onto the canvas and order them to build the timeline."
        />
      ) : (
        <div className="relative min-h-0 flex-1">
          {/* Cards and curve share one scroller. Two synchronised scrollers
              would let the curve drift out of alignment with its cards, which
              is the one thing this panel cannot get wrong. */}
          <div className="h-full overflow-x-auto overflow-y-hidden">
            {/* `h-full` + `mt-auto` on the chart is what makes the pinned axis
                gutter correct: both are anchored to the same bottom edge. With
                the column merely top-aligned, a panel taller than its content
                would float the chart away from the axis labelling it. */}
            <div
              className="flex h-full w-max flex-col gap-2 py-3 pr-3"
              style={{ paddingLeft: isExpanded ? AXIS_WIDTH : 12 }}
            >
              <div className="flex" style={{ gap: CARD_GAP }}>
                {tracks.map((track, index) => (
                  <TrackCard
                    key={track.id}
                    track={track}
                    position={index + 1}
                    isSelected={track.id === selectedTrackId}
                    onPress={() => onSelect(track.id)}
                  />
                ))}
              </div>

              {/* Collapsing hides the curve, not the cards. The card row is
                  the panel's job; the curve is the analysis on top of it, and
                  it is what the vertical space is actually being spent on. */}
              {isExpanded && (
                <div className="mt-auto">
                  <MetricCurve
                    tracks={tracks}
                    metric={metric}
                    metricLabel={metricLabel}
                    domain={domain}
                    selectedTrackId={selectedTrackId ?? null}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Pinned to the chart band so the axis stays legible while the row
              scrolls; the opaque background lets cards pass behind it. */}
          {isExpanded && (
            <div
              className="bg-surface text-ink-subtle pointer-events-none absolute bottom-3 left-0 flex flex-col justify-between pr-1.5 text-right font-mono text-[9px] tabular-nums"
              style={{ width: AXIS_WIDTH, height: CHART_HEIGHT }}
            >
              <span>{axis.top}</span>
              <span>{axis.bottom}</span>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function TrackCard({
  track,
  position,
  isSelected,
  onPress,
}: {
  track: SetTimelineTrack;
  position: number;
  isSelected: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      onPress={onPress}
      // `aria-current` rather than `aria-pressed`: the card is not a toggle,
      // it is the one item of a set that is currently in focus elsewhere.
      {...(isSelected ? { "aria-current": "true" as const } : {})}
      className={cx(
        "bg-surface-raised flex shrink-0 flex-col gap-2 rounded-lg border p-2 text-left outline-none transition-colors",
        // Selection is not signalled by hue alone: the ring adds visible
        // weight to the outline, which survives any colour vision deficiency.
        isSelected
          ? "border-accent ring-accent bg-surface-overlay ring-1"
          : "border-border hover:bg-surface-overlay hover:border-border-strong",
      )}
      style={{ width: CARD_WIDTH }}
    >
      <div className="flex items-start gap-2">
        <div className="relative shrink-0">
          <Artwork seed={track.id} size={40} />
          <span
            className={cx(
              "absolute -top-1.5 -right-1.5 grid size-[18px] place-items-center rounded-full border text-[9px] font-semibold tabular-nums",
              isSelected
                ? "border-accent bg-accent text-white"
                : "border-border bg-surface text-ink-muted",
            )}
          >
            <span className="sr-only">Position </span>
            {position}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-ink truncate text-[11px] font-medium">{track.title}</p>
          <p className="text-ink-muted truncate text-[10px]">{track.artist}</p>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <Bpm value={track.bpm} />
        <CamelotKey value={track.keySignature} />
        <span className="ml-auto">
          <EnergyDots value={energyFor(track.id)} />
        </span>
      </div>

      <MiniWaveform trackId={track.id} bars={28} />

      <span className="text-ink-subtle text-right font-mono text-[10px] tabular-nums">
        {formatDuration(durationFor(track.id))}
      </span>
    </Button>
  );
}

/**
 * The set's shape over time.
 *
 * Hand-rolled SVG rather than a chart library: this is one polyline over at
 * most a few dozen points whose x positions are dictated by the card layout
 * above, and no charting library gives that alignment for less code than this.
 */
function MetricCurve({
  tracks,
  metric,
  metricLabel,
  domain,
  selectedTrackId,
}: {
  tracks: SetTimelineTrack[];
  metric: SetTimelineMetric;
  metricLabel: string;
  domain: { min: number; max: number };
  selectedTrackId: string | null;
}) {
  const width = tracks.length * CARD_WIDTH + Math.max(0, tracks.length - 1) * CARD_GAP;
  const color = METRIC_COLOR[metric];

  const values = tracks.map((track) => metricValue(track, metric));
  const span = domain.max - domain.min || 1;
  const plotHeight = CHART_HEIGHT - CHART_PAD * 2;

  const points = tracks.map((track, index) => {
    const value = values[index] ?? null;
    // An unknown value still needs a y or the polyline breaks into segments;
    // the midline is the least misleading placement and the point is drawn
    // hollow with a "unknown" title so it is never read as real data.
    const ratio = value === null ? 0.5 : (value - domain.min) / span;
    return {
      track,
      value,
      x: index * (CARD_WIDTH + CARD_GAP) + CARD_WIDTH / 2,
      y: CHART_PAD + (1 - Math.max(0, Math.min(1, ratio))) * plotHeight,
    };
  });

  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  // A single point has no line and no area — a one-coordinate `polyline` draws
  // nothing and the polygon collapses to zero width. The dot alone is the
  // honest rendering of a one-track set.
  const hasCurve = points.length >= 2 && first !== undefined && last !== undefined;
  const area = hasCurve ? `${first.x},${CHART_HEIGHT} ${line} ${last.x},${CHART_HEIGHT}` : "";

  return (
    <div>
      <svg
        width={width}
        height={CHART_HEIGHT}
        viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
        role="img"
        aria-label={`${metricLabel} across ${tracks.length} tracks in set order`}
        className="block"
      >
        {hasCurve && (
          <>
            <polygon points={area} fill={color} opacity={0.12} />
            <polyline
              points={line}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
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
        {points.map((point, index) => (
          <li key={point.track.id}>
            {index + 1}. {point.track.title} — {metricText(point.track, metric)}
          </li>
        ))}
      </ol>
    </div>
  );
}
