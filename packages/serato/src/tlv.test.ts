import { describe, it, expect } from "vitest";
import {
  parseRecords,
  serializeRecords,
  encodeUtf16Be,
  findText,
  type SeratoRecord,
} from "./tlv.js";

/**
 * TLV envelope tests — ADR-0010.
 *
 * Serato publishes no specification, so the parser runs against files written
 * by software we do not control, on a user's real library. Robustness against
 * malformed input matters as much as correctness on well-formed input: the
 * wrong failure mode here is aborting a whole library scan because one record
 * is odd, or worse, reading past a record boundary and reporting garbage as
 * track metadata.
 */

/** Builds a raw record the way Serato does: tag, BE length, payload. */
function record(tag: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  for (let i = 0; i < 4; i += 1) out[i] = tag.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, payload.length, false);
  out.set(payload, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const u32 = (value: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
};

describe("parseRecords", () => {
  it("decodes the version header the way a real database V2 stores it", () => {
    // Byte-for-byte shape confirmed against a real library.
    const bytes = record("vrsn", encodeUtf16Be("2.0/Serato Scratch LIVE Database"));
    const { records, trailingBytes } = parseRecords(bytes);

    expect(trailingBytes).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0]?.tag).toBe("vrsn");
    expect(records[0]?.value).toEqual({
      type: "text",
      value: "2.0/Serato Scratch LIVE Database",
    });
  });

  it("decodes payload type from the tag prefix", () => {
    const bytes = concat(
      record("tsng", encodeUtf16Be("Strobe")),
      record("pfil", encodeUtf16Be("Music/strobe.mp3")),
      record("ulbl", u32(42)),
      record("bhrt", new Uint8Array([1])),
    );

    const { records } = parseRecords(bytes);

    expect(records.map((r) => r.value.type)).toEqual(["text", "path", "uint", "bool"]);
    expect(findText(records, "tsng")).toBe("Strobe");
    expect(findText(records, "pfil")).toBe("Music/strobe.mp3");
  });

  it("parses nested containers recursively", () => {
    const inner = concat(
      record("ttyp", encodeUtf16Be("mp3")),
      record("tsng", encodeUtf16Be("Opus")),
    );
    const { records } = parseRecords(record("otrk", inner));

    expect(records[0]?.value.type).toBe("container");
    if (records[0]?.value.type === "container") {
      expect(records[0].value.children).toHaveLength(2);
      expect(findText(records[0].value.children, "tsng")).toBe("Opus");
    }
  });

  it("preserves unknown tags rather than dropping them", () => {
    // The format is undocumented. Discarding a tag we have not learned to
    // read yet would lose user data silently.
    const { records } = parseRecords(record("zzzz", new Uint8Array([1, 2, 3])));

    expect(records).toHaveLength(1);
    expect(records[0]?.tag).toBe("zzzz");
    expect(records[0]?.value.type).toBe("unknown");
  });

  describe("malformed input", () => {
    it("never throws, whatever the bytes", () => {
      const inputs = [
        new Uint8Array(0),
        new Uint8Array([0]),
        new Uint8Array([0xff, 0xff, 0xff, 0xff]),
        new Uint8Array(7).fill(0x41),
        concat(record("vrsn", encodeUtf16Be("ok")), new Uint8Array([0xde, 0xad])),
        new Uint8Array(64).fill(0xff),
      ];

      for (const input of inputs) {
        expect(() => parseRecords(input)).not.toThrow();
      }
    });

    it("stops at a length that overruns the buffer instead of over-reading", () => {
      // A corrupt length must not cause adjacent records to be read as this
      // record's payload and reported as metadata.
      const bytes = concat(
        record("vrsn", encodeUtf16Be("v")),
        new Uint8Array([0x6f, 0x74, 0x72, 0x6b, 0xff, 0xff, 0xff, 0xff]), // otrk, length 4GB
      );

      const { records, trailingBytes } = parseRecords(bytes);

      expect(records).toHaveLength(1);
      expect(records[0]?.tag).toBe("vrsn");
      expect(trailingBytes).toBe(8);
    });

    it("stops at a non-printable tag", () => {
      const bytes = concat(
        record("vrsn", encodeUtf16Be("v")),
        new Uint8Array([0x00, 0x01, 0x02, 0x03, 0, 0, 0, 0]),
      );

      const { records, trailingBytes } = parseRecords(bytes);

      expect(records).toHaveLength(1);
      expect(trailingBytes).toBe(8);
    });

    it("reports a truncated trailing record rather than ignoring it", () => {
      // Silently dropping a tail is how a partial import gets mistaken for a
      // complete one.
      const bytes = concat(record("vrsn", encodeUtf16Be("v")), new Uint8Array([0x74]));

      expect(parseRecords(bytes).trailingBytes).toBe(1);
    });
  });
});

describe("round trip", () => {
  const sample = concat(
    record("vrsn", encodeUtf16Be("2.0/Serato Scratch LIVE Database")),
    record(
      "otrk",
      concat(
        record("ttyp", encodeUtf16Be("mp3")),
        record("pfil", encodeUtf16Be("Music/Strobe.mp3")),
        record("tsng", encodeUtf16Be("Strobe")),
        record("tbpm", encodeUtf16Be("128.00")),
        record("ulbl", u32(7)),
      ),
    ),
  );

  it("reproduces the original bytes exactly", () => {
    // Strong evidence the parser loses nothing: anything it failed to model
    // would show up as a byte difference here.
    const { records } = parseRecords(sample);

    expect(serializeRecords(records)).toEqual(sample);
  });

  it("is stable across repeated cycles", () => {
    let bytes = sample;
    for (let i = 0; i < 3; i += 1) {
      bytes = serializeRecords(parseRecords(bytes).records);
    }
    expect(bytes).toEqual(sample);
  });

  it("preserves unknown tags through a round trip", () => {
    const withUnknown = concat(
      record("vrsn", encodeUtf16Be("v")),
      record("qqqq", new Uint8Array([0xca, 0xfe, 0xba, 0xbe])),
    );

    const parsed: readonly SeratoRecord[] = parseRecords(withUnknown).records;
    expect(serializeRecords(parsed)).toEqual(withUnknown);
  });
});
