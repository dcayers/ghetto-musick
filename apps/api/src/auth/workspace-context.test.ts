import { describe, it, expect } from "vitest";
import type { IncomingHttpHeaders } from "node:http";
import type { PrismaClient } from "@flowgraph/db";
import type { Auth } from "./auth.js";
import {
  WorkspaceContextService,
  UnauthenticatedError,
  NoWorkspaceError,
} from "./workspace-context.js";

/**
 * Workspace scope must come from the session and nothing else — plan §8, §16.2.
 *
 * These tests pin the property that made the `x-workspace-id` header unsafe:
 * a caller-supplied value must never influence which workspace is resolved.
 */

type Membership = { workspaceId: string; role: string; createdAt: Date };

function fakeAuth(userId: string | null): Auth {
  return {
    api: {
      getSession: async () => (userId ? { user: { id: userId }, session: {} } : null),
    },
  } as unknown as Auth;
}

function fakePrisma(memberships: Membership[]): PrismaClient {
  return {
    workspaceMember: {
      findFirst: async ({ where }: { where: { userId: string } }) => {
        void where;
        const sorted = [...memberships].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );
        return sorted[0] ?? null;
      },
    },
  } as unknown as PrismaClient;
}

const member = (workspaceId: string, createdAt: number): Membership => ({
  workspaceId,
  role: "OWNER",
  createdAt: new Date(createdAt),
});

const NO_HEADERS: IncomingHttpHeaders = {};

describe("WorkspaceContextService", () => {
  it("resolves the workspace from the session", async () => {
    const service = new WorkspaceContextService(
      fakeAuth("user_1"),
      fakePrisma([member("ws_1", 0)]),
    );

    const context = await service.resolve(NO_HEADERS);

    expect(context).toEqual({ userId: "user_1", workspaceId: "ws_1", role: "OWNER" });
  });

  it("rejects an unauthenticated caller", async () => {
    const service = new WorkspaceContextService(fakeAuth(null), fakePrisma([]));

    await expect(service.resolve(NO_HEADERS)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("rejects an authenticated user with no workspace", async () => {
    const service = new WorkspaceContextService(fakeAuth("user_1"), fakePrisma([]));

    await expect(service.resolve(NO_HEADERS)).rejects.toBeInstanceOf(NoWorkspaceError);
  });

  it("ignores a client-supplied x-workspace-id header entirely", async () => {
    // The whole point of this service. The header was the bypass: any caller
    // could name any workspace and the API would honour it.
    const service = new WorkspaceContextService(
      fakeAuth("user_1"),
      fakePrisma([member("ws_own", 0)]),
    );

    const context = await service.resolve({
      "x-workspace-id": "ws_someone_elses",
    } as IncomingHttpHeaders);

    expect(context.workspaceId).toBe("ws_own");
  });

  it("does not let a header authenticate an anonymous caller", async () => {
    const service = new WorkspaceContextService(
      fakeAuth(null),
      fakePrisma([member("ws_1", 0)]),
    );

    await expect(
      service.resolve({ "x-workspace-id": "ws_1" } as IncomingHttpHeaders),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("picks the earliest membership deterministically", async () => {
    // MVP is one workspace per user, but the query must not depend on row
    // order if a second membership ever appears.
    const service = new WorkspaceContextService(
      fakeAuth("user_1"),
      fakePrisma([member("ws_later", 5_000), member("ws_first", 1_000)]),
    );

    const context = await service.resolve(NO_HEADERS);

    expect(context.workspaceId).toBe("ws_first");
  });
});
