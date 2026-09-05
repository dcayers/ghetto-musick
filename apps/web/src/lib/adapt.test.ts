import { describe, expect, it } from "vitest";

import { adaptGraph, adaptTrack, adaptTransition, mergeTracks } from "./adapt.js";
import type { GraphDetail, TransitionDto } from "./graph-api.js";

/**
 * The generated types understate nullability, so fixtures are cast.
 *
 * `@riktajs/swagger` drops `nullable` when it converts a Zod schema to
 * OpenAPI: `notes: z.string().nullable()` is emitted as `{"type": "string"}`,
 * and `openapi-typescript` faithfully turns that into `notes: string`. The API
 * really does return null for these — the contract in
 * `packages/contracts/src/*.ts` is the accurate description — so the fixtures
 * below are the true wire shape and the cast is what bridges the defect.
 *
 * Confined to this helper deliberately. When the document starts carrying
 * nullability, these casts become unnecessary and should be deleted; anywhere
 * else the same cast would just hide the problem.
 */
const asWire = <T>(value: unknown): T => value as T;

/**
 * These tests exist to make one class of change loud.
 *
 * The adapter is where an API that stores less than the UI renders meets the UI
 * that renders it, and its whole discipline is "map what exists, null what does
 * not". That discipline is invisible at runtime — a fabricated genre looks
 * exactly like a real one — so it has to be asserted rather than reviewed. When
 * the schema grows a column, the matching assertion here should fail and be
 * rewritten, which is the point.
 */

const trackDto = {
  id: "01a07040-ab56-7000-8000-000000000001",
  workspaceId: "01a07040-0000-7000-8000-000000000000",
  title: "Awake",
  artist: "Solomun",
  bpm: 124,
  keySignature: "6A",
  timeSignature: null,
  tags: ["opener"],
  version: 1,
  createdAt: "2026-09-05T00:00:00.000Z",
  updatedAt: "2026-09-05T00:00:00.000Z",
};
const trackFixture = asWire<GraphDetail["nodes"][number]["track"]>(trackDto);

const transitionDto = {
  id: "01a07046-79b2-7000-8000-000000000001",
  workspaceId: "01a07040-0000-7000-8000-000000000000",
  fromTrackId: "01a07040-ab56-7000-8000-000000000001",
  toTrackId: "01a07040-ab91-7000-8000-000000000002",
  technique: "long-blend",
  notes: null,
  tags: [],
  score: 0.633,
  scoreAlgorithm: 1,
  createdAt: "2026-09-05T00:00:00.000Z",
  updatedAt: "2026-09-05T00:00:00.000Z",
};
const transitionFixture = asWire<TransitionDto>(transitionDto);

describe("adaptTrack", () => {
  it("carries the fields the API actually stores", () => {
    const track = adaptTrack(trackFixture);

    expect(track).toMatchObject({
      id: trackDto.id,
      title: "Awake",
      artist: "Solomun",
      bpm: 124,
      keySignature: "6A",
      tags: ["opener"],
    });
  });

  it("leaves every field without a column null rather than deriving one", () => {
    const track = adaptTrack(trackFixture);

    // Not a style preference: a genre or energy derived from the id would sit
    // beside the user's real titles looking like their own metadata.
    expect(track.energy).toBeNull();
    expect(track.genre).toBeNull();
    expect(track.year).toBeNull();
    expect(track.durationSeconds).toBeNull();
    expect(track.rating).toBeNull();
    expect(track.source).toBeNull();
    expect(track.hasStems).toBe(false);
    expect(track.provenance).toEqual({});
  });

  it("gives two adapted tracks the same absences, not id-derived variety", () => {
    const first = adaptTrack(trackFixture);
    const second = adaptTrack(asWire({ ...trackDto, id: "01a07040-ffff-7000-8000-00000000000f" }));

    expect(second.energy).toBe(first.energy);
    expect(second.genre).toBe(first.genre);
  });

  it("preserves a null tempo and key rather than substituting a number", () => {
    const track = adaptTrack(asWire({ ...trackDto, bpm: null, keySignature: null }));

    expect(track.bpm).toBeNull();
    expect(track.keySignature).toBeNull();
  });
});

