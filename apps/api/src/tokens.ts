/**
 * Dependency-injection tokens.
 *
 * Plain symbols, deliberately. Three constraints intersect here:
 *
 *  1. ADR-0002 rule 2 forbids importing `@riktajs/*` outside controllers and
 *     bootstrap, which rules out `InjectionToken` — it would have to be
 *     declared in bootstrap, and bootstrap already imports the controllers,
 *     so that would be circular.
 *  2. Using the service *class* as a token does not typecheck: Rikta's
 *     `Token<T>` requires `new (...args: unknown[]) => T`, and a constructor
 *     with typed parameters is not assignable to that (constructor parameter
 *     contravariance).
 *  3. `Token<T>` also admits `string | symbol`.
 *
 * Symbols satisfy all three. `Symbol.for` is used so a token remains stable
 * across module instances, which matters if the graph is ever loaded twice
 * (test harnesses, watch-mode reloads).
 */

export const TRACK_SERVICE = Symbol.for("flowgraph.TrackService");
export const HEALTH_SERVICE = Symbol.for("flowgraph.HealthService");
export const WORKSPACE_CONTEXT = Symbol.for("flowgraph.WorkspaceContextService");
