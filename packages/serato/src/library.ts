import { parseRecords, findText, type SeratoRecord } from "./tlv.js";

/**
 * Serato library and crate parsing — ADR-0010, phase S1.
 *
 * `database V2` and `Subcrates/*.crate` share the same TLV envelope; they
 * differ only in which tags appear. Both are parsed here, from bytes only.
 *
 * Scope is deliberately read-only. ADR-0010 permits writing *new* `.crate`
 * files (phase S2) and defers cue writing indefinitely, so nothing in this
 * package opens a file for writing.
 */

export interface SeratoTrackEntry {
  /** Path relative to the volume root, as stored. */
  readonly filePath: string | undefined;
  /** Container format, e.g. "mp3", "aiff". */
  readonly fileType: string | undefined;
  readonly title: string | undefined;
  readonly artist: string | undefined;
  readonly album: string | undefined;
  readonly genre: string | undefined;
  readonly bpm: string | undefined;
  readonly key: string | undefined;
  /** Every record in the entry, including ones we do not interpret. */
  readonly records: readonly SeratoRecord[];
}

export interface SeratoLibrary {
  readonly version: string | undefined;
  readonly tracks: readonly SeratoTrackEntry[];
  readonly trailingBytes: number;
  /** Tags seen but not mapped to a field — the honest unknown surface. */
  readonly unmappedTags: readonly string[];
}

export interface SeratoCrate {
  readonly version: string | undefined;
  /**
   * Crate name is **not** stored in the file — it lives only in the filename.
   * Supplied by the caller that read the file, or undefined.
   */
  readonly name: string | undefined;
  readonly trackPaths: readonly string[];
  readonly trailingBytes: number;
}

/**
 * Tags mapped to fields on a track entry.
 *
 * Serato writes many more than this. Everything else is preserved in
 * `records` rather than dropped — the format is undocumented, and discarding
 * a tag we have not learned to read yet would lose user data silently.
 */
const TRACK_FIELD_TAGS = {
  pfil: "filePath",
  ttyp: "fileType",
  tsng: "title",
  tart: "artist",
  talb: "album",
  tgen: "genre",
  tbpm: "bpm",
  tkey: "key",
} as const;

function toTrackEntry(records: readonly SeratoRecord[]): SeratoTrackEntry {
  return {
    filePath: findText(records, "pfil"),
    fileType: findText(records, "ttyp"),
    title: findText(records, "tsng"),
    artist: findText(records, "tart"),
    album: findText(records, "talb"),
    genre: findText(records, "tgen"),
    bpm: findText(records, "tbpm"),
    key: findText(records, "tkey"),
    records,
  };
}

export function parseLibrary(bytes: Uint8Array): SeratoLibrary {
  const { records, trailingBytes } = parseRecords(bytes);

  const tracks: SeratoTrackEntry[] = [];
  const unmapped = new Set<string>();

  for (const record of records) {
    if (record.tag === "otrk" && record.value.type === "container") {
      tracks.push(toTrackEntry(record.value.children));
      for (const child of record.value.children) {
        if (!(child.tag in TRACK_FIELD_TAGS)) unmapped.add(child.tag);
      }
    } else if (record.tag !== "vrsn") {
      unmapped.add(record.tag);
    }
  }

  return {
    version: findText(records, "vrsn"),
    tracks,
    trailingBytes,
    unmappedTags: [...unmapped].sort(),
  };
}

export function parseCrate(bytes: Uint8Array, name?: string): SeratoCrate {
  const { records, trailingBytes } = parseRecords(bytes);

  const trackPaths: string[] = [];
  for (const record of records) {
    if (record.tag === "otrk" && record.value.type === "container") {
      // Crates use `ptrk`; the library database uses `pfil`. Accept either so
      // a crate written by a different Serato version still reads.
      const path = findText(record.value.children, "ptrk") ??
        findText(record.value.children, "pfil");
      if (path !== undefined) trackPaths.push(path);
    }
  }

  return {
    version: findText(records, "vrsn"),
    ...(name !== undefined ? { name } : { name: undefined }),
    trackPaths,
    trailingBytes,
  };
}