describe("adaptTransition", () => {
  it("renames the endpoints from direction of travel to edge roles", () => {
    const transition = adaptTransition(transitionFixture);

    expect(transition.sourceTrackId).toBe(transitionDto.fromTrackId);
    expect(transition.targetTrackId).toBe(transitionDto.toTrackId);
  });

  it("carries the stored score through as confidence", () => {
    expect(adaptTransition(transitionFixture).confidence).toBe(0.633);
  });

  it("keeps an unscored transition unscored", () => {
    // Null is not zero. A zero confidence renders as a red 0%, which claims the
    // pairing was scored and found bad.
    expect(adaptTransition(asWire({ ...transitionDto, score: null })).confidence).toBeNull();
  });

  it("leaves the bar length null, since the API stores none", () => {
    expect(adaptTransition(transitionFixture).bars).toBeNull();
  });

  it("maps absent notes to the empty string the inspector edits", () => {
    expect(adaptTransition(transitionFixture).notes).toBe("");
    expect(adaptTransition(asWire({ ...transitionDto, notes: "duck the mids" })).notes).toBe(
      "duck the mids",
    );
  });

  it("marks every stored transition as manually authored", () => {
    // There is no AI write path, so anything the API returns was authored by a
    // person. This assertion should fail the day suggestions can be persisted.
    expect(adaptTransition(transitionFixture).origin).toBe("manual");
  });
});

describe("adaptGraph", () => {
  const detail = asWire<GraphDetail>({
    graph: {
      id: "01a07041-eafd-7000-8000-000000000001",
      workspaceId: "01a07040-0000-7000-8000-000000000000",
      name: "Untitled graph",
      version: 3,
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:00:00.000Z",
    },
    nodes: [
      {
        id: "01a07042-0000-7000-8000-000000000001",
        trackId: trackDto.id,
        x: 45,
        y: 84,
        track: trackDto,
      },
    ],
    transitions: [transitionDto],
  });

  it("keeps the version, which is the token every layout write is checked against", () => {
    expect(adaptGraph(detail).graphVersion).toBe(3);
  });

  it("returns the tracks its own nodes carry, so the canvas can render alone", () => {
    const adapted = adaptGraph(detail);

    expect(adapted.nodeTracks.map((track) => track.id)).toEqual([trackDto.id]);
    expect(adapted.nodes[0]).toEqual({
      id: detail.nodes[0]?.id,
      trackId: trackDto.id,
      x: 45,
      y: 84,
    });
  });
});

describe("mergeTracks", () => {
  const graphTrack = adaptTrack(trackFixture);
  const libraryTrack = adaptTrack(asWire({ ...trackDto, title: "Awake (library copy)" }));
  const other = adaptTrack(asWire({ ...trackDto, id: "01a07040-ab91-7000-8000-000000000002" }));

  it("prefers the first list on a collision", () => {
    const merged = mergeTracks([graphTrack], [libraryTrack]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe("Awake");
  });

  it("appends the ids the first list does not have, in order", () => {
    expect(mergeTracks([graphTrack], [libraryTrack, other]).map((track) => track.id)).toEqual([
      graphTrack.id,
      other.id,
    ]);
  });

  it("returns the second list whole when the first is empty", () => {
    expect(mergeTracks([], [libraryTrack, other])).toHaveLength(2);
  });

  it("collapses repeats inside the first list too", () => {
    // A set's inline tracks repeat whenever it plays a track twice. Screening
    // only the second list let those through, and the library rendered the
    // track twice under one React key.
    const merged = mergeTracks([graphTrack, other, graphTrack], []);

    expect(merged.map((track) => track.id)).toEqual([graphTrack.id, other.id]);
  });

  it("keeps ids unique however the repeat is split across the two lists", () => {
    const merged = mergeTracks([graphTrack, graphTrack], [other, other, libraryTrack]);

    expect(new Set(merged.map((track) => track.id)).size).toBe(merged.length);
  });
});
