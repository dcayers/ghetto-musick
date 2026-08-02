/**
 * The demo workspace snapshot.
 *
 * Static, but shaped exactly like the persisted domain (§19): a `DemoTrack` is
 * the API's `TrackDto` plus the fields whose endpoints do not exist yet, and
 * `DemoTransition` carries the same `technique`/`confidence` attributes
 * `@flowgraph/domain`'s `TransitionAttributes` does. Swapping this for live
 * data is a change of source, not of shape.
 *
 * Everything is deterministic — derived from a track id — so a track looks the
 * same across the library, the canvas, the timeline, and the inspector, and
 * across reloads.
 */

import type { ScorableTrack, TransitionInput } from "@flowgraph/domain";

/* ------------------------------------------------------------------ types -- */

/** Where a metadata value came from. Manual always wins (§9). */
export type Provenance = "manual" | "serato" | "analysis" | "spotify" | "ai";

/** Whether the audio is actually reachable. Streaming entries have no file. */
export type TrackSource = "local" | "streaming" | "missing";

export type CueStatus = "imported" | "suggested" | "approved";

export interface HotCue {
  readonly id: string;
  readonly index: number;
  readonly seconds: number;
  readonly label: string;
  readonly color: string;
  readonly status: CueStatus;
}

export interface Stem {
  readonly name: string;
  readonly level: number;
  readonly available: boolean;
}

export interface DemoTrack extends ScorableTrack {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly bpm: number | null;
  readonly keySignature: string | null;
  /**
   * 1–5, matching the dot scale the whole UI renders.
   *
   * `ScorableTrack.energy` documents 1–10, and this narrowing is deliberate:
   * every energy affordance in the app is a five-dot control, so widening the
   * values would break the thing that renders them. `scoreTransition` decays
   * the energy component by `|delta| / 5`, so a 1–5 scale bottoms out at 0.2
   * instead of 0 — the component's usable range is compressed, not wrong, and
   * it carries only 0.1 of the weighted mean either way.
   */
  readonly energy: number;
  readonly genre: string;
  readonly year: number;
  readonly durationSeconds: number;
  readonly rating: number;
  readonly comment: string;
  readonly tags: readonly string[];
  readonly source: TrackSource;
  readonly hasStems: boolean;
  /** Per-field origin, so the inspector can show why a value is what it is. */
  readonly provenance: Readonly<Record<string, Provenance>>;
}

/**
 * Transition techniques.
 *
 * `family` drives colour; the label and dash pattern are the non-colour cues
 * §7 requires alongside it.
 */
export type TechniqueFamily = "blend" | "effect" | "filter" | "energy" | "cut";

export interface TechniqueSpec {
  readonly id: string;
  readonly label: string;
  readonly family: TechniqueFamily;
  /** SVG dash array, or null for a solid stroke. */
  readonly dash: string | null;
}

export const TECHNIQUES: Readonly<Record<string, TechniqueSpec>> = {
  "long-blend": { id: "long-blend", label: "Long blend", family: "blend", dash: null },
  blend: { id: "blend", label: "Blend", family: "blend", dash: null },
  "filter-sweep": { id: "filter-sweep", label: "Filter sweep", family: "filter", dash: "6 3" },
  "echo-out": { id: "echo-out", label: "Echo out", family: "effect", dash: "2 4" },
  "reverb-tail": { id: "reverb-tail", label: "Reverb tail", family: "effect", dash: "2 4" },
  "loop-build": { id: "loop-build", label: "Loop build", family: "energy", dash: "10 4" },
  "genre-flip": { id: "genre-flip", label: "Genre flip", family: "energy", dash: "10 4" },
  backspin: { id: "backspin", label: "Backspin", family: "cut", dash: "1 5" },
  cut: { id: "cut", label: "Cut", family: "cut", dash: "1 5" },
  // These two complete `transitionTechniques` from @flowgraph/contracts. Without
  // a spec here the fallback in `techniqueSpec` draws them as an anonymous solid
  // blend and the inspector's picker cannot offer them back, so a transition
  // that arrives from the API using either can be seen but never re-selected.
  "acapella-over": { id: "acapella-over", label: "Acapella over", family: "effect", dash: "2 4" },
  // `custom` is the contract's escape hatch, not a move — an even dash reads as
  // "unspecified" rather than impersonating one of the real blends above.
  custom: { id: "custom", label: "Custom", family: "blend", dash: "3 3" },
};

