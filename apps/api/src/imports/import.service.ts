import type { ImportRun } from "@flowgraph/db";
import type { ImportRunDto, SeratoRootDto } from "@flowgraph/contracts";
import type { SeratoTrackManifest } from "@flowgraph/serato";

import {
  externalKey,
  streamingKey,
  type ImportCounts,
  type ImportRepository,
  type LocalFileUpsert,
  type TrackUpsert,
} from "./import.repository.js";
import {
  hashPath,
  resolveVolumePath,
  statFile,
  type SeratoSource,
} from "./serato-source.js";

/**
 * Serato import — plan §12.3 S1.
 *
 * Read-only: nothing here opens a Serato file for writing, and the parser it
 * depends on cannot (ADR-0010 enforces that structurally). The import reads a
 * library and writes to our own database.
 *
 * Idempotent, which §12.4 requires. A local entry matches on its canonical
 * path; a streaming entry matches on the provider id Serato stores in the
 * `pfil` slot, falling back to case-folded title and artist when there is
 * none. Re-running produces updates rather than duplicates, and the run
 * summary says which.
 *
 * Plain class, plain interfaces, no framework types — ADR-0002 rule 3.
 */

/**
 * Volume roots a Serato path may be relative to.
 *
 * Serato stores paths relative to the volume the file is on and does not
 * record which volume that was, so resolution is a search. The boot volume
 * first, then mounted volumes — which is what makes an external-drive library
 * resolve rather than reporting every track missing.
 */
const DEFAULT_VOLUME_ROOTS = ["/"] as const;

export class ImportService {
  constructor(
    private readonly repository: ImportRepository,
    private readonly serato: SeratoSource,
    private readonly volumeRoots: readonly string[] = DEFAULT_VOLUME_ROOTS,
  ) {}

  discoverRoots(): SeratoRootDto[] {
    return this.serato.discoverRoots().map((root) => ({
      root: root.root,
      readable: root.readable,
      crateCount: root.crateCount,
    }));
  }

  async listRuns(workspaceId: string, limit = 20): Promise<ImportRunDto[]> {
    return (await this.repository.listRuns(workspaceId, limit)).map(toRunDto);
  }

  /**
   * Runs one import to completion.
   *
   * Synchronous from the caller's perspective. Plan §17 puts long imports
   * behind a job queue, and a library large enough to need one will need that
   * — but there is no queue yet, and a fake job id returned by a request that
   * already did the work would be worse than an honest wait.
   */
  async importSerato(workspaceId: string, root: string | undefined): Promise<ImportRunDto> {
    const scan = this.serato.scan(root);
    const run = await this.repository.startRun(workspaceId, scan.root);

    try {
      const counts = await this.applyManifests(workspaceId, scan.tracks);
      const finished = await this.repository.finishRun(workspaceId, run.id, counts);
      return toRunDto(finished ?? run);
    } catch (error) {
      // The message is stored, so it must not carry a path (§12.2).
      await this.repository.failRun(workspaceId, run.id, redact(error));
      throw error;
    }
  }

  /**
   * Applies a manifest to the library.
   *
   * Separated from the scan on purpose: this is the half a desktop bridge
   * would drive by posting manifests over TLS, and it does not know or care
   * where they came from.
   */
  async applyManifests(
    workspaceId: string,
    manifests: readonly SeratoTrackManifest[],
  ): Promise<ImportCounts> {
    const byHash = await this.repository.localFilesByHash(workspaceId);
    const streamingIndex = await this.repository.streamingTrackIndex(workspaceId);

    let created = 0;
    let updated = 0;
    let missing = 0;
    let streaming = 0;

    // Guards against one library listing the same path twice: without it the
    // second occurrence would not find the row the first just wrote, and would
    // insert a duplicate that the unique index then rejects.
    const seenHashes = new Set<string>();
    const seenStreamingKeys = new Set<string>();

    for (const manifest of manifests) {
      const track = toTrackUpsert(manifest);

      if (manifest.filePath === null) {
        streaming += 1;

        // The provider id is exact and survives a retitle, so it is tried
        // first; title and artist are the fallback for an entry we could not
        // read one from.
        const identity =
          manifest.streamingProvider !== null && manifest.streamingId !== null
            ? externalKey(manifest.streamingProvider, manifest.streamingId)
            : streamingKey(manifest.title, manifest.artist);

        if (seenStreamingKeys.has(identity)) continue;
        seenStreamingKeys.add(identity);

        const existing =
          (manifest.streamingProvider !== null && manifest.streamingId !== null
            ? streamingIndex.byExternalId.get(identity)
            : undefined) ??
          streamingIndex.byTitleArtist.get(streamingKey(manifest.title, manifest.artist));

        if (existing) {
          await this.repository.updateTrackWithFile(workspaceId, existing.id, track, null);
          updated += 1;
        } else {
          await this.repository.createTrackWithFile(workspaceId, track, null);
          created += 1;
        }
        continue;
      }

      const resolved = resolveVolumePath(manifest.filePath, this.volumeRoots);
      const facts = resolved.exists ? statFile(resolved.canonicalPath) : null;
      if (facts === null) missing += 1;

      const hash = hashPath(resolved.canonicalPath);
      if (seenHashes.has(hash)) continue;
      seenHashes.add(hash);

      const file: LocalFileUpsert = {
        seratoPath: manifest.filePath,
        canonicalPath: resolved.canonicalPath,
        canonicalPathHash: hash,
        fileType: manifest.fileType,
        sizeBytes: facts?.sizeBytes ?? null,
        fileModifiedAt: facts?.modifiedAt ?? null,
        missing: facts === null,
      };

      const existing = byHash.get(hash);
      if (existing) {
        await this.repository.updateTrackWithFile(workspaceId, existing.trackId, track, file);
        updated += 1;
      } else {
        await this.repository.createTrackWithFile(workspaceId, track, file);
        created += 1;
      }
    }

    return {
      tracksSeen: manifests.length,
      tracksCreated: created,
      tracksUpdated: updated,
      filesMissing: missing,
      streamingSeen: streaming,
    };
  }
}

function toTrackUpsert(manifest: SeratoTrackManifest): TrackUpsert {
  return {
    title: manifest.title,
    artist: manifest.artist,
    bpm: manifest.bpm,
    keySignature: manifest.key,
    album: manifest.album,
    genre: manifest.genre,
    durationSeconds: manifest.durationSeconds,
    // Only meaningful for a streaming entry; a local file's identity is its
    // path, and writing a provider id there would claim a link that is not
    // recorded anywhere.
    sourceProvider: manifest.streamingProvider,
    sourceExternalId: manifest.streamingId,
  };
}

/**
 * An error message safe to store.
 *
 * §12.2 keeps usernames, absolute paths, and tokens out of anything that may
 * be read back later, and a failed run's message is read back in the UI.
 */
function redact(error: unknown): string {
  const message = error instanceof Error ? error.message : "Import failed";
  return message.replace(/\/[^\s]*/g, "[path]").slice(0, 500);
}

function toRunDto(run: ImportRun): ImportRunDto {
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    source: run.source,
    root: run.root,
    status: run.status,
    tracksSeen: run.tracksSeen,
    tracksCreated: run.tracksCreated,
    tracksUpdated: run.tracksUpdated,
    filesMissing: run.filesMissing,
    streamingSeen: run.streamingSeen,
    error: run.error,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}
