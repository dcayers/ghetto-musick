import { describe, it, expect } from "vitest";
import {
  scoreTransition,
  rankCandidates,
  TRANSITION_ALGORITHM_VERSION,
  type ScorableTrack,
} from "./transition-score.js";

const track = (overrides: Partial<ScorableTrack> & { id: string }): ScorableTrack => ({
  bpm: 128,
  keySignature: "8A",
  tags: [],
  energy: 5,
  ...overrides,
});

describe("scoreTransition", () => {
  it("scores an ideal transition near the top", () => {
    const result = scoreTransition(
      track({ id: "a", tags: ["house"] }),
      track({ id: "b", tags: ["house"] }),
    );
    expect(result.overall).toBeGreaterThan(0.9);
    expect(result.harmonicRelation).toBe("identical");
    expect(result.warnings).toHaveLength(0);
  });

  it("stamps the algorithm version on every result", () => {
    // Plan §10.4: stored scores must be attributable to the algorithm that
    // produced them, so weight changes cannot silently invalidate history.
    const result = scoreTransition(track({ id: "a" }), track({ id: "b" }));
    expect(result.algorithmVersion).toBe(TRANSITION_ALGORITHM_VERSION);
  });

  it("penalises harmonically distant keys", () => {
    const close = scoreTransition(track({ id: "a" }), track({ id: "b", keySignature: "9A" }));
    const far = scoreTransition(track({ id: "a" }), track({ id: "c", keySignature: "2A" }));
    expect(close.overall).toBeGreaterThan(far.overall);
    expect(far.warnings).toContain("Keys are harmonically distant");
  });

  it("penalises tempo moves beyond tolerance", () => {
    const result = scoreTransition(track({ id: "a" }), track({ id: "b", bpm: 145 }));
    expect(result.warnings).toContain("Tempo change exceeds the configured pitch tolerance");
    expect(result.components.tempo.score).toBeLessThan(0.5);
  });

  it("is directional", () => {
    // Plan §7.2: A→B is not automatically valid as B→A.
    const forward = scoreTransition(
      track({ id: "a", keySignature: "8A" }),
      track({ id: "b", keySignature: "3A" }),
    );
    const backward = scoreTransition(
      track({ id: "b", keySignature: "3A" }),
      track({ id: "a", keySignature: "8A" }),
    );
    expect(forward.harmonicRelation).toBe("energy-boost");
    expect(backward.harmonicRelation).toBe("distant");
    expect(forward.overall).toBeGreaterThan(backward.overall);
  });

  describe("missing metadata", () => {
    it("marks components inapplicable rather than scoring them zero", () => {
      const result = scoreTransition(
        track({ id: "a", bpm: null }),
        track({ id: "b", bpm: null }),
      );
      expect(result.components.tempo.applicable).toBe(false);
      expect(result.components.harmonic.applicable).toBe(true);
      expect(result.warnings).toContain(
        "BPM unknown for one or both tracks; tempo score omitted",
      );
    });

    it("ranks unknown BPM above genuinely bad BPM", () => {
      // The property that matters: unknown is not the same as bad. Scoring
      // missing data as zero would rank a track with no BPM below one with a
      // terrible BPM, which is exactly backwards.
      const from = track({ id: "from", bpm: 128, tags: [], energy: null });
      const unknown = scoreTransition(from, track({ id: "u", bpm: null, tags: [], energy: null }));
      const bad = scoreTransition(from, track({ id: "b", bpm: 200, tags: [], energy: null }));

      expect(unknown.overall).toBeGreaterThan(bad.overall);
    });

    it("returns zero and warns when nothing is scorable", () => {
      const bare = { id: "x", bpm: null, keySignature: null, tags: [], energy: null };
      const result = scoreTransition(bare, { ...bare, id: "y" });
      expect(result.overall).toBe(0);
      expect(result.warnings).toContain("No scorable metadata available for this pair");
    });
  });

  it("rewards shared tags", () => {
    const shared = scoreTransition(
      track({ id: "a", tags: ["peak-time", "techno"] }),
      track({ id: "b", tags: ["peak-time", "techno"] }),
    );
    const none = scoreTransition(
      track({ id: "a", tags: ["peak-time", "techno"] }),
      track({ id: "c", tags: ["ambient", "downtempo"] }),
    );
    expect(shared.components.tags.score).toBe(1);
    expect(none.components.tags.score).toBe(0);
    expect(shared.overall).toBeGreaterThan(none.overall);
  });

  it("matches tags case-insensitively", () => {
    const result = scoreTransition(
      track({ id: "a", tags: ["Peak-Time"] }),
      track({ id: "b", tags: ["peak-time"] }),
    );
    expect(result.components.tags.score).toBe(1);
  });

  it("prefers a gentle energy lift to a large jump", () => {
    const gentle = scoreTransition(track({ id: "a", energy: 5 }), track({ id: "b", energy: 6 }));
    const jump = scoreTransition(track({ id: "a", energy: 5 }), track({ id: "c", energy: 10 }));
    expect(gentle.components.energy.score).toBeGreaterThan(jump.components.energy.score);
  });

  it("respects custom weights", () => {
    const harmonicOnly = scoreTransition(
      track({ id: "a" }),
      track({ id: "b", bpm: 200 }),
      { weights: { harmonic: 1, tempo: 0, energy: 0, tags: 0 } },
    );
    expect(harmonicOnly.overall).toBe(1);
  });

  it("always produces an overall score in [0, 1]", () => {
    const keys = ["1A", "5B", "8A", "12B", null];
    const tempos = [60, 128, 175, null];

    for (const fromKey of keys) {
      for (const toKey of keys) {
        for (const fromBpm of tempos) {
          for (const toBpm of tempos) {
            const result = scoreTransition(
              { id: "a", keySignature: fromKey, bpm: fromBpm },
              { id: "b", keySignature: toKey, bpm: toBpm },
            );
            expect(result.overall).toBeGreaterThanOrEqual(0);
            expect(result.overall).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});

describe("rankCandidates", () => {
  const from = track({ id: "from", bpm: 128, keySignature: "8A" });

  it("orders candidates best first", () => {
    const ranked = rankCandidates(from, [
      track({ id: "distant", keySignature: "2A" }),
      track({ id: "perfect", keySignature: "8A" }),
      track({ id: "adjacent", keySignature: "9A" }),
    ]);
    expect(ranked.map((entry) => entry.track.id)).toEqual(["perfect", "adjacent", "distant"]);
  });

  it("excludes the source track", () => {
    const ranked = rankCandidates(from, [from, track({ id: "other" })]);
    expect(ranked.map((entry) => entry.track.id)).toEqual(["other"]);
  });

  it("breaks ties deterministically by id", () => {
    // Set generation and its tests must not depend on input array order.
    const candidates = [track({ id: "zebra" }), track({ id: "alpha" }), track({ id: "mike" })];
    const first = rankCandidates(from, candidates);
    const second = rankCandidates(from, [...candidates].reverse());
    expect(first.map((entry) => entry.track.id)).toEqual(second.map((entry) => entry.track.id));
    expect(first.map((entry) => entry.track.id)).toEqual(["alpha", "mike", "zebra"]);
  });

  it("handles an empty candidate list", () => {
    expect(rankCandidates(from, [])).toEqual([]);
  });
});
