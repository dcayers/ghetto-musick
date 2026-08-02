import { describe, it, expect } from "vitest";
import {
  buildTrackGraph,
  authoredNextTracks,
  suggestNext,
  findBestPath,
} from "./track-graph.js";
import type { ScorableTrack } from "./transition-score.js";

const track = (id: string, bpm: number, keySignature: string): ScorableTrack => ({
  id,
  bpm,
  keySignature,
  tags: [],
  energy: 5,
});

describe("buildTrackGraph", () => {
  it("adds every track as a node", () => {
    const graph = buildTrackGraph([track("a", 128, "8A"), track("b", 128, "9A")]);
    expect(graph.order).toBe(2);
    expect(graph.hasNode("a")).toBe(true);
  });

  it("adds transitions as directed edges", () => {
    const graph = buildTrackGraph(
      [track("a", 128, "8A"), track("b", 128, "9A")],
      [{ id: "t1", sourceTrackId: "a", targetTrackId: "b" }],
    );
    expect(graph.size).toBe(1);
    expect(graph.hasDirectedEdge("a", "b")).toBe(true);
    // Plan §7.2: direction is meaningful, so the reverse edge must not exist.
    expect(graph.hasDirectedEdge("b", "a")).toBe(false);
  });

  it("skips transitions referencing an absent track", () => {
    // Imports are partial by nature — a Serato scan can reference a file that
    // has not been reconciled yet. One dangling edge must not fail the canvas.
    const graph = buildTrackGraph(
      [track("a", 128, "8A")],
      [{ id: "t1", sourceTrackId: "a", targetTrackId: "ghost" }],
    );
    expect(graph.size).toBe(0);
    expect(graph.order).toBe(1);
  });

  it("skips self-loops", () => {
    const graph = buildTrackGraph(
      [track("a", 128, "8A")],
      [{ id: "t1", sourceTrackId: "a", targetTrackId: "a" }],
    );
    expect(graph.size).toBe(0);
  });

  it("preserves transition attributes", () => {
    const graph = buildTrackGraph(
      [track("a", 128, "8A"), track("b", 128, "9A")],
      [
        {
          id: "t1",
          sourceTrackId: "a",
          targetTrackId: "b",
          technique: "long blend",
          tags: ["acid"],
          confidence: 0.8,
        },
      ],
    );
    const attributes = graph.getDirectedEdgeAttributes("a", "b");
    expect(attributes.technique).toBe("long blend");
    expect(attributes.tags).toEqual(["acid"]);
    expect(attributes.confidence).toBe(0.8);
  });

  it("keeps a single source of truth for edge data", () => {
    // The prototype this replaced stored connection tags in two places and
    // hand-synced them. With one graph instance that desync is not expressible.
    const graph = buildTrackGraph(
      [track("a", 128, "8A"), track("b", 128, "9A")],
      [{ id: "t1", sourceTrackId: "a", targetTrackId: "b", tags: ["old"] }],
    );
    graph.setDirectedEdgeAttribute("a", "b", "tags", ["new"]);
    expect(graph.getDirectedEdgeAttributes("a", "b").tags).toEqual(["new"]);
    expect(graph.size).toBe(1);
  });
});

describe("authoredNextTracks", () => {
  it("returns only tracks the user actually connected", () => {
    const graph = buildTrackGraph(
      [track("a", 128, "8A"), track("b", 128, "9A"), track("c", 128, "8A")],
      [{ id: "t1", sourceTrackId: "a", targetTrackId: "b" }],
    );
    expect(authoredNextTracks(graph, "a").map((t) => t.id)).toEqual(["b"]);
    // c is a perfect harmonic match but was never connected.
    expect(authoredNextTracks(graph, "b")).toEqual([]);
  });

  it("returns an empty list for an unknown track", () => {
    const graph = buildTrackGraph([track("a", 128, "8A")]);
    expect(authoredNextTracks(graph, "missing")).toEqual([]);
  });
});

