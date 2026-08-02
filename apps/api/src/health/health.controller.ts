import { Controller, Get, Autowired, ServiceUnavailableException } from "@riktajs/core";
import type { HealthService } from "./health.service.js";
import { HEALTH_SERVICE } from "../tokens.js";

/**
 * Health endpoints — plan §18.2.
 *
 * `/health/live` answers "is this process alive", used by the platform to
 * decide whether to restart. It must not touch dependencies, or a database
 * blip turns into a restart loop.
 *
 * `/health/ready` answers "can this process serve traffic", used to decide
 * whether to route to it. It checks required dependencies only — Spotify and
 * the AI provider are optional and are deliberately excluded.
 */
@Controller("/health")
export class HealthController {
  @Autowired(HEALTH_SERVICE)
  private readonly health!: HealthService;

  @Get("/live")
  live() {
    return { status: "ok" as const };
  }

  @Get("/ready")
  async ready() {
    const report = await this.health.check();

    if (!report.ready) {
      throw new ServiceUnavailableException("Dependencies unavailable");
    }

    return report;
  }
}
