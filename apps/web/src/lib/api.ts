import { createFlowGraphClient, type TrackPage } from "@flowgraph/api-client";

/**
 * API access — plan §9.1.
 *
 * Every call goes through the client generated from `openapi.json`. Nothing
 * here hand-writes a request or response type: the plan forbids handwritten
 * duplicates because two sources of truth for a wire format drift silently
 * and only surface in production.
 *
 * Same-origin in development via the Vite proxy, so the session cookie rides
 * along without CORS or SameSite=None.
 */
export const api = createFlowGraphClient({
  baseUrl: import.meta.env.VITE_API_URL ?? "",
  credentials: "include",
});

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** True when the caller has no valid session — drives the sign-in gate. */
export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/**
 * The API could not be reached, or failed before it could answer.
 *
 * Distinguished from an ordinary request failure because the recovery is
 * completely different: nothing the user does inside the app will help, and
 * telling them their graphs failed to load when the server is not running
 * sends them looking for a problem with their data.
 *
 * A rejected `fetch` — no proxy, connection refused, CORS — never reaches our
 * wrappers, so it arrives as a `TypeError` rather than an `ApiError`.
 */
export function isUnreachable(error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 500 || error.status === 0;
  return error instanceof TypeError;
}

export async function listTracks(params?: {
  query?: string;
  limit?: number;
  cursor?: string;
}): Promise<TrackPage> {
  const { data, error, response } = await api.GET("/v1/tracks", {
    params: {
      query: {
        ...(params?.query ? { query: params.query } : {}),
        ...(params?.limit !== undefined ? { limit: params.limit } : {}),
        ...(params?.cursor ? { cursor: params.cursor } : {}),
      },
    },
  });

  if (error || !data) {
    throw new ApiError(
      typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : "Failed to load tracks",
      response.status,
    );
  }

  return data;
}

/**
 * Every track in the workspace.
 *
 * The library filters and sorts client-side over the full list, so it needs
 * all of it rather than a page. `limit` is capped at 100 by the contract, so
 * this walks the cursor — bounded, because an unbounded loop against a
 * paginated endpoint is a hang waiting for a large library. Past the cap the
 * library is simply short, which the caller can say.
 */
const TRACK_PAGE_SIZE = 100;
const MAX_TRACK_PAGES = 20;

export async function listAllTracks(): Promise<{
  items: TrackPage["items"];
  truncated: boolean;
}> {
  const items: TrackPage["items"] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_TRACK_PAGES; page += 1) {
    const result = await listTracks({
      limit: TRACK_PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });
    items.push(...result.items);
    if (!result.nextCursor) return { items, truncated: false };
    cursor = result.nextCursor;
  }

  return { items, truncated: true };
}

export interface SignInInput {
  email: string;
  password: string;
}

/**
 * better-auth routes are not in the OpenAPI document — they are mounted by
 * the auth library rather than declared by a Rikta controller — so these are
 * plain fetches.
 *
 * The `Origin` header is set by the browser automatically and must match
 * AUTH_TRUSTED_ORIGINS, or state-changing routes return 403. That is CSRF
 * protection, not a misconfiguration (ADR-0004).
 */
async function authRequestJson(path: string, body: unknown): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new ApiError(detail?.message ?? "Authentication failed", response.status);
  }
}

export const signIn = (input: SignInInput) =>
  authRequestJson("/api/auth/sign-in/email", input);

export const signUp = (input: SignInInput & { name: string }) =>
  authRequestJson("/api/auth/sign-up/email", input);

export const signOut = () => authRequestJson("/api/auth/sign-out", {});
