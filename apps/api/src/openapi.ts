import {
  OpenApiGenerator,
  type OpenApiDocument,
  type SwaggerConfig,
  type OpenApiSecurityScheme,
} from "@riktajs/swagger";
import { TrackController } from "./tracks/track.controller.js";
import { HealthController } from "./health/health.controller.js";

/**
 * OpenAPI document — plan §5.3, §8.9.
 *
 * The document is a checked-in build artifact, not something you have to boot
 * a server to see. `OpenApiGenerator` reads controller metadata directly, so
 * generation needs no HTTP listener, no database, and no environment — which
 * is what lets CI regenerate it and fail on an uncommitted diff.
 *
 * One controller list and one config, shared by the generator and the runtime
 * plugin. Both are exported because the two paths build the document
 * separately; a test asserts they produce the same bytes, since "we pass the
 * same config to both" is an assumption that silently rots otherwise.
 *
 * This file imports `@riktajs/swagger`, which the ADR-0002 boundary rule
 * confines to the HTTP binding layer. That is a deliberate, named exception
 * in `eslint.config.mjs`: the file exists solely to describe HTTP surface,
 * contains no domain logic, and would be deleted outright — not ported — if
 * the framework were ever replaced.
 */

export const API_CONTROLLERS = [TrackController, HealthController] as const;

const SECURITY_SCHEMES: Record<string, OpenApiSecurityScheme> = {
  sessionCookie: {
    type: "apiKey",
    in: "cookie",
    name: "better-auth.session_token",
    description:
      "Session cookie issued by /api/auth/sign-in/email. State-changing " +
      "auth routes additionally require an Origin header from " +
      "AUTH_TRUSTED_ORIGINS (CSRF protection).",
  },
};

export const OPENAPI_CONFIG: SwaggerConfig = {
  info: {
    title: "FlowGraph API",
    version: "0.1.0",
    description:
      "Visual set-planning for DJs. Tracks are nodes, transitions are " +
      "directed edges, and a set is a versioned path through the graph.\n\n" +
      "Every endpoint is scoped to the caller's workspace, derived from the " +
      "session cookie. Clients never choose a workspace.",
  },
  servers: [{ url: "http://127.0.0.1:4000", description: "Local development" }],
  tags: [
    { name: "Tracks", description: "The track library" },
    { name: "Health", description: "Liveness and readiness probes" },
  ],
  securitySchemes: SECURITY_SCHEMES,
};

export function generateOpenApiDocument(): OpenApiDocument {
  const generator = new OpenApiGenerator(OPENAPI_CONFIG);

  // Security schemes must also go through addSecurityScheme: passing them in
  // the constructor config alone is accepted silently but never reaches
  // `components`, producing operations that reference an undefined scheme.
  for (const [name, scheme] of Object.entries(SECURITY_SCHEMES)) {
    generator.addSecurityScheme(name, scheme);
  }

  return generator.addControllers([...API_CONTROLLERS]).generate();
}
