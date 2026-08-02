import { useState, type ReactNode } from "react";
import { Button, Slider, SliderTrack, SliderThumb, ToggleButton } from "react-aria-components";
import { ChevronDown, Star, Plus } from "lucide-react";
import { cx } from "./primitives.js";
import { waveformPeaks } from "../lib/mock.js";

/**
 * Shared UI vocabulary.
 *
 * Every panel draws from this so the surfaces stay consistent — the mockup's
 * cohesion comes from repetition, and the fastest way to lose it is each
 * panel inventing its own chip, section header, and slider.
 */

/* -------------------------------------------------------------- Waveform -- */

/**
 * Mini waveform for library rows, canvas nodes, and timeline cards.
 *
 * SVG rather than canvas: a library row is ~40 bars, and at that size the
 * DOM cost is lower than a canvas context per row. The large inspector
 * variant is a separate component for that reason.
 */
export function MiniWaveform({
  trackId,
  bars = 40,
  className,
  color = "var(--color-energy)",
}: {
  trackId: string;
  bars?: number;
  className?: string;
  color?: string;
}) {
  const peaks = waveformPeaks(trackId, bars);

  return (
    <svg
      viewBox={`0 0 ${bars * 2} 20`}
      preserveAspectRatio="none"
      className={cx("h-4 w-full", className)}
      aria-hidden="true"
    >
      {peaks.map((peak, index) => (
        <rect
          key={index}
          x={index * 2}
          y={10 - peak * 9}
          width={1.2}
          height={Math.max(1, peak * 18)}
          rx={0.6}
          fill={color}
          opacity={0.45 + peak * 0.5}
        />
      ))}
    </svg>
  );
}

export interface WaveformCue {
  seconds: number;
  color: string;
  label: string;
}

/**
 * Large waveform with cue markers — the inspector's centrepiece.
 *
 * Cue positions are a fraction of duration, so the markers stay aligned at
 * any width without a layout pass.
 */
export function DetailWaveform({
  trackId,
  durationSeconds,
  cues = [],
  onSeek,
}: {
  trackId: string;
  durationSeconds: number;
  cues?: WaveformCue[];
  onSeek?: (seconds: number) => void;
}) {
  const bars = 120;
  const peaks = waveformPeaks(trackId, bars);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${bars * 2} 64`}
        preserveAspectRatio="none"
        className="bg-surface-raised h-20 w-full rounded-md"
        role="img"
        aria-label="Track waveform"
        onClick={(event) => {
          if (!onSeek) return;
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
            fill="var(--color-energy)"
            opacity={0.35 + peak * 0.5}
          />
        ))}
      </svg>

      {cues.map((cue) => (
        <div
          key={`${cue.label}-${cue.seconds}`}
          className="pointer-events-none absolute top-0 h-20 w-px"
          style={{
            left: `${(cue.seconds / durationSeconds) * 100}%`,
            background: cue.color,
          }}
          title={`${cue.label}`}
        >
          <span
            className="absolute -top-px -left-[3px] size-[7px] rounded-sm"
            style={{ background: cue.color }}
          />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- Sections -- */

export function Section({
  title,
  children,
  defaultOpen = true,
  onAdd,
  addLabel,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  onAdd?: () => void;
  addLabel?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="border-border border-b last:border-b-0">
      <div className="flex items-center justify-between px-3 py-2">
        <Button
          onPress={() => setOpen(!open)}
          aria-expanded={open}
          className="text-ink-muted hover:text-ink flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase"
        >
          <ChevronDown
            size={13}
            className={cx("transition-transform", !open && "-rotate-90")}
          />
          {title}
        </Button>
        {onAdd && (
          <Button
            onPress={onAdd}
            aria-label={addLabel ?? `Add ${title}`}
            className="text-ink-subtle hover:text-ink"
          >
            <Plus size={14} />
          </Button>
        )}
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

/** Label/value row used throughout the inspector's metadata block. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <dt className="text-ink-subtle shrink-0 text-[11px]">{label}</dt>
      <dd className="text-ink truncate text-right text-[11px]">{children}</dd>
    </div>
  );
}

/* --------------------------------------------------------------- Inputs -- */

export function StarRating({
  value,
  max = 5,
  onChange,
}: {
  value: number;
  max?: number;
  onChange?: (value: number) => void;
}) {
  return (
    <span className="inline-flex items-center gap-px" role="img" aria-label={`${value} of ${max} stars`}>
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
            className={index < value ? "fill-energy text-energy" : "text-border-strong"}
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
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Slider
      value={value}
      onChange={onChange}
      minValue={0}
      maxValue={1}
      step={0.01}
      aria-label={label}
      className="flex-1"
    >
      <SliderTrack className="bg-border-strong relative h-1 w-full rounded-full">
        {({ state }) => (
          <>
            <div
              className="bg-accent absolute h-1 rounded-full"
              style={{ width: `${state.getThumbPercent(0) * 100}%` }}
            />
            <SliderThumb className="border-accent bg-ink top-1/2 size-2.5 rounded-full border" />
          </>
        )}
      </SliderTrack>
    </Slider>
  );
}

/** Small square toggle — the S/M buttons on each stem. */
export function MiniToggle({
  label,
  isSelected,
  onChange,
  tone = "accent",
}: {
  label: string;
  isSelected: boolean;
  onChange: (value: boolean) => void;
  tone?: "accent" | "warn";
}) {
  return (
    <ToggleButton
      isSelected={isSelected}
      onChange={onChange}
      aria-label={label}
      className={cx(
        "border-border text-ink-subtle size-5 rounded border text-[10px] font-medium",
        isSelected && tone === "accent" && "border-accent bg-accent text-white",
        isSelected && tone === "warn" && "border-warn bg-warn text-black",
      )}
    >
      {label}
    </ToggleButton>
  );
}

/* --------------------------------------------------------------- Chrome -- */

export function IconButton({
  icon: Icon,
  label,
  onPress,
  isActive,
  isDisabled,
  size = 15,
}: {
  icon: typeof Star;
  label: string;
  onPress?: () => void;
  isActive?: boolean;
  isDisabled?: boolean;
  size?: number;
}) {
  return (
    <Button
      onPress={onPress}
      isDisabled={isDisabled}
      aria-label={label}
      aria-pressed={isActive}
      className={cx(
        "grid size-7 place-items-center rounded-md transition-colors",
        isActive
          ? "bg-accent-muted text-accent"
          : "text-ink-muted hover:bg-surface-raised hover:text-ink",
        isDisabled && "opacity-40",
      )}
    >
      <Icon size={size} />
    </Button>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "accent";
}) {
  return (
    <span
      className={cx(
        "rounded-full border px-2 py-0.5 text-[10px] font-medium",
        tone === "neutral" && "border-border text-ink-muted",
        tone === "ok" && "border-ok/40 text-ok",
        tone === "warn" && "border-warn/40 text-warn",
        tone === "accent" && "border-accent/50 text-accent",
      )}
    >
      {children}
    </span>
  );
}

/**
 * Marks UI backed by demo data.
 *
 * Building UI ahead of endpoints only works if it is obvious which numbers
 * are real — otherwise the design gets evaluated against fiction.
 */
export function DemoBadge({ what }: { what: string }) {
  return (
    <span
      className="border-warn/30 text-warn/70 rounded border px-1 py-px text-[9px] tracking-wide uppercase"
      title={`${what} is demo data — no API behind it yet`}
    >
      demo
    </span>
  );
}
