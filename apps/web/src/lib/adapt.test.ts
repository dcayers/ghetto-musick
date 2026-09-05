import { describe, expect, it } from "vitest";

import { adaptGraph, adaptTrack, adaptTransition, mergeTracks } from "./adapt.js";
import type { GraphDetail, TransitionDto } from "./graph-api.js";

/**
 * Fixtures are annotated with the generated types, not cast to them.
 *
 * That is load-bearing rather than tidiness. These objects are the real wire
 * shape, nulls included, so annotating them makes the compiler check the
 * generated client against reality: a fixture setting `bpm: null` stops
 * compiling the moment `openapi.json` stops describing `bpm` as nullable.
 * A regression in the contract therefore fails the build here, instead of
 * reaching a consumer that trusted `bpm: number` and crashed on real data.
 *
 * Casting instead — which this file used to do, while the document did
 * understate nullability — silences exactly that signal.
 */
type TrackDto = GraphDetail["nodes"][number]["track"];

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

const trackDto: TrackDto = {
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

const transitionDto: TransitionDto = {
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

describe("adaptTrack", () => {
  it("carries the fields the API actually stores", () => {
    const track = adaptTrack(trackDto);

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
    const track = adaptTrack(trackDto);

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
    const first = adaptTrack(trackDto);
    const second = adaptTrack({ ...trackDto, id: "01a07040-ffff-7000-8000-00000000000f" });

    expect(second.energy).toBe(first.energy);
    expect(second.genre).toBe(first.genre);
  });

  it("preserves a null tempo and key rather than substituting a number", () => {
    const track = adaptTrack({ ...trackDto, bpm: null, keySignature: null });

    expect(track.bpm).toBeNull();
    expect(track.keySignature).toBeNull();
  });
});

describe("adaptTransition", () => {
  it("renames the endpoints from direction of travel to edge roles", () => {
    const transition = adaptTransition(transitionDto);

    expect(transition.sourceTrackId).toBe(transitionDto.fromTrackId);
    expect(transition.targetTrackId).toBe(transitionDto.toTrackId);
  });

  it("carries the stored score through as confidence", () => {
    expect(adaptTransition(transitionDto).confidence).toBe(0.633);
  });

  it("keeps an unscored transition unscored", () => {
    // Null is not zero. A zero confidence renders as a red 0%, which claims the
    // pairing was scored and found bad.
    expect(adaptTransition({ ...transitionDto, score: null }).confidence).toBeNull();
  });

  it("leaves the bar length null, since the API stores none", () => {
    expect(adaptTransition(transitionDto).bars).toBeNull();
  });

  it("maps absent notes to the empty string the inspector edits", () => {
    expect(adaptTransition(transitionDto).notes).toBe("");
    expect(adaptTransition({ ...transitionDto, notes: "duck the mids" }).notes).toBe(
      "duck the mids",
    );
  });

  it("marks every stored transition as manually authored", () => {
    // There is no AI write path, so anything the API returns was authored by a
    // person. This assertion should fail the day suggestions can be persisted.
    expect(adaptTransition(transitionDto).origin).toBe("manual");
  });
});

describe("adaptGraph", () => {
  const detail: GraphDetail = {
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
  };

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
  const graphTrack = adaptTrack(trackDto);
  const libraryTrack = adaptTrack({ ...trackDto, title: "Awake (library copy)" });
  const other = adaptTrack({ ...trackDto, id: "01a07040-ab91-7000-8000-000000000002" });

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
});
