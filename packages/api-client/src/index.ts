import createClient, { type Client } from "openapi-fetch";
import type { paths } from "./generated/schema.js";

/**
 * Generated API client — plan §5.3, §8.9.
 *
 * Types come from `openapi.json`, which is generated from the controllers and
 * checked in. Nothing here is hand-maintained: the plan explicitly forbids
 * handwritten duplicate request types, because two sources of truth for a
 * wire format drift silently and are only caught in production.
 *
 * `src/generated/` is gitignored and produced by `pnpm api-client:generate`.
 * The checked-in artifact is `openapi.json` — the contract itself. Committing
 * the derived client too would add a large mechanical diff to every contract
 * change without adding review signal.
 */

export type { paths, components } from "./generated/schema.js";

export type FlowGraphClient = Client<paths>;

export interface ClientOptions {
  readonly baseUrl: string;
  /**
   * Send cookies with requests. Required for anything authenticated — the
   * session is a cookie, and cross-origin fetch omits credentials by default.
   */
  readonly credentials?: RequestCredentials;
  readonly fetch?: typeof globalThis.fetch;
  readonly headers?: Record<string, string>;
}

export function createFlowGraphClient(options: ClientOptions): FlowGraphClient {
  return createClient<paths>({
    baseUrl: options.baseUrl,
    credentials: options.credentials ?? "include",
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
  });
}

/**
 * Convenience type aliases for the shapes callers touch most.
 *
 * Derived from the generated schema rather than restated, so a contract
 * change surfaces here as a type error instead of silently diverging.
 */
export type Track =
  paths["/v1/tracks/{trackId}"]["get"]["responses"][200]["content"]["application/json"];

export type TrackPage =
  paths["/v1/tracks"]["get"]["responses"][200]["content"]["application/json"];

export type CreateTrackBody = NonNullable<
  paths["/v1/tracks"]["post"]["requestBody"]
>["content"]["application/json"];
