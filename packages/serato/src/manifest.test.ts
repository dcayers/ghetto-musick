import { describe, expect, it } from "vitest";

import {
  normalizeSeratoPath,
  parseBpm,
  parseDurationSeconds,
  toManifest,
} from "./manifest.js";
import type { SeratoTrackEntry } from "./library.js";

const entry = (over: Partial<SeratoTrackEntry> = {}): SeratoTrackEntry => ({
  filePath: "Users/dj/Music/Awake.mp3",
  fileType: "mp3",
  title: "Awake",
  artist: "Solomun",
  album: "Nobody Is Not Loved",
  genre: "Melodic House",
  bpm: "124.00",
  key: "6A",
  length: "8:28",
  records: [],
  ...over,
});

describe("parseBpm", () => {
  it("reads Serato's decimal string", () => {
    expect(parseBpm("124.00")).toBe(124);
    expect(parseBpm("128.53")).toBe(128.53);
  });

  it("rejects zero, which is what an unanalysed track stores", () => {
    // A tempo of zero would sort and filter as though it had been measured.
    expect(parseBpm("0")).toBeNull();
    expect(parseBpm("0.00")).toBeNull();
  });

  it("rejects absent and unparseable values", () => {
    expect(parseBpm(undefined)).toBeNull();
    expect(parseBpm("")).toBeNull();
    expect(parseBpm("   ")).toBeNull();
    expect(parseBpm("not a tempo")).toBeNull();
  });
});

describe("parseDurationSeconds", () => {
  it("reads minutes and seconds", () => {
    expect(parseDurationSeconds("5:08")).toBe(308);
  });

  it("reads the fractional form Serato displays", () => {
    expect(parseDurationSeconds("5:08.00")).toBe(308);
    expect(parseDurationSeconds("5:08.60")).toBe(309);
  });

  it("reads hours for a long recording", () => {
    expect(parseDurationSeconds("1:02:33")).toBe(3753);
  });

  it("reads a bare seconds count", () => {
    expect(parseDurationSeconds("95")).toBe(95);
  });

  it("rejects a zero or negative length", () => {
    // A zero-length track would make a set's total duration quietly wrong.
    expect(parseDurationSeconds("0:00")).toBeNull();
    expect(parseDurationSeconds("-1:00")).toBeNull();
  });

  it("rejects shapes it does not understand rather than guessing", () => {
    expect(parseDurationSeconds("1:2:3:4")).toBeNull();
    expect(parseDurationSeconds("about five minutes")).toBeNull();
    expect(parseDurationSeconds(undefined)).toBeNull();
  });
});

describe("normalizeSeratoPath", () => {
  it("strips the leading separator Serato omits inconsistently", () => {
    expect(normalizeSeratoPath("/Users/dj/Music/Awake.mp3")).toBe("Users/dj/Music/Awake.mp3");
    expect(normalizeSeratoPath("Users/dj/Music/Awake.mp3")).toBe("Users/dj/Music/Awake.mp3");
  });

  it("returns null for an absent path", () => {
    expect(normalizeSeratoPath(undefined)).toBeNull();
    expect(normalizeSeratoPath("")).toBeNull();
  });
});

describe("toManifest", () => {
  it("carries the fields Serato stores", () => {
    expect(toManifest(entry())).toEqual({
      filePath: "Users/dj/Music/Awake.mp3",
      location: "file",
      fileType: "mp3",
      title: "Awake",
      artist: "Solomun",
      album: "Nobody Is Not Loved",
      genre: "Melodic House",
      bpm: 124,
      key: "6A",
      durationSeconds: 508,
      streamingProvider: null,
      streamingId: null,
    });
  });

  it("treats an entry with no path as streaming, not as broken", () => {
    // ADR-0010's S0 run: five of six entries had no `pfil` at all. An import
    // that rejected these would reject most of a real library.
    const manifest = toManifest(
      entry({ filePath: undefined, fileType: "streaming", length: "3:41" }),
    );

    expect(manifest.location).toBe("streaming");
    expect(manifest.filePath).toBeNull();
    expect(manifest.title).toBe("Awake");
    // Tempo and key survive, which is what makes a streaming entry worth having.
    expect(manifest.bpm).toBe(124);
    expect(manifest.key).toBe("6A");
    expect(manifest.durationSeconds).toBe(221);
  });

  it("believes the type label over the path", () => {
    // The correction ADR-0010 needed. A streaming entry does carry a `pfil` —
    // it holds a Spotify id, not a path — so trusting the path resolves that
    // id against the filesystem and reports the track as a missing file.
    const manifest = toManifest(
      entry({ filePath: "56GaYWGPrKJt6e6SGKKiUD.spotify", fileType: "streaming" }),
    );

    expect(manifest.location).toBe("streaming");
    expect(manifest.filePath).toBeNull();
    expect(manifest.streamingProvider).toBe("spotify");
    expect(manifest.streamingId).toBe("56GaYWGPrKJt6e6SGKKiUD");
  });

  it("recognises a provider id even when the type label does not say streaming", () => {
    const manifest = toManifest(
      entry({ filePath: "3kDO0ttXrVCWbKCS3sQeC1.spotify", fileType: undefined }),
    );

    expect(manifest.location).toBe("streaming");
    expect(manifest.streamingId).toBe("3kDO0ttXrVCWbKCS3sQeC1");
  });

  it("treats an entry with no path slot at all as streaming", () => {
    expect(toManifest(entry({ filePath: undefined, fileType: "mp3" })).location).toBe(
      "streaming",
    );
  });

  it("does not mistake a real file for a provider id", () => {
    // A closed provider list, and a bare `<id>.<ext>` shape. A genuine file in
    // a folder keeps its separator, so it never matches.
    const manifest = toManifest(entry({ filePath: "Users/dj/Music/mix.spotify" }));

    expect(manifest.location).toBe("file");
    expect(manifest.streamingId).toBeNull();

    const flac = toManifest(entry({ filePath: "Users/dj/Music/Awake.flac" }));
    expect(flac.location).toBe("file");
  });

  it("falls back to the filename when Serato stored no title", () => {
    expect(toManifest(entry({ title: undefined })).title).toBe("Awake");
  });

  it("falls back to a placeholder when there is neither title nor path", () => {
    const manifest = toManifest(entry({ title: undefined, filePath: undefined }));

    expect(manifest.title).toBe("Untitled");
    expect(manifest.artist).toBe("Solomun");
  });

  it("names a missing artist rather than leaving the row blank", () => {
    expect(toManifest(entry({ artist: undefined })).artist).toBe("Unknown artist");
  });

  it("nulls the optional fields it has no value for", () => {
    const manifest = toManifest(
      entry({ album: undefined, genre: undefined, bpm: undefined, key: undefined, length: undefined }),
    );

    expect(manifest.album).toBeNull();
    expect(manifest.genre).toBeNull();
    expect(manifest.streamingProvider).toBeNull();
    expect(manifest.bpm).toBeNull();
    expect(manifest.key).toBeNull();
    expect(manifest.durationSeconds).toBeNull();
  });

  it("is deterministic, so re-import compares equal", () => {
    // §12.4 requires re-import to be idempotent, which starts with the same
    // bytes producing the same manifest.
    expect(toManifest(entry())).toEqual(toManifest(entry()));
  });
});
