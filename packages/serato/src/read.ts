import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { parseLibrary, parseCrate, type SeratoLibrary, type SeratoCrate } from "./library.js";

/**
 * Read-only filesystem access — ADR-0010.
 *
 * **This is the only module in the package that touches the filesystem, and
 * it imports read primitives exclusively.** `writeFileSync`, `open`,
 * `appendFile`, `rm`, and `rename` are deliberately absent, so no code path
 * here can mutate a user's library even by mistake. That is asserted by a
 * test rather than trusted, because a future edit adding one write import
 * would otherwise pass review unnoticed.
 *
 * ADR-0010 phase S2 will write *new* `.crate` files. When that lands it
 * belongs in a separate, explicitly-named module — not by relaxing this one.
 */

export interface SeratoLibraryLocation {
  readonly root: string;
  readonly databasePath: string | undefined;
  readonly subcratesDir: string | undefined;
  readonly cratePaths: readonly string[];
}

/** Standard `_Serato_` locations on macOS (ADR-0006: macOS only for now). */
export function defaultSeratoRoots(home: string): readonly string[] {
  return [join(home, "Music", "_Serato_"), join("/Users", "Shared", "_Serato_")];
}

export function locateLibrary(root: string): SeratoLibraryLocation {
  const databasePath = join(root, "database V2");
  const subcratesDir = join(root, "Subcrates");

  const hasDatabase = existsAsFile(databasePath);
  const hasSubcrates = existsAsDirectory(subcratesDir);

  const cratePaths = hasSubcrates
    ? readdirSync(subcratesDir)
        .filter((entry) => extname(entry).toLowerCase() === ".crate")
        .map((entry) => join(subcratesDir, entry))
        .sort()
    : [];

  return {
    root,
    databasePath: hasDatabase ? databasePath : undefined,
    subcratesDir: hasSubcrates ? subcratesDir : undefined,
    cratePaths,
  };
}

export function readLibrary(databasePath: string): SeratoLibrary {
  return parseLibrary(toBytes(readFileSync(databasePath)));
}

export function readCrate(cratePath: string): SeratoCrate {
  // The crate's name lives only in the filename — nothing inside the file
  // records it.
  const name = basename(cratePath, extname(cratePath));
  return parseCrate(toBytes(readFileSync(cratePath)), name);
}

function toBytes(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function existsAsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function existsAsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
