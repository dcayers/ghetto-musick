import { describe, expect, it, vi } from "vitest";
import type { SeratoTrackManifest } from "@flowgraph/serato";

import { ImportService } from "./import.service.js";
import { externalKey, streamingKey, type ImportRepository } from "./import.repository.js";

/**
 * These tests are about one guarantee: **re-import is idempotent** (§12.4).
 *
 * That guarantee is invisible in a single run and expensive to discover
 * manually — you find out you got it wrong when a DJ's library has doubled.
 * The repository is faked in memory rather than mocked call-by-call, so the
 * assertions are about the resulting library rather than about which methods
 * were called in which order.
 */

interface FakeTrack {
  id: string;
  title: string;
  artist: string;
  bpm: number | null;
  genre: string | null;
  durationSeconds: number | null;
  sourceProvider: string | null;
  sourceExternalId: string | null;
  hasFile: boolean;
}

function fakeRepository() {
  const tracks = new Map<string, FakeTrack>();
  const filesByHash = new Map<string, { trackId: string; missing: boolean }>();
  let nextId = 1;

  const repository = {
    startRun: vi.fn(async (_workspaceId: string, root: string) => ({
      id: "run-1",
      root,
    })),
    finishRun: vi.fn(async () => null),
    failRun: vi.fn(async () => undefined),
    findRun: vi.fn(async () => null),
    listRuns: vi.fn(async () => []),

    localFilesByHash: vi.fn(async () => new Map(filesByHash)),

    streamingTrackIndex: vi.fn(async () => {
      const byExternalId = new Map<string, { id: string }>();
      const byTitleArtist = new Map<string, { id: string }>();
      for (const track of tracks.values()) {
        if (track.hasFile) continue;
        if (track.sourceProvider && track.sourceExternalId) {
          byExternalId.set(externalKey(track.sourceProvider, track.sourceExternalId), {
            id: track.id,
          });
        }
        byTitleArtist.set(streamingKey(track.title, track.artist), { id: track.id });
      }
      return { byExternalId, byTitleArtist };
    }),

    createTrackWithFile: vi.fn(async (_workspaceId, track, file) => {
      const id = `track-${nextId++}`;
      tracks.set(id, { id, ...track, hasFile: file !== null });
      if (file) filesByHash.set(file.canonicalPathHash, { trackId: id, missing: file.missing });
      return { id };
    }),

    updateTrackWithFile: vi.fn(async (_workspaceId, trackId, track, file) => {
      const existing = tracks.get(trackId);
      if (existing) tracks.set(trackId, { ...existing, ...track });
      if (file) filesByHash.set(file.canonicalPathHash, { trackId, missing: file.missing });
    }),
  };

  return { repository: repository as unknown as ImportRepository, tracks, filesByHash };
}

/** A source whose `scan` never touches a disk. */
const stubSource = { discoverRoots: () => [], scan: () => ({ root: "/x", tracks: [] }) };

const manifest = (over: Partial<SeratoTrackManifest> = {}): SeratoTrackManifest => ({
  filePath: "Users/dj/Music/Awake.mp3",
  location: "file",
  fileType: "mp3",
  title: "Awake",
  artist: "Solomun",
  album: null,
  genre: "Melodic House",
  bpm: 124,
  key: "6A",
  durationSeconds: 508,
  streamingProvider: null,
  streamingId: null,
  ...over,
});

/**
 * A volume root nothing resolves under, so every path is "missing".
 *
 * Deliberate: the identity and counting logic must be exercised without the
 * test depending on files existing on the machine running it.
 */
const service = (repository: ImportRepository) =>
  new ImportService(repository, stubSource, ["/nonexistent-volume"]);

