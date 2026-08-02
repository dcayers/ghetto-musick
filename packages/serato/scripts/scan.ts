import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  defaultSeratoRoots,
  locateLibrary,
  readLibrary,
  readCrate,
} from "../src/index.js";

/**
 * Read-only Serato library scan — ADR-0010 phase S0, plan §12.3.
 *
 * The stop gate: "Read-only import cannot mutate fixtures (byte-for-byte
 * verification)" and "re-import is idempotent" (§12.4).
 *
 * Checksums every file in the library before parsing and again afterwards,
 * then parses twice and compares results. Reports what it could not
 * interpret — an unmapped tag is not a failure, but pretending the scan
 * understood everything would be.
 *
 * Safe to run against a real library: this process only ever reads.
 *
 *   pnpm --filter @flowgraph/serato run scan            # default locations
 *   pnpm --filter @flowgraph/serato run scan <path>     # explicit root
 */

interface FileDigest {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
  readonly mtimeMs: number;
}

function digestTree(root: string): FileDigest[] {
  const out: FileDigest[] = [];

  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — skip rather than abort the scan
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        try {
          const stat = statSync(full);
          out.push({
            path: full,
            sha256: createHash("sha256").update(readFileSync(full)).digest("hex"),
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          });
        } catch {
          // Unreadable file — not our concern, and not something to mutate.
        }
      }
    }
  };

  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function compareDigests(before: FileDigest[], after: FileDigest[]): string[] {
  const problems: string[] = [];
  const beforeByPath = new Map(before.map((d) => [d.path, d]));
  const afterByPath = new Map(after.map((d) => [d.path, d]));

  for (const [path, b] of beforeByPath) {
    const a = afterByPath.get(path);
    if (!a) {
      problems.push(`DISAPPEARED: ${path}`);
      continue;
    }
    if (a.sha256 !== b.sha256) problems.push(`CONTENT CHANGED: ${path}`);
    else if (a.size !== b.size) problems.push(`SIZE CHANGED: ${path}`);
    // mtime is reported separately — a changed mtime with identical content
    // still means something touched the file.
    else if (a.mtimeMs !== b.mtimeMs) problems.push(`MTIME CHANGED: ${path}`);
  }

  for (const path of afterByPath.keys()) {
    if (!beforeByPath.has(path)) problems.push(`APPEARED: ${path}`);
  }

  return problems;
}

function main(): void {
  const explicit = process.argv[2];
  const candidates = explicit ? [explicit] : defaultSeratoRoots(homedir());

  const root = candidates.find((candidate) => {
    try {
      return statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });

  if (!root) {
    console.error("No _Serato_ directory found. Tried:");
    for (const candidate of candidates) console.error(`  ${candidate}`);
    process.exit(1);
  }

  console.log(`Scanning ${root}\n`);

  const before = digestTree(root);
  console.log(`Checksummed ${before.length} files before parsing.`);

  const location = locateLibrary(root);

  // --- Library --------------------------------------------------------------
  if (location.databasePath) {
    const library = readLibrary(location.databasePath);
    const again = readLibrary(location.databasePath);

    console.log(`\ndatabase V2`);
    console.log(`  version:        ${library.version ?? "(none)"}`);
    console.log(`  tracks:         ${library.tracks.length}`);
    console.log(`  trailing bytes: ${library.trailingBytes}`);
    console.log(
      `  idempotent:     ${JSON.stringify(library) === JSON.stringify(again) ? "yes" : "NO"}`,
    );
    if (library.unmappedTags.length > 0) {
      console.log(`  unmapped tags:  ${library.unmappedTags.join(" ")}`);
    }

    const byType = new Map<string, number>();
    for (const track of library.tracks) {
      const type = track.fileType ?? "(unknown)";
      byType.set(type, (byType.get(type) ?? 0) + 1);
    }
    if (byType.size > 0) {
      console.log(
        `  file types:     ${[...byType].map(([t, n]) => `${t}=${n}`).join(" ")}`,
      );
    }

    for (const track of library.tracks.slice(0, 5)) {
      const label = [track.artist, track.title].filter(Boolean).join(" — ") || "(untitled)";
      console.log(`    ${label}  [${track.fileType ?? "?"}] ${track.bpm ?? ""}`);
    }
    if (library.tracks.length > 5) {
      console.log(`    ... and ${library.tracks.length - 5} more`);
    }
  } else {
    console.log("\ndatabase V2: not present");
  }

  // --- Crates ---------------------------------------------------------------
  console.log(`\nSubcrates: ${location.cratePaths.length} crate file(s)`);
  for (const cratePath of location.cratePaths.slice(0, 10)) {
    const crate = readCrate(cratePath);
    const again = readCrate(cratePath);
    console.log(
      `  ${crate.name}: ${crate.trackPaths.length} tracks, ` +
        `trailing=${crate.trailingBytes}, ` +
        `idempotent=${JSON.stringify(crate) === JSON.stringify(again) ? "yes" : "NO"}`,
    );
  }

  // --- The gate -------------------------------------------------------------
  const after = digestTree(root);
  const problems = compareDigests(before, after);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Checksummed ${after.length} files after parsing.`);

  if (problems.length === 0) {
    console.log("BYTE-FOR-BYTE VERIFICATION: PASS — nothing was modified.");
    process.exit(0);
  }

  console.log("BYTE-FOR-BYTE VERIFICATION: FAIL");
  for (const problem of problems) console.log(`  ${problem}`);
  process.exit(1);
}

main();
