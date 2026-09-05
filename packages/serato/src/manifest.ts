import type { SeratoTrackEntry } from "./library.js";

/**
 * Serato entries to a normalized import manifest — plan §12.3 S1.
 *
 * Pure: no filesystem, no database, no clock. Everything here is "what does
 * this Serato field mean", which is knowledge that belongs with the parser
 * rather than with whatever happens to be storing the result.
 *
 * This is also the shape a desktop bridge would send (ADR-0006). Keeping the
 * normalization on this side of the boundary means the bridge stays a
 * transport: it reads bytes and posts manifests, and the interpretation of
 * `tbpm` or `pfil` does not fork into two implementations that drift.
 */

/**
 * Where a Serato entry's audio lives.
 *
 * `streaming` is a first-class state, not a degenerate one — five of six
 * entries in the ADR-0010 corpus were streaming. Serato still stores tempo,
 * key, and length for them, which is what makes them worth importing.
 *
 * ADR-0010 recorded that a streaming entry has *no* `pfil` record. Re-reading
 * the same library while building this module showed otherwise: it has one,
 * holding a provider identity rather than a path —
 * `56GaYWGPrKJt6e6SGKKiUD.spotify`. Believing the path over the type label
 * therefore resolves a Spotify id against the filesystem, finds nothing, and
 * reports five of six tracks as missing files. `ttyp` is the signal.
 */
export type SeratoAudioLocation = "file" | "streaming";

export interface SeratoTrackManifest {
  /**
   * Path as Serato stores it — volume-relative, no leading separator.
   *
   * Null for a streaming entry. Resolving it against a volume root is the
   * caller's job, because only the caller knows which device it is on.
   */
  readonly filePath: string | null;
  readonly location: SeratoAudioLocation;
  /** Container as Serato labels it: "mp3", "aiff", "streaming". */
  readonly fileType: string | null;
  readonly title: string;
  readonly artist: string;
  readonly album: string | null;
  readonly genre: string | null;
  readonly bpm: number | null;
  /** As stored. Serato writes Camelot ("8A") or classical ("Am") depending on setup. */
  readonly key: string | null;
  readonly durationSeconds: number | null;
  /** Streaming provider, from the `pfil` extension — currently only "spotify". */
  readonly streamingProvider: string | null;
  /**
   * The provider's own id for the track.
   *
   * Exact, unlike a title, which is what makes re-importing a streaming
   * library idempotent rather than approximately idempotent.
   */
  readonly streamingId: string | null;
}

/**
 * Providers whose ids Serato stores in the `pfil` slot.
 *
 * A closed list: an unrecognised extension is treated as a real path, because
 * guessing that an unknown suffix means "not a file" would silently drop local
 * audio from the import.
 */
const STREAMING_EXTENSIONS: Readonly<Record<string, string>> = {
  spotify: "spotify",
};

/** True when Serato labelled the entry as having no local audio. */
function isStreamingType(fileType: string | null): boolean {
  return fileType !== null && fileType.toLowerCase() === "streaming";
}

function parseStreamingRef(raw: string | null): { provider: string; id: string } | null {
  if (raw === null) return null;
  // Anchored and separator-free: a real file called "mix.spotify" inside a
  // folder still has a separator, so only a bare `<id>.<provider>` matches.
  const match = /^([^/\\]+)\.([A-Za-z0-9]+)$/.exec(raw);
  const id = match?.[1];
  const extension = match?.[2]?.toLowerCase();
  const provider = extension === undefined ? undefined : STREAMING_EXTENSIONS[extension];
  return provider !== undefined && id !== undefined && id !== "" ? { provider, id } : null;
}

const trimmed = (value: string | undefined): string | null => {
  const text = value?.trim();
  return text === undefined || text === "" ? null : text;
};

/**
 * Parses Serato's tempo string.
 *
 * Stored as text rather than a number, and absent or "0" for an unanalysed
 * track. Zero is rejected rather than stored: a track does not have a tempo of
 * zero, and a zero would sort and filter as though it were measured.
 */
