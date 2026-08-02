import type { ReactNode } from "react";
import { waveformPeaks, type TrackSource } from "../lib/demo-data.js";

/**
 * Shared display primitives.
 *
 * Artwork, BPM, key, energy, and waveforms appear in the library, on graph
 * nodes, in the timeline, and in the inspector. §19 forbids each surface
 * rendering its own — defining them once is what keeps a track recognisable as
 * the same track wherever it appears.
 */

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ text -- */

/**
 * Truncates with the full value available on hover.
 *
 * §15 asks for ellipsis truncation with tooltips. `title` is deliberate rather
 * than a custom tooltip: it needs no portal, survives inside SVG and canvas
 * chrome, and never traps focus.
 */
export function Truncate({
  children,
  className,
  title,
}: {
  children: string;
  className?: string;
  title?: string;
}) {
  return (
    <span className={cx("block truncate", className)} title={title ?? children}>
      {children}
    </span>
  );
}

/* -------------------------------------------------------------- metadata -- */

export function Bpm({
  value,
  decimals = 0,
  className,
}: {
  value: number | null;
  decimals?: number;
  className?: string;
}) {
  if (value === null) {
    return <span className="text-ink-subtle text-xs tabular-nums">—</span>;
  }
  return (
    <span
      className={cx("text-bpm font-mono text-xs tabular-nums", className)}
      title={`${value.toFixed(1)} BPM`}
    >
      {value.toFixed(decimals)}
    </span>
  );
}

export function CamelotKey({ value, className }: { value: string | null; className?: string }) {
  if (!value) return <span className="text-ink-subtle text-xs tabular-nums">—</span>;
  return (
    <span
      className={cx("text-key font-mono text-xs tabular-nums", className)}
      title={`Camelot ${value}`}
    >
      {value}
    </span>
  );
}

/** Energy 1–5 mapped to the semantic scale — cool at the bottom, hot at the top. */
export function energyColor(level: number): string {
  const clamped = Math.max(1, Math.min(5, Math.round(level)));
  return `var(--color-energy-${clamped})`;
}

/**
 * Energy as filled dots.
 *
 * §17 forbids encoding meaning by colour alone, so the dot *count* is the
 * signal and the colour reinforces it; a screen reader gets "Energy 3 of 5".
 */
export function EnergyDots({
  value,
  max = 5,
  size = 6,
}: {
  value: number | null;
  max?: number;
  size?: number;
}) {
  const filled = value === null ? 0 : Math.max(0, Math.min(max, Math.round(value)));
  const color = filled > 0 ? energyColor(filled) : undefined;

  return (
    <span
      className="inline-flex shrink-0 items-center gap-[3px]"
      role="img"
      aria-label={value === null ? "Energy unknown" : `Energy ${filled} of ${max}`}
    >
      {Array.from({ length: max }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className="rounded-full"
          style={{
            width: size,
            height: size,
            background: index < filled ? color : "var(--color-border-strong)",
          }}
        />
      ))}
    </span>
  );
}

/* -------------------------------------------------------------- artwork -- */

const ARTWORK_PATTERNS = 5;

/**
 * Deterministic album-style artwork.
 *
 * Real artwork needs local files or a provider payload, and ADR-0007 keeps
 * Spotify images out of our storage. §5 asks for varied thumbnails rather than
 * plain gradient blocks, so this picks one of five geometric treatments from
 * the id — enough visual variety that a DJ recognises a track by its tile,
 * which is the actual job.
 */