export const TECHNIQUE_COLOR: Readonly<Record<TechniqueFamily, string>> = {
  blend: "var(--color-tx-blend)",
  effect: "var(--color-tx-effect)",
  filter: "var(--color-tx-filter)",
  energy: "var(--color-tx-energy)",
  cut: "var(--color-tx-cut)",
};

export function techniqueSpec(id: string): TechniqueSpec {
  return TECHNIQUES[id] ?? { id, label: id, family: "blend", dash: null };
}

export interface DemoTransition extends TransitionInput {
  readonly id: string;
  readonly sourceTrackId: string;
  readonly targetTrackId: string;
  readonly technique: string;
  readonly confidence: number;
  /** Mix length, in bars — the unit DJs actually plan in. */
  readonly bars: number;
  readonly mixOutCueId: string | null;
  readonly mixInCueId: string | null;
  readonly notes: string;
  readonly origin: "manual" | "ai";
  readonly provenance: Provenance;
  readonly warnings: readonly string[];
  readonly fx: readonly string[];
}

export interface DemoGraphNode {
  readonly id: string;
  readonly trackId: string;
  readonly x: number;
  readonly y: number;
}

export interface DemoSet {
  readonly id: string;
  readonly name: string;
  /** Ordered. Adjacent pairs are looked up against `transitions`. */
  readonly trackIds: readonly string[];
  /**
   * The set's working tempo and key — what the top navigation reads out.
   *
   * Declared, not averaged. A set is *planned around* a tempo; averaging the
   * members would drift every time one is swapped, and averaging positions on
   * the Camelot wheel is meaningless (12A and 1A average to 6.5A, which is
   * across the wheel from both).
   */
  readonly targetBpm: number;
  readonly targetKey: string;
}

/* ------------------------------------------------------------- generators -- */

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
 * Shaped like a DJ track rather than noise — quiet intro, build, sustained
 * body, outro — so the preview reads as music instead of static. Real peaks
 * need a local file, which most streaming entries do not have.
 */