describe("applyManifests", () => {
  it("creates a track and a file row for a local entry", async () => {
    const { repository, tracks, filesByHash } = fakeRepository();

    const counts = await service(repository).applyManifests("w1", [manifest()]);

    expect(counts).toMatchObject({ tracksSeen: 1, tracksCreated: 1, tracksUpdated: 0 });
    expect(tracks.size).toBe(1);
    expect(filesByHash.size).toBe(1);
  });

  it("updates rather than duplicating on a second run", async () => {
    // The guarantee. Without it a re-import doubles the library.
    const { repository, tracks } = fakeRepository();
    const manifests = [manifest(), manifest({ filePath: "Users/dj/Music/Opus.mp3", title: "Opus" })];

    await service(repository).applyManifests("w1", manifests);
    const second = await service(repository).applyManifests("w1", manifests);

    expect(second).toMatchObject({ tracksSeen: 2, tracksCreated: 0, tracksUpdated: 2 });
    expect(tracks.size).toBe(2);
  });

  it("refreshes changed metadata on re-import", async () => {
    // Serato wins for DJ metadata (§4.3), so a re-analysed tempo must land.
    const { repository, tracks } = fakeRepository();

    await service(repository).applyManifests("w1", [manifest({ bpm: 124 })]);
    await service(repository).applyManifests("w1", [manifest({ bpm: 126, genre: "Techno" })]);

    const [track] = [...tracks.values()];
    expect(track?.bpm).toBe(126);
    expect(track?.genre).toBe("Techno");
  });

  it("treats a streaming entry as a track with no file", async () => {
    const { repository, tracks, filesByHash } = fakeRepository();

    const counts = await service(repository).applyManifests("w1", [
      manifest({ filePath: null, location: "streaming", fileType: "streaming" }),
    ]);

    expect(counts).toMatchObject({ streamingSeen: 1, tracksCreated: 1, filesMissing: 0 });
    expect(tracks.size).toBe(1);
    // No path means no file row — "streaming" is a state, not a broken local file.
    expect(filesByHash.size).toBe(0);
  });

  it("matches a streaming entry on title and artist across runs", async () => {
    const { repository, tracks } = fakeRepository();
    const streaming = manifest({ filePath: null, location: "streaming" });

    await service(repository).applyManifests("w1", [streaming]);
    const second = await service(repository).applyManifests("w1", [streaming]);

    expect(second).toMatchObject({ tracksCreated: 0, tracksUpdated: 1 });
    expect(tracks.size).toBe(1);
  });

  it("matches a streaming entry on its provider id, not its title", async () => {
    // Serato stores `56GaYWGPrKJt6e6SGKKiUD.spotify` in the path slot. The id
    // identifies one recording, so a retitle must not create a second track.
    const { repository, tracks } = fakeRepository();
    const spotify = manifest({
      filePath: null,
      location: "streaming",
      streamingProvider: "spotify",
      streamingId: "56GaYWGPrKJt6e6SGKKiUD",
    });

    await service(repository).applyManifests("w1", [spotify]);
    await service(repository).applyManifests("w1", [
      { ...spotify, title: "Locket (Explicit)" },
    ]);

    expect(tracks.size).toBe(1);
    expect([...tracks.values()][0]?.title).toBe("Locket (Explicit)");
  });

  it("keeps two recordings apart when only their titles agree", async () => {
    // The failure the id prevents: a radio edit and an extended mix share a
    // title and artist, and title matching would merge them into one track.
    const { repository, tracks } = fakeRepository();

    await service(repository).applyManifests("w1", [
      manifest({ filePath: null, streamingProvider: "spotify", streamingId: "aaa" }),
      manifest({ filePath: null, streamingProvider: "spotify", streamingId: "bbb" }),
    ]);

    expect(tracks.size).toBe(2);
  });

  it("records the provider identity so the next run can match on it", async () => {
    const { repository, tracks } = fakeRepository();

    await service(repository).applyManifests("w1", [
      manifest({ filePath: null, streamingProvider: "spotify", streamingId: "xyz" }),
    ]);

    const [track] = [...tracks.values()];
    expect(track?.sourceProvider).toBe("spotify");
    expect(track?.sourceExternalId).toBe("xyz");
  });

  it("leaves a local track's provider identity null", async () => {
    // A local file's identity is its path. Claiming a provider link that is
    // recorded nowhere would make the unique index reject unrelated tracks.
    const { repository, tracks } = fakeRepository();

    await service(repository).applyManifests("w1", [manifest()]);

    const [track] = [...tracks.values()];
    expect(track?.sourceProvider).toBeNull();
    expect(track?.sourceExternalId).toBeNull();
  });

  it("folds case when matching a streaming entry", async () => {
    const { repository, tracks } = fakeRepository();

    await service(repository).applyManifests("w1", [manifest({ filePath: null })]);
    await service(repository).applyManifests("w1", [
      manifest({ filePath: null, title: "AWAKE", artist: "solomun" }),
    ]);

    expect(tracks.size).toBe(1);
  });

  it("counts an unresolvable path as missing but still imports it", async () => {
    // The drive may simply be unplugged. Dropping the entry would silently
    // shrink the library; recording it missing is the honest answer.
    const { repository, tracks } = fakeRepository();

    const counts = await service(repository).applyManifests("w1", [manifest()]);

    expect(counts.filesMissing).toBe(1);
    expect(tracks.size).toBe(1);
  });

  it("collapses a path listed twice in one library", async () => {
    // The second occurrence cannot see the row the first just wrote, so
    // without this it inserts a duplicate the unique index then rejects.
    const { repository, tracks } = fakeRepository();

    const counts = await service(repository).applyManifests("w1", [manifest(), manifest()]);

    expect(counts).toMatchObject({ tracksSeen: 2, tracksCreated: 1 });
    expect(tracks.size).toBe(1);
  });

  it("collapses a streaming entry listed twice in one library", async () => {
    const { repository, tracks } = fakeRepository();
    const streaming = manifest({ filePath: null });

    await service(repository).applyManifests("w1", [streaming, streaming]);

    expect(tracks.size).toBe(1);
  });

  it("keeps local and streaming entries with the same title apart", async () => {
    // A path is stronger evidence than a title. Merging them would attach a
    // local file to a track that never had one.
    const { repository, tracks } = fakeRepository();

    await service(repository).applyManifests("w1", [
      manifest(),
      manifest({ filePath: null, location: "streaming" }),
    ]);

    expect(tracks.size).toBe(2);
  });

  it("reports every entry it saw, including the ones it merged", async () => {
    const { repository } = fakeRepository();

    const counts = await service(repository).applyManifests("w1", [
      manifest(),
      manifest(),
      manifest({ filePath: null }),
    ]);

    expect(counts.tracksSeen).toBe(3);
    expect(counts.tracksCreated).toBe(2);
  });

  it("imports an empty library without inventing a run", async () => {
    const { repository, tracks } = fakeRepository();

    const counts = await service(repository).applyManifests("w1", []);

    expect(counts).toEqual({
      tracksSeen: 0,
      tracksCreated: 0,
      tracksUpdated: 0,
      filesMissing: 0,
      streamingSeen: 0,
    });
    expect(tracks.size).toBe(0);
  });
});