export function Artwork({
  seed,
  size = 40,
  className,
  rounded = "card",
}: {
  seed: string;
  size?: number;
  className?: string;
  rounded?: "card" | "control";
}) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  const hue2 = (hue + 40 + (hash % 60)) % 360;
  const pattern = hash % ARTWORK_PATTERNS;

  const base = `oklch(0.52 0.15 ${hue})`;
  const accent = `oklch(0.72 0.16 ${hue2})`;
  const deep = `oklch(0.26 0.08 ${hue})`;

  return (
    <span
      aria-hidden="true"
      className={cx(
        "relative shrink-0 overflow-hidden",
        rounded === "card" ? "rounded-md" : "rounded",
        className,
      )}
      style={{ width: size, height: size, background: deep }}
    >
      <svg viewBox="0 0 40 40" width={size} height={size} className="block">
        <rect width="40" height="40" fill={deep} />
        {pattern === 0 && (
          <>
            <rect width="40" height="40" fill={base} opacity={0.9} />
            <circle cx="20" cy="20" r="11" fill="none" stroke={accent} strokeWidth="3" />
          </>
        )}
        {pattern === 1 && (
          <>
            <path d="M0 0 L40 0 L0 40 Z" fill={base} />
            <path d="M40 40 L40 8 L8 40 Z" fill={accent} opacity={0.75} />
          </>
        )}
        {pattern === 2 && (
          <>
            <rect width="40" height="40" fill={base} opacity={0.85} />
            {[8, 16, 24, 32].map((x, index) => (
              <rect
                key={x}
                x={x - 2}
                y={index % 2 === 0 ? 6 : 14}
                width="4"
                height={index % 2 === 0 ? 28 : 20}
                fill={accent}
                opacity={0.85}
              />
            ))}
          </>
        )}
        {pattern === 3 && (
          <>
            <rect width="40" height="20" fill={base} />
            <rect y="20" width="40" height="20" fill={accent} opacity={0.7} />
            <circle cx="20" cy="20" r="6" fill={deep} />
          </>
        )}
        {pattern === 4 && (
          <>
            <rect width="40" height="40" fill={base} opacity={0.8} />
            <path d="M0 30 Q10 14 20 24 T40 16 L40 40 L0 40 Z" fill={accent} opacity={0.8} />
          </>
        )}
      </svg>
    </span>
  );
}

/* ------------------------------------------------------------- waveform -- */

/**
 * Compact waveform preview.
 *
 * SVG rather than canvas: a library row is ~32 bars, and at that size the DOM
 * cost is below a canvas context per row. Coloured by the track's energy so
 * the library is scannable. Energy remains visible in the adjacent dots while
 * the shared violet treatment keeps the waveform legible on near-black cards.
 */
export function Waveform({
  trackId,
  bars = 32,
  energy: _energy = 3,
  className,
  color,
  muted = false,
}: {
  trackId: string;
  bars?: number;
  energy?: number;
  className?: string;
  color?: string;
  muted?: boolean;
}) {
  const peaks = waveformPeaks(trackId, bars);
  const fill =
    color ?? (muted ? "var(--color-waveform-muted)" : "var(--color-waveform)");

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
          fill={fill}
          opacity={muted ? 0.62 : 0.62 + peak * 0.34}
        />
      ))}
    </svg>
  );
}

/* --------------------------------------------------------------- status -- */

const SOURCE_LABEL: Record<TrackSource, string> = {
  local: "Local file available",
  streaming: "Streaming only — no local file",
  missing: "Local file missing",
};

/**
 * Local-availability indicator.
 *
 * Shape carries the meaning, not just colour (§17): a filled disc is local, a
 * ring is streaming, a slashed ring is missing.
 */
export function SourceDot({ source }: { source: TrackSource }) {
  return (
    <span
      role="img"
      aria-label={SOURCE_LABEL[source]}
      title={SOURCE_LABEL[source]}
      className={cx(
        "inline-block size-[7px] shrink-0 rounded-full border",
        source === "local" && "border-ok bg-ok",
        source === "streaming" && "border-ink-subtle bg-transparent",
        source === "missing" && "border-danger bg-danger/25",
      )}
    />
  );
}

/* --------------------------------------------------------------- layout -- */

/**
 * A workspace panel.
 *
 * `flush` drops the border and rounding for surfaces that butt directly against
 * the grid — §2 asks for fewer nested shells around the canvas, and a panel
 * inside a panel inside a rounded rectangle is exactly what made the previous
 * build read as boxed.
 */
export function Panel({
  title,
  actions,
  children,
  className,
  flush = false,
  headerId,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
  headerId?: string;
}) {
  return (
    <section
      className={cx(
        "bg-surface flex min-h-0 min-w-0 flex-col",
        !flush && "border-border rounded-panel border",
        className,
      )}
    >
      {(title || actions) && (
        <header className="border-border flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3">
          <h2 id={headerId} className="text-ink min-w-0 text-[13px] font-medium">
            {title}
          </h2>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function EmptyState({
  title,
  hint,
  icon,
  actions,
}: {
  title: string;
  // Explicitly admits undefined: under exactOptionalPropertyTypes an optional
  // property is not the same as one that may be passed as undefined.
  hint?: string | undefined;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      {icon && <div className="text-ink-subtle mb-1">{icon}</div>}
      <p className="text-ink-muted text-sm">{title}</p>
      {hint && <p className="text-ink-subtle max-w-[34ch] text-xs leading-relaxed">{hint}</p>}
      {actions && <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Loading placeholder.
 *
 * §11 requires skeletons that match final dimensions so panels do not collapse
 * and reflow when data arrives.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx("bg-surface-card animate-pulse rounded", className)}
    />
  );
}