export function waveformPeaks(trackId: string, samples = 64): number[] {
  const random = rng(hash(trackId));
  return Array.from({ length: samples }, (_, index) => {
    const progress = index / Math.max(1, samples - 1);
    const envelope =
      progress < 0.12
        ? progress / 0.12
        : progress > 0.86
          ? Math.max(0.15, (1 - progress) / 0.14)
          : 0.75 + Math.sin(progress * Math.PI * 3) * 0.2;
    return Math.min(1, Math.max(0.06, envelope * (0.55 + random() * 0.55)));
  });
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  // A set runs past an hour; "78:12" is not a duration anyone reads correctly.
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

const CUE_COLORS = ["#34d399", "#fbbf24", "#fb7185", "#22d3ee", "#a78bfa"] as const;
const CUE_LABELS = ["Intro", "Breakdown", "Drop", "Outro"] as const;

export function hotCuesFor(track: DemoTrack): HotCue[] {
  const random = rng(hash(`${track.id}-cues`));
  return CUE_LABELS.map((label, index) => ({
    id: `${track.id}-cue-${index}`,
    index: index + 1,
    seconds: Math.round(track.durationSeconds * (0.06 + index * 0.27 + random() * 0.03)),
    label,
    color: CUE_COLORS[index % CUE_COLORS.length]!,
    // A mixture, so the inspector's imported/suggested/approved distinction
    // has something to actually distinguish.
    status: index === 2 ? "suggested" : index === 0 ? "approved" : "imported",
  }));
}

export function stemsFor(track: DemoTrack): Stem[] {
  const random = rng(hash(`${track.id}-stems`));
  return ["Vocal", "Drums", "Bass", "Melody"].map((name) => ({
    name,
    level: Math.round((0.55 + random() * 0.4) * 100) / 100,
    available: track.hasStems,
  }));
}

/* ------------------------------------------------------------ the dataset -- */

interface Seed {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  keySignature: string;
  energy: number;
  genre: string;
  year: number;
  duration: number;
  source: TrackSource;
  hasStems: boolean;
  comment: string;
  tags: string[];
}

/**
 * The eight tracks the graph is built from (§6).
 *
 * BPM and key are chosen so the authored paths survive the domain's own
 * `harmonicRelation`, which is what the inspector scores against: the main
 * path walks 6A → 7A → 8A → 9A → 9A → 10A, one step round the Camelot wheel
 * at a time. The deep branch sits at 7A beside Afterglow and rejoins at
 * Innerbloom's 8A. Only the peak branch through Opus (9A → 11A) is a distant
 * move, and it is the one transition that carries a key warning.
 */
const FEATURED: Seed[] = [
  {
    id: "trk-awake",
    title: "Awake",
    artist: "Solomun",
    bpm: 124,
    keySignature: "6A",
    energy: 2,
    genre: "Melodic House",
    year: 2019,
    duration: 508,
    source: "local",
    hasStems: true,
    comment: "Long intro — easy first mix. Hold the low end back until the kick lands.",
    tags: ["opener", "warmup"],
  },
  {
    id: "trk-afterglow",
    title: "Afterglow",
    artist: "Lane 8",
    bpm: 123,
    keySignature: "7A",
    energy: 3,
    genre: "Progressive House",
    year: 2021,
    duration: 462,
    source: "local",
    hasStems: true,
    comment: "Vocal sits high; duck the mids going in.",
    tags: ["vocal", "sunset"],
  },
  {
    id: "trk-innerbloom",
    title: "Innerbloom",
    artist: "RÜFÜS DU SOL",
    bpm: 122,
    keySignature: "8A",
    energy: 3,
    genre: "Melodic House",
    year: 2016,
    duration: 587,
    source: "local",
    hasStems: true,
    comment: "The centrepiece. Nine minutes — do not rush the exit.",
    tags: ["peak", "vocal", "signature"],
  },
  {
    id: "trk-night-drive",
    title: "Night Drive",
    artist: "Kölsch",
    bpm: 124,
    keySignature: "9A",
    energy: 4,
    genre: "Techno",
    year: 2018,
    duration: 441,
    source: "local",
    hasStems: false,
    comment: "Drives hard from the first bar. Good pivot into the back half.",
    tags: ["driving"],
  },
  {
    id: "trk-glue",
    title: "Glue",
    artist: "Bicep",
    bpm: 124,
    keySignature: "9A",
    energy: 4,
    genre: "Breakbeat",
    year: 2017,
    duration: 398,
    source: "local",
    hasStems: true,
    comment: "Breaks under a house set — the switch always lands.",
    tags: ["breaks", "peak"],
  },
  {
    id: "trk-losing-it",
    title: "Losing It",
    artist: "FISHER",
    bpm: 126,
    keySignature: "10A",
    energy: 5,
    genre: "Tech House",
    year: 2018,
    duration: 372,
    source: "local",
    hasStems: false,
    comment: "Closer. Everyone knows it — do not overplay the intro.",
    tags: ["closer", "peak"],
  },
  {
    id: "trk-the-less-i-know",
    title: "The Less I Know",
    artist: "TINLICKER",
    bpm: 121,
    keySignature: "7A",
    energy: 2,
    genre: "Melodic House",
    year: 2020,
    duration: 431,
    source: "streaming",
    hasStems: false,
    comment: "Deeper alternative if the room is not ready to lift yet.",
    tags: ["deep", "alternate"],
  },
  {
    id: "trk-opus",
    title: "Opus",
    artist: "Eric Prydz",
    bpm: 127,
    keySignature: "11A",
    energy: 5,
    genre: "Progressive House",
    year: 2015,
    duration: 546,
    source: "missing",
    hasStems: false,
    comment: "Peak-energy branch. File is not on this machine.",
    tags: ["peak", "alternate", "classic"],
  },
];

const FILLER_ARTISTS = [
  "Ben Böhmer",
  "Yotto",
  "Nora En Pure",
  "Jan Blomqvist",
  "Tale Of Us",
  "Adriatique",
  "Massano",
  "Anyma",
  "Mind Against",
  "Agents Of Time",
  "Stephan Bodzin",
  "Rodriguez Jr.",
];

const FILLER_TITLES = [
  "Beyond Beliefs",
  "Radiate",
  "Tempted",
  "Drifting",
  "Paralyzed",
  "Distant Shores",
  "Nightfall",
  "Slow Burn",
  "Undertow",
  "Static Bloom",
  "Hollow Coast",
  "Reverie",
  "Northbound",
  "Long Shadow",
  "Halcyon",
  "Weightless",
];

const GENRES = [
  "Melodic House",
  "Progressive House",
  "Afro House",
  "Deep House",
  "Techno",
  "Organic House",
  "Tech House",
];

/** §5 shows "126 tracks"; the eight featured plus generated filler. */
const TOTAL_TRACKS = 126;

function buildTrack(seed: Seed): DemoTrack {
  return {
    id: seed.id,
    title: seed.title,
    artist: seed.artist,
    bpm: seed.bpm,
    keySignature: seed.keySignature,
    energy: seed.energy,
    genre: seed.genre,
    year: seed.year,
    durationSeconds: seed.duration,
    rating: 3 + (hash(`${seed.id}-rating`) % 3),
    comment: seed.comment,
    tags: seed.tags,
    source: seed.source,
    hasStems: seed.hasStems,
    provenance: {
      // A believable mixture: the DJ typed the comment, Serato holds the
      // library metadata, the analyser derived tempo and key.
      bpm: "analysis",
      keySignature: "analysis",
      genre: "serato",
      year: "spotify",
      energy: "ai",
      comment: "manual",
      rating: "manual",
      tags: "manual",
    },
  };
}

function buildFiller(index: number): DemoTrack {
  const id = `trk-fill-${index}`;
  const random = rng(hash(id));
  const bpm = 118 + Math.floor(random() * 12);
  const keyNumber = 1 + Math.floor(random() * 12);
  const mode = random() > 0.35 ? "A" : "B";
  const energy = 1 + Math.floor(random() * 5);
  const local = random() > 0.28;

  return {
    id,
    title: FILLER_TITLES[index % FILLER_TITLES.length]!,
    artist: FILLER_ARTISTS[(index * 7) % FILLER_ARTISTS.length]!,
    bpm,
    keySignature: `${keyNumber}${mode}`,
    energy,
    genre: GENRES[index % GENRES.length]!,
    year: 2014 + Math.floor(random() * 12),
    durationSeconds: 330 + Math.floor(random() * 200),
    rating: 2 + Math.floor(random() * 4),
    comment: "",
    tags: [],
    source: local ? "local" : "streaming",
    hasStems: random() > 0.7,
    provenance: {
      bpm: "analysis",
      keySignature: "analysis",
      genre: "serato",
      year: "serato",
      energy: "ai",
    },
  };
}

export const TRACKS: readonly DemoTrack[] = [
  ...FEATURED.map(buildTrack),
  ...Array.from({ length: TOTAL_TRACKS - FEATURED.length }, (_, index) => buildFiller(index)),
];

const BY_ID = new Map(TRACKS.map((track) => [track.id, track]));

export function trackById(id: string | null | undefined): DemoTrack | null {
  return id ? (BY_ID.get(id) ?? null) : null;
}

/**
 * Node positions.
 *
 * Hand-placed, not auto-laid-out. §6 asks for an intentional cluster with
 * visible alternative routes — a force layout or a grid would produce exactly
 * the evenly-distributed diagram it warns against. The main path runs left to
 * right along the middle; the two branches bow above and below it.
 */
export const NODES: readonly DemoGraphNode[] = [
  { id: "node-awake", trackId: "trk-awake", x: 0, y: 200 },
  { id: "node-afterglow", trackId: "trk-afterglow", x: 285, y: -20 },
  { id: "node-the-less-i-know", trackId: "trk-the-less-i-know", x: 265, y: 430 },
  { id: "node-innerbloom", trackId: "trk-innerbloom", x: 570, y: 200 },
  { id: "node-night-drive", trackId: "trk-night-drive", x: 855, y: -10 },
  { id: "node-opus", trackId: "trk-opus", x: 1105, y: -240 },
  { id: "node-glue", trackId: "trk-glue", x: 1120, y: 430 },
  { id: "node-losing-it", trackId: "trk-losing-it", x: 1390, y: 190 },
];

/**
 * Authored transitions.
 *
 * Five form the active set path; four are alternatives. Afterglow and Night
 * Drive are the two branch points §6 requires, and both branches rejoin — the
 * deep route through The Less I Know rejoins at Innerbloom, the peak route
 * through Opus rejoins at Losing It.
 *
 * Each `confidence` is the `scoreTransition` overall for its pair, rounded to
 * two places, and each `warnings` entry states something the tracks' own BPM,
 * key, energy, and source actually support. The inspector recomputes the score
 * live from the tracks, so authored metadata that disagrees with the domain
 * shows up on screen as the transition contradicting itself.
 */
export const TRANSITIONS: readonly DemoTransition[] = [
  {
    id: "tx-awake-afterglow",
    sourceTrackId: "trk-awake",
    targetTrackId: "trk-afterglow",
    technique: "long-blend",
    confidence: 0.81,
    bars: 32,
    mixOutCueId: "trk-awake-cue-3",
    mixInCueId: "trk-afterglow-cue-0",
    // 6A → 7A is adjacent, not identical — the old note claimed "the same
    // pocket", which the wheel does not support.
    notes: "Ride the blend long — 6A into 7A is one step round the wheel.",
    origin: "manual",
    provenance: "manual",
    warnings: [],
    fx: ["High-pass out", "Low-pass in"],
  },
  {
    id: "tx-afterglow-innerbloom",
    sourceTrackId: "trk-afterglow",
    targetTrackId: "trk-innerbloom",
    technique: "filter-sweep",
    confidence: 0.86,
    bars: 16,
    mixOutCueId: "trk-afterglow-cue-3",
    mixInCueId: "trk-innerbloom-cue-0",
    notes: "Sweep the filter across the breakdown, drop on the one.",
    origin: "manual",
    provenance: "manual",
    warnings: [],
    fx: ["Filter sweep"],
  },
  {
    id: "tx-innerbloom-night-drive",
    sourceTrackId: "trk-innerbloom",
    targetTrackId: "trk-night-drive",
    technique: "echo-out",
    confidence: 0.79,
    bars: 8,
    mixOutCueId: "trk-innerbloom-cue-3",
    mixInCueId: "trk-night-drive-cue-0",
    notes: "Echo the vocal tail out; Night Drive starts hard so keep it short.",
    origin: "manual",
    provenance: "manual",
    warnings: ["Energy jump of 1 step"],
    fx: ["Echo", "Reverb tail"],
  },
  {
    id: "tx-night-drive-glue",
    sourceTrackId: "trk-night-drive",
    targetTrackId: "trk-glue",
    technique: "loop-build",
    confidence: 0.9,
    bars: 16,
    mixOutCueId: "trk-night-drive-cue-2",
    mixInCueId: "trk-glue-cue-1",
    notes: "Loop the last 4 bars twice, then let the breaks take over.",
    origin: "manual",
    provenance: "manual",
    // Both tracks are 9A at 124 BPM with the same energy — identical key, zero
    // tempo move. There is nothing here to warn about.
    warnings: [],
    fx: ["4-bar loop"],
  },
  {
    id: "tx-glue-losing-it",
    sourceTrackId: "trk-glue",
    targetTrackId: "trk-losing-it",
    technique: "genre-flip",
    confidence: 0.82,
    bars: 8,
    mixOutCueId: "trk-glue-cue-3",
    mixInCueId: "trk-losing-it-cue-2",
    notes: "Breaks into tech house — cut on the drop, do not blend.",
    origin: "manual",
    provenance: "manual",
    warnings: ["+2 BPM", "Energy jump of 1 step"],
    fx: [],
  },

  /* Alternatives ------------------------------------------------------- */
  {
    id: "tx-afterglow-the-less-i-know",
    sourceTrackId: "trk-afterglow",
    targetTrackId: "trk-the-less-i-know",
    technique: "reverb-tail",
    confidence: 0.83,
    bars: 32,
    // 7A → 7A at −2 BPM: identical key, well inside pitch tolerance.
    mixOutCueId: "trk-afterglow-cue-1",
    mixInCueId: "trk-the-less-i-know-cue-0",
    notes: "Keep it deep — use this if the floor has not filled yet.",
    origin: "manual",
    provenance: "manual",
    warnings: [],
    fx: ["Reverb tail"],
  },
  {
    id: "tx-the-less-i-know-innerbloom",
    sourceTrackId: "trk-the-less-i-know",
    targetTrackId: "trk-innerbloom",
    technique: "long-blend",
    confidence: 0.81,
    bars: 32,
    mixOutCueId: "trk-the-less-i-know-cue-3",
    mixInCueId: "trk-innerbloom-cue-0",
    // 7A → 8A is adjacent; the old note claimed "same key", which it is not.
    notes: "Rejoins the main path. 7A into 8A, so blend as long as you like.",
    origin: "manual",
    provenance: "manual",
    warnings: [],
    fx: [],
  },
  {
    id: "tx-night-drive-opus",
    sourceTrackId: "trk-night-drive",
    targetTrackId: "trk-opus",
    technique: "backspin",
    confidence: 0.56,
    bars: 4,
    mixOutCueId: "trk-night-drive-cue-3",
    mixInCueId: "trk-opus-cue-2",
    notes: "Hard cut into the peak route. Risky — only if the room is with you.",
    origin: "ai",
    provenance: "ai",
    // The one genuinely distant move in the file: 9A → 11A is two steps, which
    // `harmonicRelation` classifies as `distant`. The warning names the real
    // keys so it stays checkable against the tracks.
    warnings: ["Local file missing", "+3 BPM", "9A → 11A is a distant key"],
    fx: [],
  },
  {
    id: "tx-opus-losing-it",
    sourceTrackId: "trk-opus",
    targetTrackId: "trk-losing-it",
    technique: "filter-sweep",
    confidence: 0.86,
    bars: 16,
    mixOutCueId: "trk-opus-cue-3",
    mixInCueId: "trk-losing-it-cue-0",
    notes: "Rejoins the closer from the peak branch.",
    origin: "ai",
    provenance: "ai",
    // 11A → 10A at −1 BPM scores well; the only real problem is the file, which
    // scoring cannot see.
    warnings: ["Local file missing"],
    fx: ["Filter sweep"],
  },
];

/** The active set — six tracks, §4 and §12. */
export const ACTIVE_SET: DemoSet = {
  id: "set-sunset-rooftop",
  name: "Sunset Rooftop Set",
  trackIds: [
    "trk-awake",
    "trk-afterglow",
    "trk-innerbloom",
    "trk-night-drive",
    "trk-glue",
    "trk-losing-it",
  ],
  targetBpm: 124,
  targetKey: "8A",
};

/* --------------------------------------------------------------- derived -- */

/** Transition ids that lie on the active set path, in set order. */
export function activeSetTransitionIds(
  set: DemoSet,
  transitions: readonly DemoTransition[],
): string[] {
  const ids: string[] = [];
  for (let i = 0; i < set.trackIds.length - 1; i += 1) {
    const from = set.trackIds[i];
    const to = set.trackIds[i + 1];
    const match = transitions.find(
      (tx) => tx.sourceTrackId === from && tx.targetTrackId === to,
    );
    if (match) ids.push(match.id);
  }
  return ids;
}

/**
 * The transition between two adjacent set tracks, or null.
 *
 * Null is a real state the timeline renders as "add transition" (§12) — a
 * reordered set can put two tracks side by side that were never linked.
 */
export function transitionBetween(
  transitions: readonly DemoTransition[],
  fromTrackId: string,
  toTrackId: string,
): DemoTransition | null {
  return (
    transitions.find(
      (tx) => tx.sourceTrackId === fromTrackId && tx.targetTrackId === toTrackId,
    ) ?? null
  );
}

/** Total runtime of the set, minus overlap from each authored mix. */
export function setDuration(
  set: DemoSet,
  tracks: readonly DemoTrack[],
  transitions: readonly DemoTransition[],
): number {
  const byId = new Map(tracks.map((track) => [track.id, track]));
  let total = 0;
  for (const id of set.trackIds) total += byId.get(id)?.durationSeconds ?? 0;

  // Each mix overlaps two tracks, so the set is shorter than the sum. At 124
  // BPM a bar is ~1.94s; close enough for a planning estimate.
  for (const id of activeSetTransitionIds(set, transitions)) {
    const tx = transitions.find((entry) => entry.id === id);
    if (tx) total -= tx.bars * 1.94;
  }
  return Math.max(0, Math.round(total));
}

/** BPM delta across a transition, in whole BPM. */
export function bpmDelta(
  transitions: readonly DemoTransition[],
  transitionId: string,
): number | null {
  const tx = transitions.find((entry) => entry.id === transitionId);
  if (!tx) return null;
  const from = trackById(tx.sourceTrackId);
  const to = trackById(tx.targetTrackId);
  if (from?.bpm == null || to?.bpm == null) return null;
  return Math.round((to.bpm - from.bpm) * 10) / 10;
}
