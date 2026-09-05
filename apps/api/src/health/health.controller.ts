import { Controller, Get, Autowired, ServiceUnavailableException } from "@riktajs/core";
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiResponse,
} from "@riktajs/swagger";
import { livenessSchema, readinessSchema, errorResponseSchema } from "@flowgraph/contracts";
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
@ApiTags("Health")
export class HealthController {
  @Autowired(HEALTH_SERVICE)
  private readonly health!: HealthService;

  @Get("/live")
  @ApiOperation({
    summary: "Liveness probe",
    description:
      "Reports whether the process is alive. Touches no dependencies on " +
      "purpose — a database blip must not turn into a restart loop.",
  })
  @ApiOkResponse({ description: "Process is alive.", schema: livenessSchema })
  live() {
    return { status: "ok" as const };
  }

  @Get("/ready")
  @ApiOperation({
    summary: "Readiness probe",
    description:
      "Reports whether the process can serve traffic. Checks required " +
      "dependencies only; Spotify and the AI provider are optional and are " +
      "deliberately excluded.",
  })
  @ApiOkResponse({ description: "All required dependencies reachable.", schema: readinessSchema })
  @ApiResponse({
    status: 503,
    description: "A required dependency is unavailable.",
    schema: errorResponseSchema,
  })
  async ready() {
    const report = await this.health.check();

    if (!report.ready) {
      throw new ServiceUnavailableException("Dependencies unavailable");
    }

    return report;
  }
}
