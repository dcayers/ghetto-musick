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
