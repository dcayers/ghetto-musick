/**
 * ⚠️ DEMO DATA — no API behind any of this yet.
 *
 * The UI is being built ahead of the endpoints so the shape can be reviewed
 * before it is committed to. Everything here is deterministic (derived from a
 * track id) so the same track always looks the same across reloads and across
 * the library, canvas, timeline, and inspector.
 *
 * **Every consumer must render a `demo` affordance.** The point of building
 * UI first is to evaluate the design, and that only works if it is obvious
 * which numbers are real. `isDemo` is exported so components can mark
 * themselves without each inventing its own convention.
 *
 * Replace piecemeal as endpoints land — see the table in README.
 */

export const isDemo = true;

/** Deterministic 32-bit hash; the seed for every generated value below. */
function hash(seed: string): number {
  let value = 0;
  for (let i = 0; i < seed.length; i += 1) {
    value = (value * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return value;
}

/** Mulberry32 — small, fast, deterministic. */
function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Waveform peaks, 0–1.
 *
 * Real peaks come from the desktop bridge (plan §15.2) and only exist for
 * local files — the S0 scan found most library entries are streaming. Shaped
 * like a DJ track rather than noise: quiet intro, build, sustained body,
 * outro, so the visual reads as music instead of static.
 */
export function waveformPeaks(trackId: string, samples = 64): number[] {
  const random = rng(hash(trackId));
  return Array.from({ length: samples }, (_, index) => {
    const progress = index / (samples - 1);
    // Envelope: rises over the first third, holds, falls over the last fifth.
    const envelope =
      progress < 0.12
        ? progress / 0.12
        : progress > 0.86
          ? Math.max(0.15, (1 - progress) / 0.14)
          : 0.75 + Math.sin(progress * Math.PI * 3) * 0.2;
    return Math.min(1, Math.max(0.06, envelope * (0.55 + random() * 0.55)));
  });
}

export function energyFor(trackId: string): number {
  return 1 + (hash(trackId) % 5);
}

export function ratingFor(trackId: string): number {
  return 3 + (hash(`${trackId}-rating`) % 3);
}

const GENRES = [
  "Melodic House",
  "Progressive House",
  "Afro House",
  "Deep House",
  "Techno",
  "Organic House",
];

export function genreFor(trackId: string): string {
  return GENRES[hash(`${trackId}-genre`) % GENRES.length]!;
}

export function yearFor(trackId: string): number {
  return 2014 + (hash(`${trackId}-year`) % 12);
}

/** Duration in seconds — 5:30 to 8:30, typical for the genre. */
export function durationFor(trackId: string): number {
  return 330 + (hash(`${trackId}-dur`) % 180);
}

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export const CUE_COLORS = ["#34d399", "#fbbf24", "#f87171", "#22d3ee", "#a78bfa"] as const;

export interface HotCue {
  index: number;
  seconds: number;
  label: string;
  color: string;
}

/**
 * Hot cues.
 *
 * Real ones live in GEOB tags inside the audio file (ADR-0010), readable only
 * for local files and only after Phase 4's bridge lands.
 */
export function hotCuesFor(trackId: string): HotCue[] {
  const duration = durationFor(trackId);
  const random = rng(hash(`${trackId}-cues`));
  const labels = ["Intro", "Breakdown", "Drop", "Outro"];

  return labels.map((label, index) => ({
    index: index + 1,
    seconds: Math.round(duration * (0.08 + index * 0.26 + random() * 0.04)),
    label,
    color: CUE_COLORS[index % CUE_COLORS.length]!,
  }));
}

export interface Stem {
  name: string;
  level: number;
  solo: boolean;
  mute: boolean;
}

/** Stems are out of MVP scope (plan §3.4) — shown to evaluate the layout. */
export function stemsFor(trackId: string): Stem[] {
  const random = rng(hash(`${trackId}-stems`));
  return ["Vocal", "Drums", "Bass", "Melody"].map((name) => ({
    name,
    level: 0.55 + random() * 0.4,
    solo: false,
    mute: false,
  }));
}

export function commentFor(trackId: string): string {
  const comments = [
    "Sunset vibe starter.",
    "Big room moment — save for peak.",
    "Long intro, easy to mix into.",
    "Vocal sits high; duck the mids.",
    "Great bridge out of 124.",
  ];
  return comments[hash(`${trackId}-comment`) % comments.length]!;
}
