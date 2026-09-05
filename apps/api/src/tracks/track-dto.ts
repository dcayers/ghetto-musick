import type { Track } from "@flowgraph/db";
import type { TrackDto, TrackSource } from "@flowgraph/contracts";

/**
 * The one place a `Track` row becomes a `TrackDto`.
 *
 * There were three copies of this — one per service — and adding a field meant
 * finding all of them. The next field added to the schema is one edit here.
 */

/**
 * A track with enough of its file relation to answer "is the audio there".
 *
 * `localFile` is optional rather than required so a caller that has not
 * included the relation still typechecks; it is treated as "not included" and
 * the source falls back to what the track row alone can say.
 */
export type TrackWithFile = Track & {
  localFile?: { missing: boolean } | null;
};

/**
 * Where a track's audio lives.
 *
 * Null is a real answer: a track typed in by hand has neither a file nor a
 * provider, and calling that "streaming" would assert a service it never came
 * from. The inspector renders null as "No file record".
 */
export function trackSource(track: TrackWithFile): TrackSource | null {
  if (track.localFile != null) return track.localFile.missing ? "missing" : "local";
  // No file, but a provider id — a Serato streaming entry (ADR-0010).
  if (track.sourceProvider !== null) return "streaming";
  return null;
}

/**
 * Prisma `Decimal` does not survive JSON serialization as a number, so `bpm`
 * is widened on the way out.
 */
export function toTrackDto(track: TrackWithFile): TrackDto {
  return {
    id: track.id,
    workspaceId: track.workspaceId,
    title: track.title,
    artist: track.artist,
    bpm: track.bpm === null ? null : Number(track.bpm),
    keySignature: track.keySignature,
    timeSignature: track.timeSignature,
    album: track.album,
    genre: track.genre,
    durationSeconds: track.durationSeconds,
    source: trackSource(track),
    tags: track.tags,
    version: track.version,
    createdAt: track.createdAt.toISOString(),
    updatedAt: track.updatedAt.toISOString(),
  };
}

/** Include clause every read needs for `source` to be accurate. */
export const TRACK_FILE_INCLUDE = { localFile: { select: { missing: true } } } as const;
