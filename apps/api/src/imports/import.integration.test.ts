import { describe, expect, it, beforeEach } from "vitest";
import type { SeratoTrackManifest } from "@flowgraph/serato";

import { useDatabase, seedWorkspace } from "../testing/harness.js";
import { ImportRepository } from "./import.repository.js";
import { ImportService } from "./import.service.js";

/**
 * Import idempotency against the constraints that actually enforce it.
 *
 * `import.service.test.ts` proves the matching logic with an in-memory
 * repository, which is the right place for the branching. What it cannot see
 * is the database: whether the unique indexes exist in the *migration*,
 * whether Postgres treats their nulls the way the schema comment claims, and
 * whether a second run collides instead of updating.
 *
 * §12.4 makes this an acceptance gate — "re-import is idempotent" — and the
 * failure mode is a DJ's library silently doubling.
 */

const stubSource = { discoverRoots: () => [], scan: () => ({ root: "/x", tracks: [] }) };

const local = (over: Partial<SeratoTrackManifest> = {}): SeratoTrackManifest => ({
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

const streaming = (over: Partial<SeratoTrackManifest> = {}): SeratoTrackManifest =>
  local({
    filePath: null,
    location: "streaming",
    fileType: "streaming",
    streamingProvider: "spotify",
    streamingId: "56GaYWGPrKJt6e6SGKKiUD",
    ...over,
  });

describe("Serato import", () => {
  const db = useDatabase();

  let workspaceId: string;
  let service: ImportService;

  beforeEach(async () => {
    workspaceId = (await seedWorkspace(db())).workspaceId;
    // A volume root nothing resolves under, so the file facts are consistent
    // wherever this runs.
    service = new ImportService(new ImportRepository(db()), stubSource, ["/nonexistent"]);
  });

  const titles = async (): Promise<string[]> =>
    (await db().track.findMany({ where: { workspaceId }, orderBy: { title: "asc" } })).map(
      (track) => track.title,
    );

  it("creates tracks and file rows on a first run", async () => {
    const counts = await service.applyManifests(workspaceId, [local(), streaming()]);

    expect(counts).toMatchObject({ tracksSeen: 2, tracksCreated: 2, streamingSeen: 1 });
    expect(await db().track.count({ where: { workspaceId } })).toBe(2);
    // Only the local entry gets a file row; streaming is a state, not a
    // broken local file.
    expect(await db().localFile.count({ where: { workspaceId } })).toBe(1);
  });

  it("updates instead of duplicating on a re-run", async () => {
    const manifests = [local(), streaming()];
    await service.applyManifests(workspaceId, manifests);
    const second = await service.applyManifests(workspaceId, manifests);

    expect(second).toMatchObject({ tracksCreated: 0, tracksUpdated: 2 });
    expect(await db().track.count({ where: { workspaceId } })).toBe(2);
  });

  it("survives many re-runs without growing", async () => {
    const manifests = [local(), streaming()];
    for (let run = 0; run < 5; run += 1) {
      await service.applyManifests(workspaceId, manifests);
    }

    expect(await db().track.count({ where: { workspaceId } })).toBe(2);
    expect(await db().localFile.count({ where: { workspaceId } })).toBe(1);
  });

  it("refreshes metadata Serato re-analysed", async () => {
    await service.applyManifests(workspaceId, [local({ bpm: 124, genre: "House" })]);
    await service.applyManifests(workspaceId, [local({ bpm: 126, genre: "Techno" })]);

    const track = await db().track.findFirstOrThrow({ where: { workspaceId } });
    expect(Number(track.bpm)).toBe(126);
    expect(track.genre).toBe("Techno");
  });

  it("leaves the user's own work alone across a re-import", async () => {
    // The reason anyone would press the button twice. An import that reset
    // tags is one you learn not to run.
    await service.applyManifests(workspaceId, [local()]);
    const before = await db().track.findFirstOrThrow({ where: { workspaceId } });
    await db().track.update({ where: { id: before.id }, data: { tags: ["opener", "peak"] } });

    await service.applyManifests(workspaceId, [local({ bpm: 130 })]);

    const after = await db().track.findFirstOrThrow({ where: { workspaceId } });
    expect(after.tags).toEqual(["opener", "peak"]);
    expect(Number(after.bpm)).toBe(130);
  });

  it("matches a streaming entry on its provider id after a retitle", async () => {
    await service.applyManifests(workspaceId, [streaming({ title: "Locket" })]);
    await service.applyManifests(workspaceId, [streaming({ title: "Locket [E]" })]);

    expect(await titles()).toEqual(["Locket [E]"]);
  });

  it("keeps two recordings apart when only their titles agree", async () => {
    await service.applyManifests(workspaceId, [
      streaming({ streamingId: "aaa", title: "Hummingbird" }),
      streaming({ streamingId: "bbb", title: "Hummingbird" }),
    ]);

    expect(await db().track.count({ where: { workspaceId } })).toBe(2);
  });

  it("treats null provider identities as distinct, as the unique index assumes", async () => {
    // The migration comment claims Postgres lets many rows share
    // (workspaceId, NULL, NULL) because nulls compare distinct. If that were
    // wrong, importing a second local track would violate the index.
    await service.applyManifests(workspaceId, [
      local({ filePath: "Users/dj/A.mp3", title: "A" }),
      local({ filePath: "Users/dj/B.mp3", title: "B" }),
      local({ filePath: "Users/dj/C.mp3", title: "C" }),
    ]);

    const tracks = await db().track.findMany({ where: { workspaceId } });
    expect(tracks).toHaveLength(3);
    expect(tracks.every((track) => track.sourceExternalId === null)).toBe(true);
  });

  it("stops one workspace's import from colliding with another's identical library", async () => {
    // The unique indexes are per workspace. Two DJs importing the same
    // Spotify track must not fight over one row.
    const other = (await seedWorkspace(db(), "Other")).workspaceId;

    await service.applyManifests(workspaceId, [local(), streaming()]);
    await service.applyManifests(other, [local(), streaming()]);

    expect(await db().track.count({ where: { workspaceId } })).toBe(2);
    expect(await db().track.count({ where: { workspaceId: other } })).toBe(2);
  });

  it("records a run with counts that match what landed", async () => {
    const repository = new ImportRepository(db());
    const service = new ImportService(
      repository,
      {
        discoverRoots: () => [],
        scan: () => ({ root: "/Users/dj/Music/_Serato_", tracks: [local(), streaming()] }),
      },
      ["/nonexistent"],
    );

    const run = await service.importSerato(workspaceId, undefined);

    expect(run).toMatchObject({
      status: "SUCCEEDED",
      tracksSeen: 2,
      tracksCreated: 2,
      streamingSeen: 1,
    });
    expect(run.finishedAt).not.toBeNull();
    expect(await db().track.count({ where: { workspaceId } })).toBe(2);
  });

  it("marks a run failed and keeps no path in the stored message", async () => {
    // §12.2 keeps absolute paths out of anything read back later, and a failed
    // run's message is shown in the UI.
    const repository = new ImportRepository(db());
    const exploding = {
      discoverRoots: () => [],
      scan: () => ({ root: "/Users/dj/Music/_Serato_", tracks: [] }),
    };
    const service = new ImportService(repository, exploding, ["/nonexistent"]);

    // Force a failure after the run row exists.
    const original = service.applyManifests.bind(service);
    service.applyManifests = async () => {
      throw new Error("boom reading /Users/dewaun/Music/_Serato_/database V2");
    };

    await expect(service.importSerato(workspaceId, undefined)).rejects.toThrow();
    service.applyManifests = original;

    const [run] = await repository.listRuns(workspaceId, 10);
    expect(run?.status).toBe("FAILED");
    expect(run?.error).not.toContain("/Users/");
    expect(run?.error).toContain("[path]");
  });
});
