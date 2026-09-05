import { z } from "zod";

/**
 * Health contracts — plan §18.2.
 *
 * Liveness answers "is this process alive" and must not touch dependencies;
 * readiness answers "can it serve traffic" and checks required dependencies
 * only. Optional providers (Spotify, the AI provider) are deliberately
 * excluded from readiness — an outage there must not pull the API out of
 * rotation.
 */

export const livenessSchema = z.object({
  status: z.literal("ok"),
});

export const readinessSchema = z.object({
  ready: z.boolean(),
  checks: z.record(z.string(), z.enum(["ok", "failed"])),
});

export type Liveness = z.infer<typeof livenessSchema>;
export type Readiness = z.infer<typeof readinessSchema>;
