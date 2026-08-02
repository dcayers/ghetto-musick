import type { PrismaClient } from "@flowgraph/db";

export interface HealthReport {
  ready: boolean;
  checks: Record<string, "ok" | "failed">;
}

/**
 * Readiness checks for required dependencies only.
 *
 * No framework imports — this is not a controller.
 */
export class HealthService {
  constructor(private readonly prisma: PrismaClient) {}

  async check(): Promise<HealthReport> {
    const checks: Record<string, "ok" | "failed"> = {};

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = "ok";
    } catch {
      checks.database = "failed";
    }

    return {
      ready: Object.values(checks).every((status) => status === "ok"),
      checks,
    };
  }
}
