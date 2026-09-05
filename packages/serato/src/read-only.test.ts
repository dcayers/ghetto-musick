import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * The read-only invariant — ADR-0010, plan §12.4.
 *
 * "FlowGraph never writes to an audio file" and read-only import "cannot
 * mutate fixtures". Those are the load-bearing safety claims of the whole
 * Serato integration: a DJ's library is often not re-downloadable, and the
 * cue points in it represent hours of manual work.
 *
 * A behavioural test (parse a file, check its checksum) proves the current
 * code path is clean but says nothing about a *future* edit. These tests
 * assert the structural property instead — the package has no way to write —
 * so adding a write import fails the suite rather than passing review.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Every fs API that can create, modify, truncate, move, or delete.
 *
 * Deliberately exhaustive rather than a spot check: the point is that a
 * plausible future edit reaching for any of them is caught.
 */
const MUTATING_FS_APIS = [
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "createWriteStream",
  "open", // can carry a write flag; use readFileSync instead
  "openSync",
  "truncate",
  "truncateSync",
  "ftruncate",
  "rm",
  "rmSync",
  "unlink",
  "unlinkSync",
  "rename",
  "renameSync",
  "copyFile",
  "copyFileSync",
  "mkdir",
  "mkdirSync",
  "rmdir",
  "chmod",
  "chown",
  "utimes",
  "link",
  "symlink",
] as const;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

describe("read-only invariant", () => {
  const files = sourceFiles(HERE);

  it("finds the package sources", () => {
    // Guards the guard: a broken path makes every assertion below vacuous.
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it.each(MUTATING_FS_APIS)("never imports fs.%s", (api) => {
    const offenders = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      // Match an import binding, not an incidental substring in prose.
      return new RegExp(`\\b${api}\\b\\s*(?=[,}])`).test(
        source.split("\n").filter((line) => line.includes("node:fs")).join("\n"),
      );
    });

    expect(offenders).toEqual([]);
  });

  it("confines all filesystem access to read.ts", () => {
    // One module touching the disk is one module to audit.
    const withFsImports = files
      .filter((file) => /from\s+["']node:fs["']/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(HERE.length + 1));

    expect(withFsImports).toEqual(["read.ts"]);
  });

  it("does not import node:fs/promises anywhere", () => {
    // The promises API exposes the same write surface under a different name.
    const offenders = files.filter((file) =>
      /node:fs\/promises/.test(readFileSync(file, "utf8")),
    );

    expect(offenders).toEqual([]);
  });

  it("keeps the parser itself free of any filesystem import", () => {
    // tlv.ts and library.ts take bytes and return data. With no file handle
    // to misuse, the invariant holds by construction rather than by care.
    for (const name of ["tlv.ts", "library.ts"]) {
      const source = readFileSync(join(HERE, name), "utf8");
      expect(source).not.toMatch(/node:fs/);
    }
  });
});
