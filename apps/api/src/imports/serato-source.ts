import { homedir } from "node:os";
import { statSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import {
  defaultSeratoRoots,
  locateLibrary,
  readLibrary,
  toManifests,
  type SeratoTrackManifest,
} from "@flowgraph/serato";

/**
 * Where a Serato library is read from.
 *
 * A port, not an abstraction for its own sake. Plan §12.1 requires a signed
 * desktop bridge because *a hosted service* cannot reach a DJ's local files —
 * but decision 18 puts deployment at "local development only for now", and an
 * API running on the user's own machine can simply read them. This interface
 * is the seam between those two worlds: today `LocalSeratoSource` implements
 * it by reading the disk; when the web app moves off the machine, a bridge
 * implements it by posting the same manifests over TLS.
 *
 * What matters is that nothing downstream knows the difference. The import
 * service consumes `SeratoScan` and would not change.
 */
export interface SeratoScan {
  readonly root: string;
  readonly tracks: readonly SeratoTrackManifest[];
}

export interface SeratoRootInfo {
  readonly root: string;
  readonly readable: boolean;
  readonly crateCount: number;
}

export interface SeratoSource {
  discoverRoots(): SeratoRootInfo[];
  scan(root: string | undefined): SeratoScan;
}

export class SeratoRootNotFoundError extends Error {
  constructor(readonly root: string) {
    // No absolute path in the message: §12.2 redacts paths from anything that
    // may be logged, and an API error is exactly that.
    super("No readable Serato library was found at the requested location");
    this.name = "SeratoRootNotFoundError";
  }
}

/**
 * Resolves a Serato path against the device's volumes.
 *
 * Serato stores paths relative to the volume the file sits on, with no record
 * of which volume that was. The boot volume is tried first and then
 * `/Volumes/*`-style roots, which is what makes an external-drive library
 * resolve at all. A path that matches nothing is still imported — as a missing
 * file, not as an omission, because the entry is real and the drive may simply
 * be unplugged.
 */
export function resolveVolumePath(
  seratoPath: string,
  volumeRoots: readonly string[],
): { canonicalPath: string; exists: boolean } {
  for (const volume of volumeRoots) {
    const candidate = resolve(join(volume, seratoPath));
    // Containment check before the stat: a crafted `../..` path in a library
    // file must not become a probe for files outside the volume.
    if (!candidate.startsWith(volume.endsWith(sep) ? volume : volume + sep)) continue;
    if (statFile(candidate) !== null) return { canonicalPath: candidate, exists: true };
  }

  // Unresolved: record it against the boot volume so the row is stable across
  // runs and the file can be found again when the drive comes back.
  const fallback = volumeRoots[0] ?? sep;
  return { canonicalPath: resolve(join(fallback, seratoPath)), exists: false };
}

export interface FileFacts {
  readonly sizeBytes: bigint;
  readonly modifiedAt: Date;
}

export function statFile(path: string): FileFacts | null {
  try {
    const stats = statSync(path);
    if (!stats.isFile()) return null;
    return { sizeBytes: BigInt(stats.size), modifiedAt: stats.mtime };
  } catch {
    // Unreadable and absent are the same answer here: no file to record.
    return null;
  }
}

/** Stable identity for a path, since a path can exceed a btree key. */
export function hashPath(path: string): string {
  return createHash("sha256").update(path).digest("hex");
}

/**
 * Reads the Serato library on this machine.
 *
 * Read-only by construction: `@flowgraph/serato` imports no mutating
 * filesystem call anywhere, and a test in that package fails the build if one
 * appears (ADR-0010). This class adds `statSync` and nothing else.
 */
export class LocalSeratoSource implements SeratoSource {
  constructor(
    private readonly home: string = homedir(),
    private readonly extraRoots: readonly string[] = [],
  ) {}

  discoverRoots(): SeratoRootInfo[] {
    const candidates = [...this.extraRoots, ...defaultSeratoRoots(this.home)];
    const seen = new Set<string>();

    return candidates.flatMap((root) => {
      if (seen.has(root)) return [];
      seen.add(root);
      const location = locateLibrary(root);
      return [
        {
          root,
          readable: location.databasePath !== undefined,
          crateCount: location.cratePaths.length,
        },
      ];
    });
  }

  scan(root: string | undefined): SeratoScan {
    const chosen = root ?? this.discoverRoots().find((entry) => entry.readable)?.root;
    if (chosen === undefined || !isAbsolute(chosen)) {
      throw new SeratoRootNotFoundError(chosen ?? "(none)");
    }

    const location = locateLibrary(chosen);
    if (location.databasePath === undefined) throw new SeratoRootNotFoundError(chosen);

    const library = readLibrary(location.databasePath);
    return { root: chosen, tracks: toManifests(library.tracks) };
  }
}
