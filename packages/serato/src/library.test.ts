import { describe, it, expect } from "vitest";
import { serializeRecords, type SeratoRecord } from "./tlv.js";
import { parseLibrary, parseCrate } from "./library.js";

/**
 * Library and crate parsing — ADR-0010 phase S1.
 *
 * Fixtures here are synthetic but modelled on a real `database V2`: same
 * version string, same tag set, and the same mix of `mp3` and `streaming`
 * entries observed in a live library. The real file is deliberately not
 * committed — it contains personal listening data.
 *
 * Synthetic fixtures cannot validate the format understanding against Serato
 * itself; only real files can. That validation is the `scan` script, which is
 * run manually against a real library and whose findings are recorded in
 * ADR-0010.
 */

const text = (tag: string, value: string): SeratoRecord => ({
  tag,
  value: { type: tag.startsWith("p") ? "path" : "text", value },
});

const uint = (tag: string, value: number): SeratoRecord => ({
  tag,
  value: { type: "uint", value },
});

const bool = (tag: string, value: boolean): SeratoRecord => ({
  tag,
  value: { type: "bool", value },
});

const track = (children: SeratoRecord[]): SeratoRecord => ({
  tag: "otrk",
  value: { type: "container", children },
});

/** Mirrors the shape of a real database V2, including tags we do not map. */
const LIBRARY_FIXTURE = serializeRecords([
  text("vrsn", "2.0/Serato Scratch LIVE Database"),
  track([
    text("ttyp", "mp3"),
    text("pfil", "Users/dj/Music/Strobe.mp3"),
    text("tsng", "Strobe"),
    text("tart", "deadmau5"),
    text("talb", "For Lack of a Better Name"),
    text("tgen", "Progressive House"),
    text("tbpm", "128.00"),
    text("tkey", "8A"),
    // Unmapped-but-preserved, exactly as seen in a real library.
    text("tlen", "10:33"),
    text("tbit", "320.0kbps"),
    uint("ulbl", 7),
    bool("bmis", false),
  ]),
  track([
    // Five of six entries in the observed library were streaming, not local.
    // Placeholder metadata — no real library content is committed here.
    text("ttyp", "streaming"),
    text("tsng", "Example Streaming Track"),
    text("tart", "Example Artist"),
    text("tbpm", "112.00"),
  ]),
]);

const CRATE_FIXTURE = serializeRecords([
  text("vrsn", "1.0/Serato ScratchLive Crate"),
  track([text("ptrk", "Users/dj/Music/Strobe.mp3")]),
  track([text("ptrk", "Users/dj/Music/Opus.mp3")]),
]);

describe("parseLibrary", () => {
  const library = parseLibrary(LIBRARY_FIXTURE);

  it("reads the version header", () => {
    expect(library.version).toBe("2.0/Serato Scratch LIVE Database");
  });

  it("consumes the whole file", () => {
    // Trailing bytes mean the parser stopped early and the import is partial.
    expect(library.trailingBytes).toBe(0);
  });

  it("extracts track metadata", () => {
    expect(library.tracks).toHaveLength(2);
    expect(library.tracks[0]).toMatchObject({
      filePath: "Users/dj/Music/Strobe.mp3",
      fileType: "mp3",
      title: "Strobe",
      artist: "deadmau5",
      bpm: "128.00",
      key: "8A",
    });
  });

  it("handles streaming entries, which have no local file", () => {
    // Observed in a real library: most entries were streaming. A streaming
    // track has no pfil, so anything downstream that assumes a local path
    // must treat it as optional.
    const streaming = library.tracks[1];
    expect(streaming?.fileType).toBe("streaming");
    expect(streaming?.filePath).toBeUndefined();
    expect(streaming?.title).toBe("Example Streaming Track");
  });

  it("reports tags it does not map instead of hiding them", () => {
    expect(library.unmappedTags).toContain("tbit");
    expect(library.unmappedTags).toContain("ulbl");
    expect(library.unmappedTags).not.toContain("tsng");
  });

  it("reads the running time", () => {
    // `tlen` was among the 26 tags ADR-0010 recorded as seen but unread. The
    // timeline computes set length from it, so it is a field now.
    expect(library.tracks[0]?.length).toBe("10:33");
    expect(library.unmappedTags).not.toContain("tlen");
  });

  it("keeps every raw record on the entry", () => {
    // Nothing is dropped: an unmapped tag today may be a field tomorrow.
    const tags = library.tracks[0]?.records.map((r) => r.tag) ?? [];
    expect(tags).toContain("tbit");
    expect(tags).toContain("bmis");
  });

  it("is idempotent", () => {
    // Plan §12.4: re-import must be idempotent.
    expect(parseLibrary(LIBRARY_FIXTURE)).toEqual(parseLibrary(LIBRARY_FIXTURE));
  });

  it("returns an empty library for empty input rather than throwing", () => {
    const empty = parseLibrary(new Uint8Array(0));
    expect(empty.tracks).toEqual([]);
    expect(empty.version).toBeUndefined();
  });
});

describe("parseCrate", () => {
  it("extracts track paths", () => {
    const crate = parseCrate(CRATE_FIXTURE, "Peak Time");
    expect(crate.trackPaths).toEqual([
      "Users/dj/Music/Strobe.mp3",
      "Users/dj/Music/Opus.mp3",
    ]);
    expect(crate.trailingBytes).toBe(0);
  });

  it("takes its name from the caller, since the file does not store one", () => {
    expect(parseCrate(CRATE_FIXTURE, "Peak Time").name).toBe("Peak Time");
    expect(parseCrate(CRATE_FIXTURE).name).toBeUndefined();
  });

  it("accepts pfil as well as ptrk", () => {
    // Different Serato versions have used both for the track path.
    const withPfil = serializeRecords([
      text("vrsn", "1.0/Serato ScratchLive Crate"),
      track([text("pfil", "Users/dj/Music/Legacy.mp3")]),
    ]);

    expect(parseCrate(withPfil).trackPaths).toEqual(["Users/dj/Music/Legacy.mp3"]);
  });

  it("is idempotent", () => {
    expect(parseCrate(CRATE_FIXTURE, "x")).toEqual(parseCrate(CRATE_FIXTURE, "x"));
  });
});
