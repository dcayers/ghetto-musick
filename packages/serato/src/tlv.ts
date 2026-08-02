/**
 * Serato's tag-length-value envelope — ADR-0010.
 *
 * Every Serato sidecar file (`database V2`, `Subcrates/*.crate`) is a flat
 * sequence of records:
 *
 *     [4-byte ASCII tag][4-byte big-endian uint32 length][payload]
 *
 * The tag's first character encodes the payload type. Verified against a real
 * `database V2`: `vrsn` holds UTF-16BE "2.0/Serato Scratch LIVE Database",
 * followed by `otrk` containers wrapping `ttyp` and `pfil` records.
 *
 * **This module never touches the filesystem.** It takes bytes and returns
 * data. That is what makes ADR-0010's "FlowGraph never writes to an audio
 * file" invariant structurally true here rather than merely intended — there
 * is no file handle to misuse. The thin read-only fs layer lives in `read.ts`.
 *
 * The format is reverse-engineered and undocumented by Serato, so every parse
 * is fallible by design: unknown tags are preserved rather than dropped, and
 * a malformed record truncates the parse instead of throwing.
 */

export type SeratoValue =
  | { readonly type: "container"; readonly children: readonly SeratoRecord[] }
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "path"; readonly value: string }
  | { readonly type: "uint"; readonly value: number }
  | { readonly type: "int"; readonly value: number }
  | { readonly type: "bool"; readonly value: boolean }
  | { readonly type: "unknown"; readonly bytes: Uint8Array };

export interface SeratoRecord {
  readonly tag: string;
  readonly value: SeratoValue;
}

export interface ParseResult {
  readonly records: readonly SeratoRecord[];
  /**
   * Bytes that could not be parsed as a complete record, if any.
   *
   * Non-zero means the file is truncated, corrupt, or uses a structure we do
   * not understand. Surfaced rather than swallowed: silently ignoring a tail
   * is how a partial import gets mistaken for a complete one.
   */
  readonly trailingBytes: number;
}

const HEADER_SIZE = 8;

/** UTF-16 big-endian, which is what every `t*`/`p*` payload uses. */
function decodeUtf16Be(bytes: Uint8Array): string {
  // Odd length cannot be valid UTF-16; decode what we can rather than throw.
  const usable = bytes.length - (bytes.length % 2);
  let out = "";
  for (let i = 0; i < usable; i += 2) {
    out += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
  }
  return out;
}

export function encodeUtf16Be(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes[i * 2] = (code >> 8) & 0xff;
    bytes[i * 2 + 1] = code & 0xff;
  }
  return bytes;
}

function isAsciiTag(bytes: Uint8Array, offset: number): boolean {
  for (let i = 0; i < 4; i += 1) {
    const byte = bytes[offset + i];
    if (byte === undefined || byte < 0x20 || byte > 0x7e) return false;
  }
  return true;
}

/**
 * Decodes a payload according to the tag's first character.
 *
 * `vrsn` is special-cased: it is a complete tag rather than a prefixed one,
 * and its `v` would otherwise fall through to `unknown`.
 */
function decodeValue(tag: string, payload: Uint8Array): SeratoValue {
  if (tag === "vrsn") {
    return { type: "text", value: decodeUtf16Be(payload) };
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  switch (tag[0]) {
    case "o": {
      const nested = parseRecords(payload);
      return { type: "container", children: nested.records };
    }
    case "t":
      return { type: "text", value: decodeUtf16Be(payload) };
    case "p":
      return { type: "path", value: decodeUtf16Be(payload) };
    case "u":
      return payload.length >= 4
        ? { type: "uint", value: view.getUint32(0, false) }
        : { type: "unknown", bytes: payload };
    case "s":
      return payload.length >= 4
        ? { type: "int", value: view.getInt32(0, false) }
        : { type: "unknown", bytes: payload };
    case "b":
      return payload.length >= 1
        ? { type: "bool", value: payload[0] !== 0 }
        : { type: "unknown", bytes: payload };
    default:
      return { type: "unknown", bytes: payload };
  }
}

/**
 * Parses a flat sequence of records.
 *
 * Stops at the first record that cannot be read completely — a declared
 * length running past the buffer, or a tag containing non-printable bytes —
 * and reports the remainder as `trailingBytes`. It never throws on malformed
 * input: this parser runs against files written by software we do not
 * control, on a user's real library, so aborting the whole scan because one
 * record is odd would be the wrong failure mode.
 */
export function parseRecords(bytes: Uint8Array): ParseResult {
  const records: SeratoRecord[] = [];
  let offset = 0;

  while (offset + HEADER_SIZE <= bytes.length) {
    if (!isAsciiTag(bytes, offset)) break;

    const tag = String.fromCharCode(
      bytes[offset]!,
      bytes[offset + 1]!,
      bytes[offset + 2]!,
      bytes[offset + 3]!,
    );

    const view = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4);
    const length = view.getUint32(0, false);

    const payloadStart = offset + HEADER_SIZE;
    const payloadEnd = payloadStart + length;

    // A length that overruns the buffer means corruption or a misread — stop
    // rather than read adjacent records as payload.
    if (payloadEnd > bytes.length) break;

    records.push({
      tag,
      value: decodeValue(tag, bytes.subarray(payloadStart, payloadEnd)),
    });

    offset = payloadEnd;
  }

  return { records, trailingBytes: bytes.length - offset };
}

/**
 * Re-encodes records to bytes.
 *
 * Exists for round-trip testing, not for writing to a user's library —
 * ADR-0010 permits writing *new* `.crate` files only, and cue writing is
 * deferred indefinitely. A parse→serialize→parse cycle that reproduces the
 * original bytes is strong evidence the parser loses nothing.
 */
export function serializeRecords(records: readonly SeratoRecord[]): Uint8Array {
  const chunks: Uint8Array[] = [];

  for (const record of records) {
    const payload = serializeValue(record.value);
    const header = new Uint8Array(HEADER_SIZE);

    for (let i = 0; i < 4; i += 1) {
      header[i] = record.tag.charCodeAt(i);
    }
    new DataView(header.buffer).setUint32(4, payload.length, false);

    chunks.push(header, payload);
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function serializeValue(value: SeratoValue): Uint8Array {
  switch (value.type) {
    case "container":
      return serializeRecords(value.children);
    case "text":
    case "path":
      return encodeUtf16Be(value.value);
    case "uint": {
      const bytes = new Uint8Array(4);
      new DataView(bytes.buffer).setUint32(0, value.value, false);
      return bytes;
    }
    case "int": {
      const bytes = new Uint8Array(4);
      new DataView(bytes.buffer).setInt32(0, value.value, false);
      return bytes;
    }
    case "bool":
      return new Uint8Array([value.value ? 1 : 0]);
    case "unknown":
      return value.bytes;
  }
}

/** First record with the given tag, or undefined. */
export function findRecord(
  records: readonly SeratoRecord[],
  tag: string,
): SeratoRecord | undefined {
  return records.find((record) => record.tag === tag);
}

/** Text or path value of the first record with the given tag. */
export function findText(
  records: readonly SeratoRecord[],
  tag: string,
): string | undefined {
  const value = findRecord(records, tag)?.value;
  return value?.type === "text" || value?.type === "path" ? value.value : undefined;
}
