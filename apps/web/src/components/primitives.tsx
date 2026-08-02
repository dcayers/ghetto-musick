import type { ReactNode } from "react";

/**
 * Display primitives for musical metadata.
 *
 * BPM, key, and energy appear in the library, on graph nodes, in the timeline,
 * and in the inspector. Defining them once keeps those four surfaces
 * consistent and means a change to how a Camelot key reads happens in one
 * place.
 */

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function Bpm({ value }: { value: number | null }) {
  if (value === null) return <span className="text-ink-subtle text-xs">—</span>;
  return (
    <span className="text-bpm font-mono text-xs tabular-nums" title={`${value} BPM`}>
      {value.toFixed(0)}
    </span>
  );
}

export function CamelotKey({ value }: { value: string | null }) {
  if (!value) return <span className="text-ink-subtle text-xs">—</span>;
  return (
    <span className="text-key font-mono text-xs" title={`Camelot ${value}`}>
      {value}
    </span>
  );
}

/**
 * Energy as filled dots.
 *
 * Plan §9.6 forbids encoding meaning by colour alone, so this carries an
 * accessible label and the dot count is itself the signal — a screen reader
 * gets "Energy 3 of 5" rather than a colour name.
 */
export function EnergyDots({ value, max = 5 }: { value: number | null; max?: number }) {
  const filled = value === null ? 0 : Math.max(0, Math.min(max, Math.round(value)));

  return (
    <span
      className="inline-flex items-center gap-[3px]"
      role="img"
      aria-label={value === null ? "Energy unknown" : `Energy ${filled} of ${max}`}
    >
      {Array.from({ length: max }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={cx(
            "size-[6px] rounded-full",
            index < filled ? "bg-energy" : "bg-border-strong",
          )}
        />
      ))}
    </span>
  );
}

/**
 * Deterministic placeholder artwork.
 *
 * Real artwork needs either local files or a provider payload; the S0 scan
 * found most library entries are streaming, and ADR-0007 keeps Spotify
 * artwork out of our storage. A hash-derived gradient at least makes tracks
 * visually distinguishable on the canvas, which is the actual job here.
 */
export function Artwork({ seed, size = 36 }: { seed: string; size?: number }) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;

  return (
    <span
      aria-hidden="true"
      className="shrink-0 rounded"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, oklch(0.55 0.14 ${hue}), oklch(0.35 0.1 ${(hue + 48) % 360}))`,
      }}
    />
  );
}

export function Panel({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        "border-border bg-surface flex min-h-0 flex-col rounded-xl border",
        className,
      )}
    >
      {(title || actions) && (
        <header className="border-border flex shrink-0 items-center justify-between border-b px-3 py-2">
          <h2 className="text-ink text-sm font-medium">{title}</h2>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  // Explicitly admits undefined: under exactOptionalPropertyTypes an optional
  // property is not the same as one that may be passed as undefined.
  hint?: string | undefined;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
      <p className="text-ink-muted text-sm">{title}</p>
      {hint && <p className="text-ink-subtle text-xs">{hint}</p>}
    </div>
  );
}