export function parseBpm(value: string | undefined): number | null {
  const text = trimmed(value);
  if (text === null) return null;
  const bpm = Number.parseFloat(text);
  if (!Number.isFinite(bpm) || bpm <= 0) return null;
  // Two decimals is what Serato displays and more than the domain compares on.
  return Math.round(bpm * 100) / 100;
}

/**
 * Parses Serato's running-time string.
 *
 * Written for display — `"5:08.00"`, `"1:02:33"`, occasionally just seconds —
 * so it is parsed by shape rather than by a single format. Anything that does
 * not resolve to a positive number of seconds becomes null, because a
 * zero-length track would make a set's total duration quietly wrong.
 */
export function parseDurationSeconds(value: string | undefined): number | null {
  const text = trimmed(value);
  if (text === null) return null;

  const parts = text.split(":");
  if (parts.length > 3) return null;

  let seconds = 0;
  for (const part of parts) {
    const unit = Number.parseFloat(part);
    if (!Number.isFinite(unit) || unit < 0) return null;
    seconds = seconds * 60 + unit;
  }

  const rounded = Math.round(seconds);
  return rounded > 0 ? rounded : null;
}

/**
 * Serato's stored path to a volume-relative one.
 *
 * Entries are stored without a leading separator and relative to the volume
 * the file sits on, which is why this never returns an absolute path — doing
 * so would silently assume the boot volume.
 */
export function normalizeSeratoPath(value: string | undefined): string | null {
  const text = trimmed(value);
  if (text === null) return null;
  return text.replace(/^\/+/, "");
}

/**
 * A title for an entry that has none.
 *
 * Serato omits `tsng` on some entries. Falling back to the filename keeps the
 * track identifiable in a list instead of rendering a blank row; a manifest
 * with no title at all would be worse than a filename.
 */
function fallbackTitle(filePath: string | null): string {
  if (filePath === null) return "Untitled";
  const base = filePath.split("/").pop() ?? filePath;
  const withoutExtension = base.replace(/\.[^.]+$/, "");
  return withoutExtension === "" ? "Untitled" : withoutExtension;
}

/**
 * One Serato entry as an import manifest.
 *
 * Never throws and never returns null: every entry in a real library is worth
 * importing, including the streaming ones. Missing fields become null, which
 * the UI already renders as an em dash — inventing a value for an unanalysed
 * track would put a number in front of the user that Serato never measured.
 */
export function toManifest(entry: SeratoTrackEntry): SeratoTrackManifest {
  const rawPath = normalizeSeratoPath(entry.filePath);
  const fileType = trimmed(entry.fileType);

  // `ttyp` decides, with the `pfil` extension as corroboration. The reverse —
  // trusting the path — reads a Spotify id as a filename and reports the
  // track as a missing file.
  // Three ways an entry has no local audio: Serato says so, the path slot
  // holds a provider id, or there is no path slot at all. The last is what
  // ADR-0010 originally described and is still possible.
  const streamingRef = parseStreamingRef(rawPath);
  const streaming = isStreamingType(fileType) || streamingRef !== null || rawPath === null;

  return {
    filePath: streaming ? null : rawPath,
    location: streaming ? "streaming" : "file",
    fileType,
    streamingProvider: streamingRef?.provider ?? null,
    streamingId: streamingRef?.id ?? null,
    title: trimmed(entry.title) ?? fallbackTitle(rawPath),
    artist: trimmed(entry.artist) ?? "Unknown artist",
    album: trimmed(entry.album),
    genre: trimmed(entry.genre),
    bpm: parseBpm(entry.bpm),
    key: trimmed(entry.key),
    durationSeconds: parseDurationSeconds(entry.length),
  };
}

export function toManifests(
  entries: readonly SeratoTrackEntry[],
): SeratoTrackManifest[] {
  return entries.map(toManifest);
}