describe("suggestNext", () => {
  const graph = buildTrackGraph([
    track("source", 128, "8A"),
    track("perfect", 128, "8A"),
    track("adjacent", 128, "9A"),
    track("distant", 128, "2A"),
    track("wrong-tempo", 175, "8A"),
  ]);

  it("ranks the whole library, not just authored neighbours", () => {
    // The point is surfacing transitions the DJ has not thought of yet.
    const results = suggestNext(graph, "source");
    expect(results.length).toBe(4);
    expect(results[0]!.track.id).toBe("perfect");
  });

  it("never suggests the source track", () => {
    expect(suggestNext(graph, "source").map((r) => r.track.id)).not.toContain("source");
  });

  it("honours exclusions", () => {
    const results = suggestNext(graph, "source", { exclude: ["perfect", "adjacent"] });
    expect(results.map((r) => r.track.id)).not.toContain("perfect");
    expect(results.map((r) => r.track.id)).not.toContain("adjacent");
  });

  it("honours a limit", () => {
    expect(suggestNext(graph, "source", { limit: 2 })).toHaveLength(2);
  });

  it("honours a minimum score", () => {
    const results = suggestNext(graph, "source", { minScore: 0.9 });
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.score.overall).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("returns an empty list for an unknown track", () => {
    expect(suggestNext(graph, "missing")).toEqual([]);
  });
});

describe("findBestPath", () => {
  it("returns a single-track path when start equals end", () => {
    const graph = buildTrackGraph([track("a", 128, "8A")]);
    const result = findBestPath(graph, "a", "a");
    expect(result?.path.map((t) => t.id)).toEqual(["a"]);
  });

  it("routes through an intermediate track when the direct move is worse", () => {
    // 8A→10A is harmonically distant, but 8A→9A→10A is two adjacent moves.
    // A DJ asking "get me from this opener to this closer" wants the bridge.
    const graph = buildTrackGraph([
      track("start", 128, "8A"),
      track("bridge", 128, "9A"),
      track("end", 128, "10A"),
    ]);

    const result = findBestPath(graph, "start", "end");
    expect(result).not.toBeNull();
    expect(result!.path.map((t) => t.id)).toEqual(["start", "bridge", "end"]);
    expect(result!.totalScore).toBeGreaterThan(0.9);
  });

  it("takes the direct route when it is already good", () => {
    const graph = buildTrackGraph([
      track("start", 128, "8A"),
      track("end", 128, "8A"),
      track("detour", 128, "2A"),
    ]);
    const result = findBestPath(graph, "start", "end");
    expect(result!.path.map((t) => t.id)).toEqual(["start", "end"]);
  });

  it("returns null for unknown endpoints", () => {
    const graph = buildTrackGraph([track("a", 128, "8A")]);
    expect(findBestPath(graph, "a", "missing")).toBeNull();
    expect(findBestPath(graph, "missing", "a")).toBeNull();
  });

  it("never returns a path longer than maxLength", () => {
    const graph = buildTrackGraph([
      track("start", 128, "1A"),
      track("s2", 128, "2A"),
      track("s3", 128, "3A"),
      track("s4", 128, "4A"),
      track("end", 128, "5A"),
    ]);
    const result = findBestPath(graph, "start", "end", { maxLength: 3 });
    if (result !== null) {
      expect(result.path.length).toBeLessThanOrEqual(3);
    }
  });

  it("produces a path that starts and ends where asked", () => {
    const graph = buildTrackGraph([
      track("start", 128, "8A"),
      track("mid", 130, "9A"),
      track("end", 126, "10A"),
    ]);
    const result = findBestPath(graph, "start", "end");
    expect(result!.path[0]!.id).toBe("start");
    expect(result!.path.at(-1)!.id).toBe("end");
  });

  it("visits each track at most once", () => {
    const graph = buildTrackGraph([
      track("start", 128, "8A"),
      track("a", 128, "9A"),
      track("b", 128, "10A"),
      track("end", 128, "11A"),
    ]);
    const result = findBestPath(graph, "start", "end");
    const ids = result!.path.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
