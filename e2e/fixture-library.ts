import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serializeRecords, type SeratoRecord } from "@flowgraph/serato";

/**
 * A real `_Serato_` directory, written with the parser's own encoder.
 *
 * Not a stub the import is told to trust: these are the bytes Serato writes,
 * produced by `serializeRecords`, so the end-to-end run exercises the actual
 * TLV parse rather than a shortcut around it. If the format understanding
 * regresses, this fails.
 *
 * A fixture rather than the machine's real library because an end-to-end test
 * that reads `~/Music/_Serato_` asserts whatever happens to be installed —
 * it would pass on the author's laptop, fail in CI, and mean nothing either
 * way. `SERATO_ROOTS` is what lets the API be pointed here.
 */

const text = (tag: string, value: string): SeratoRecord => ({
  tag,
  value: { type: tag.startsWith("p") ? "path" : "text", value },
});

const track = (children: SeratoRecord[]): SeratoRecord => ({
  tag: "otrk",
  value: { type: "container", children },
});

/**
 * Modelled on the library ADR-0010 recorded: mostly streaming, one local file.
 *
 * The proportions matter. An all-local fixture would never exercise the
 * provider-id matching that most of a real library depends on, and the
 * streaming path is the one that was wrong the first time.
 */
export const FIXTURE_TRACKS = [
  { title: "Strobe", artist: "deadmau5", bpm: "128.00", key: "8A", local: true },
  { title: "Innerbloom", artist: "RUFUS DU SOL", bpm: "122.00", key: "9A", local: false },
  { title: "Opus", artist: "Eric Prydz", bpm: "126.00", key: "10A", local: false },
  { title: "Losing It", artist: "FISHER", bpm: "125.00", key: "11A", local: false },
] as const;

export function writeFixtureLibrary(root: string): string {
  const seratoRoot = join(root, "_Serato_");
  mkdirSync(join(seratoRoot, "Subcrates"), { recursive: true });

  const records: SeratoRecord[] = [text("vrsn", "2.0/Serato Scratch LIVE Database")];

  for (const [index, entry] of FIXTURE_TRACKS.entries()) {
    records.push(
      track([
        text("ttyp", entry.local ? "mp3" : "streaming"),
        // A streaming entry's path slot holds a provider id, not a path —
        // the correction ADR-0010 needed, and the case the import must not
        // resolve against the filesystem.
        text(
          "pfil",
          entry.local
            ? `Users/dj/Music/${entry.title}.mp3`
            : `fixtureSpotifyId${index}.spotify`,
        ),
        text("tsng", entry.title),
        text("tart", entry.artist),
        text("tgen", "Melodic House"),
        text("tbpm", entry.bpm),
        text("tkey", entry.key),
        text("tlen", "5:08"),
      ]),
    );
  }

  writeFileSync(join(seratoRoot, "database V2"), serializeRecords(records));
  return seratoRoot;
}
