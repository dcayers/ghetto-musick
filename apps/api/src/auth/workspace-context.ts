import type { IncomingHttpHeaders } from "node:http";
import { fromNodeHeaders } from "better-auth/node";
import type { PrismaClient } from "@flowgraph/db";
import type { Auth } from "./auth.js";

/**
 * Session-derived workspace context — plan §8, §16.2.
 *
 * Replaces the `x-workspace-id` header stub. Plan §8 requires every endpoint
 * be scoped from the authenticated context, with clients never choosing an
 * owner id; a header the caller controls is precisely the thing that rule
 * exists to forbid.
 *
 * Framework-agnostic: takes plain Node headers, returns a plain object, and
 * throws domain errors that controllers translate into status codes.
 */

export class UnauthenticatedError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "UnauthenticatedError";
  }
}

export class NoWorkspaceError extends Error {
  constructor(public readonly userId: string) {
    super(`User ${userId} has no workspace`);
    this.name = "NoWorkspaceError";
  }
}

export interface WorkspaceContext {
  readonly userId: string;
  readonly workspaceId: string;
  readonly role: string;
}

export class WorkspaceContextService {
  constructor(
    private readonly auth: Auth,
    private readonly prisma: PrismaClient,
  ) {}

  /**
   * Resolves the caller's workspace, or throws.
   *
   * MVP assumes one workspace per user (§7.1). When multiple memberships
   * exist this takes the earliest, which is the personal workspace created at
   * signup — deterministic rather than arbitrary. A real workspace switcher
   * replaces this, and should read an explicit selection that is *validated
   * against membership*, never trusted from the request.
   */
  async resolve(headers: IncomingHttpHeaders): Promise<WorkspaceContext> {
    const session = await this.auth.api.getSession({
      headers: fromNodeHeaders(headers),
    });

    if (!session?.user) {
      throw new UnauthenticatedError();
    }

    const membership = await this.prisma.workspaceMember.findFirst({
      where: { userId: session.user.id },
      orderBy: { createdAt: "asc" },
      select: { workspaceId: true, role: true },
    });

    if (!membership) {
      throw new NoWorkspaceError(session.user.id);
    }

    return {
      userId: session.user.id,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };
  }
}
