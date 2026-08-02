import { describe, it, expect } from "vitest";
import { tempoCompatibility, tempoWindow } from "./tempo.js";

describe("tempoCompatibility", () => {
  it("scores an exact match perfectly with no pitch adjustment", () => {
    const match = tempoCompatibility(128, 128);
    expect(match.score).toBe(1);
    expect(match.pitchAdjustment).toBe(0);
    expect(match.ratio).toBe(1);
    expect(match.withinTolerance).toBe(true);
  });

  it("reports the pitch adjustment needed, with direction", () => {
    const up = tempoCompatibility(128, 132);
    expect(up.pitchAdjustment).toBeCloseTo(0.03125, 5);
    expect(up.withinTolerance).toBe(true);

    const down = tempoCompatibility(132, 128);
    expect(down.pitchAdjustment).toBeCloseTo(-0.0303, 3);
  });

  it("is directional — the adjustment inverts", () => {
    const forward = tempoCompatibility(120, 126);
    const backward = tempoCompatibility(126, 120);
    expect(Math.sign(forward.pitchAdjustment)).toBe(1);
    expect(Math.sign(backward.pitchAdjustment)).toBe(-1);
  });

  it("flags moves beyond tolerance without zeroing the score outright", () => {
    const match = tempoCompatibility(128, 138);
    expect(match.withinTolerance).toBe(false);
    expect(match.score).toBeGreaterThan(0);
    expect(match.score).toBeLessThan(1);
  });

  it("scores wildly mismatched tempos at zero", () => {
    expect(tempoCompatibility(128, 175, { allowHalfDouble: false }).score).toBe(0);
  });

  it("matches half-time and double-time pairings", () => {
    // A 70 BPM track and a 140 BPM track share a pulse. Rejecting this would
    // hide a large share of genuinely valid transitions.
    const halfTime = tempoCompatibility(70, 140);
    expect(halfTime.ratio).toBe(0.5);
    expect(halfTime.score).toBeGreaterThan(0.8);
    expect(halfTime.pitchAdjustment).toBeCloseTo(0, 5);

    const doubleTime = tempoCompatibility(140, 70);
    expect(doubleTime.ratio).toBe(2);
    expect(doubleTime.score).toBeGreaterThan(0.8);
  });

  it("ranks a direct match above an equivalent half-time match", () => {
    // Half/double time is valid but a bigger creative decision than a blend.
    expect(tempoCompatibility(128, 128).score).toBeGreaterThan(
      tempoCompatibility(64, 128).score,
    );
  });

  it("can be told to ignore half/double time", () => {
    const match = tempoCompatibility(70, 140, { allowHalfDouble: false });
    expect(match.ratio).toBe(1);
    expect(match.score).toBe(0);
  });

  it("honours a custom tolerance", () => {
    const strict = tempoCompatibility(128, 133, { tolerance: 0.01 });
    const loose = tempoCompatibility(128, 133, { tolerance: 0.2 });
    expect(strict.withinTolerance).toBe(false);
    expect(loose.withinTolerance).toBe(true);
    expect(loose.score).toBeGreaterThan(strict.score);
  });

  it("returns a zero score for non-positive input rather than dividing by zero", () => {
    expect(tempoCompatibility(0, 128).score).toBe(0);
    expect(tempoCompatibility(128, 0).score).toBe(0);
    expect(tempoCompatibility(-5, 128).score).toBe(0);
    expect(Number.isFinite(tempoCompatibility(0, 128).pitchAdjustment)).toBe(true);
  });
});

describe("tempoWindow", () => {
  it("brackets the reachable BPM range", () => {
    const window = tempoWindow(100, { tolerance: 0.06 });
    expect(window.min).toBeCloseTo(94, 5);
    expect(window.max).toBeCloseTo(106, 5);
  });

  it("agrees with tempoCompatibility at the boundary", () => {
    const window = tempoWindow(128);
    expect(tempoCompatibility(128, window.max).withinTolerance).toBe(true);
    expect(tempoCompatibility(128, window.max * 1.02).withinTolerance).toBe(false);
  });
});
