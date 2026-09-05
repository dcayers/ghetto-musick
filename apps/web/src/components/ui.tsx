import { type ReactNode } from "react";
import {
  Button,
  Slider,
  SliderTrack,
  SliderThumb,
  ToggleButton,
  Tooltip,
  TooltipTrigger,
} from "react-aria-components";
import { ChevronDown, Star, Plus } from "lucide-react";
import { cx, Waveform } from "./primitives.js";
import { useWorkspace } from "../state/workspace.js";
import { waveformPeaks } from "../lib/workspace-data.js";

/**
 * Shared controls.
 *
 * Every panel draws from this so the surfaces stay consistent — cohesion comes
 * from repetition, and the fastest way to lose it is each panel inventing its
 * own chip, section header, and slider.
 */

/* -------------------------------------------------------------- Waveform -- */

export interface WaveformCue {
  seconds: number;
  color: string;
  label: string;
}

/**
 * Large waveform with cue markers — the inspector's centrepiece.
 *
 * Cue positions are a fraction of duration, so markers stay aligned at any
 * width without a layout pass. Clicking seeks; there is no transport yet, so
 * the callback is optional and the cursor only changes when one is supplied.
 */
export function DetailWaveform({
  trackId,
  durationSeconds,
  energy: _energy = null,
  cues = [],
  positionSeconds,
  onSeek,
}: {
  trackId: string;
  /** Null when the running time is unknown — the scrub track is inert. */
  durationSeconds: number | null;
  energy?: number | null;
  cues?: WaveformCue[];
  positionSeconds?: number;
  onSeek?: (seconds: number) => void;
}) {
  const bars = 128;
  const peaks = waveformPeaks(trackId, bars);
  const color = "var(--color-waveform-active)";

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${bars * 2} 64`}
        preserveAspectRatio="none"
        className={cx(
          "bg-surface-raised rounded-card h-[72px] w-full",
          onSeek && durationSeconds !== null && "cursor-pointer",
        )}
        role="img"
        aria-label={`Waveform, ${cues.length} cue markers`}
        onClick={(event) => {
          // Without a duration a click maps to no timestamp, so the
          // waveform is a picture rather than a scrub track.
          if (!onSeek || durationSeconds === null) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - rect.left) / rect.width;
          onSeek(Math.max(0, Math.min(1, ratio)) * durationSeconds);
        }}
      >
        {peaks.map((peak, index) => (
          <rect
            key={index}
            x={index * 2}
            y={32 - peak * 30}
            width={1.3}
            height={Math.max(2, peak * 60)}
            rx={0.6}
            fill={color}
            opacity={0.58 + peak * 0.38}
          />
        ))}
      </svg>

      {cues.map((cue) => (
        <div
          key={`${cue.label}-${cue.seconds}`}
          className="pointer-events-none absolute top-0 h-[72px] w-px"
          style={{
            left: `${(cue.seconds / Math.max(1, durationSeconds ?? 1)) * 100}%`,
            background: cue.color,
          }}
          title={cue.label}
        >
          <span
            className="absolute -top-px -left-[3px] size-[7px] rounded-sm"
            style={{ background: cue.color }}
          />
        </div>
      ))}

      {positionSeconds !== undefined && durationSeconds !== null && (
        <div
          aria-hidden="true"
          className="bg-ink pointer-events-none absolute top-0 h-[72px] w-px"
          style={{ left: `${(positionSeconds / Math.max(1, durationSeconds)) * 100}%` }}
        />
      )}
    </div>
  );
}

/** Re-exported so panels have one import site for waveforms. */
export { Waveform };

/* ------------------------------------------------------------- Sections -- */

/**
 * Collapsible inspector section.
 *
 * Open state lives in the store keyed by `id` so it survives selection changes
 * — §9 requires expansion state to be preserved, and the inspector remounts
 * per track.
 */
export function Section({
  id,
  title,
  children,
  onAdd,
  addLabel,
  aside,
}: {
  id: string;
  title: string;
  children: ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  aside?: ReactNode;
}) {
  const open = useWorkspace((state) => state.openSections[id] ?? true);
  const toggleSection = useWorkspace((state) => state.toggleSection);
  const contentId = `section-${id}`;

  return (
    <section className="border-border border-b last:border-b-0">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <Button
          onPress={() => toggleSection(id)}
          aria-expanded={open}
          aria-controls={contentId}
          className="text-ink-muted hover:text-ink flex min-w-0 items-center gap-1.5 text-section font-medium uppercase"
        >
          <ChevronDown
            size={13}
            aria-hidden="true"
            className={cx("shrink-0 transition-transform", !open && "-rotate-90")}
          />
          {title}
        </Button>
        <div className="flex shrink-0 items-center gap-1.5">
          {aside}
          {onAdd && (
            <Button
              onPress={onAdd}
              aria-label={addLabel ?? `Add ${title}`}
              className="text-ink-subtle hover:text-ink grid size-6 place-items-center rounded"
            >
              <Plus size={14} aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div id={contentId} className="px-3 pb-3">
          {children}
        </div>
      )}
    </section>
  );
}

/** Label/value row used throughout the inspector's metadata block. */
export function Field({
  label,
  children,
  aside,
}: {
  label: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] items-baseline gap-2 py-[3px]">
      <dt className="text-ink-subtle text-label">{label}</dt>
      <dd className="text-ink flex min-w-0 flex-wrap items-baseline justify-end gap-x-1.5 gap-y-1 text-right text-label">
        <span className="min-w-0 flex-1 truncate">{children}</span>
        <span className="shrink-0">{aside}</span>
      </dd>
    </div>
  );
}

/* --------------------------------------------------------------- Inputs -- */

export function StarRating({
  value,
  max = 5,
  onChange,
}: {
  /** Null renders an unrated control rather than a zero-star rating. */
  value: number | null;
  max?: number;
  onChange?: (value: number) => void;
}) {
  return (
    <span
      className="inline-flex items-center gap-px"
      role="img"
      aria-label={`${value} of ${max} stars`}
    >
      {Array.from({ length: max }, (_, index) => (
        <Button
          key={index}
          isDisabled={!onChange}
          onPress={() => onChange?.(index + 1)}
          aria-label={`${index + 1} stars`}
          className="disabled:cursor-default"
        >
          <Star
            size={11}
            aria-hidden="true"
            className={
              index < (value ?? 0) ? "fill-warn text-warn" : "text-border-strong"
            }
          />
        </Button>
      ))}
    </span>
  );
}

export function LevelSlider({
  label,
  value,
  onChange,
  isDisabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  isDisabled?: boolean;
}) {
  return (
    <Slider
      value={value}
      onChange={onChange}
      isDisabled={isDisabled}
      minValue={0}
      maxValue={1}
      step={0.01}
      aria-label={label}
      className="flex-1"
    >
      <SliderTrack className="bg-border-strong relative h-1 w-full rounded-full data-[disabled]:opacity-40">
        {({ state }) => (
          <>
            <div
              className="bg-accent absolute h-1 rounded-full"
              style={{ width: `${state.getThumbPercent(0) * 100}%` }}
            />
            <SliderThumb className="border-accent bg-ink top-1/2 size-3 rounded-full border" />
          </>
        )}
      </SliderTrack>
    </Slider>
  );
}

/** Small square toggle — the S/M buttons on each stem. */
export function MiniToggle({
  label,
  description,
  isSelected,
  onChange,
  isDisabled = false,
  tone = "accent",
}: {
  label: string;
  description: string;
  isSelected: boolean;
  onChange: (value: boolean) => void;
  isDisabled?: boolean;
  tone?: "accent" | "warn";
}) {
  return (
    <Hint label={description}>
      <ToggleButton
        isSelected={isSelected}
        onChange={onChange}
        isDisabled={isDisabled}
        // The visible glyph is one letter, so the accessible name has to carry
        // the meaning — "S" tells a screen-reader user nothing.
        aria-label={description}
        className={cx(
          "border-border text-ink-subtle rounded-control grid size-5 shrink-0 place-items-center border text-meta font-medium disabled:opacity-40",
          isSelected && tone === "accent" && "border-accent bg-accent-strong text-white",
          isSelected && tone === "warn" && "border-warn bg-warn text-black",
        )}
      >
        {label}
      </ToggleButton>
    </Hint>
  );
}

/* --------------------------------------------------------------- Chrome -- */

/**
 * Hover/focus tooltip.
 *
 * React Aria's `Button` does not forward `title`, and §17 requires a tooltip
 * that *accompanies* rather than replaces the accessible name — so the label is
 * set with `aria-label` on the control and repeated visually here. RAC's
 * tooltip also appears on keyboard focus, which `title` never does.
 */
export function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipTrigger delay={400} closeDelay={0}>
      {children}
      <Tooltip
        offset={6}
        className="border-border bg-surface-overlay text-ink rounded-control z-50 border px-2 py-1 text-label shadow-lg"
      >
        {label}
      </Tooltip>
    </TooltipTrigger>
  );
}

export function IconButton({
  icon: Icon,
  label,
  onPress,
  isActive,
  isDisabled,
  size = 15,
  iconClassName,
  tone = "default",
}: {
  icon: typeof Star;
  label: string;
  onPress?: () => void;
  isActive?: boolean;
  isDisabled?: boolean;
  size?: number;
  /** For glyphs that carry state in their shape — a filled star, say. */
  iconClassName?: string;
  tone?: "default" | "danger";
}) {
  return (
    <Hint label={label}>
      <Button
        {...(onPress ? { onPress } : {})}
        {...(isDisabled !== undefined ? { isDisabled } : {})}
        aria-label={label}
        {...(isActive !== undefined ? { "aria-pressed": isActive } : {})}
        className={cx(
          // The active ring is not decoration. §17 forbids signalling state by
          // hue alone, and `bg-accent-muted` is ~1.3:1 against the panel — an
          // outline that is present or absent survives greyscale.
          "rounded-control grid size-7 shrink-0 place-items-center transition-colors disabled:opacity-40",
          isActive
            ? "bg-accent-muted text-accent-text ring-accent/70 ring-1"
            : tone === "danger"
              ? "text-ink-muted hover:bg-danger/15 hover:text-danger"
              : "text-ink-muted hover:bg-surface-hover hover:text-ink",
        )}
      >
        <Icon size={size} aria-hidden="true" className={iconClassName} />
      </Button>
    </Hint>
  );
}

export function Pill({
  children,
  tone = "neutral",
  className,
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger" | "accent" | "info";
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-meta font-medium whitespace-nowrap",
        tone === "neutral" && "border-border text-ink-muted",
        tone === "ok" && "border-ok/40 text-ok",
        tone === "warn" && "border-warn/40 text-warn",
        tone === "danger" && "border-danger/40 text-danger",
        tone === "accent" && "border-accent/50 text-accent-text",
        tone === "info" && "border-info/40 text-info",
        className,
      )}
    >
      {children}
    </span>
  );
}
