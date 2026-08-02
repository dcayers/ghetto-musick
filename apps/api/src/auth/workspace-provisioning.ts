import type { PrismaClient } from "@flowgraph/db";
import { WorkspaceRole } from "@flowgraph/db";
import { newId } from "@flowgraph/contracts";

/**
 * Personal workspace provisioning — plan §7.1.
 *
 * Every resource hangs off a Workspace, so a user without one can do nothing.
 * MVP creates exactly one personal workspace per user, at signup.
 *
 * Runs from better-auth's `databaseHooks.user.create.after`, injected as a
 * plain callback so this stays a testable service rather than logic embedded
 * in auth configuration.
 */

export interface NewUser {
  readonly id: string;
  readonly email: string;
  /**
   * Explicitly admits `undefined` as well as `null`: under
   * `exactOptionalPropertyTypes` an optional property is not the same as one
   * that may be passed as undefined, and better-auth can genuinely omit it.
   */
  readonly name?: string | null | undefined;
}

export class WorkspaceProvisioningService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Idempotent: returns the existing workspace if the user already has one.
   *
   * The hook can fire more than once in practice — a retried signup, a
   * replayed webhook — and duplicate personal workspaces would silently split
   * a user's library in two.
   */
  async provisionPersonalWorkspace(user: NewUser): Promise<string> {
    const existing = await this.prisma.workspaceMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { workspaceId: true },
    });

    if (existing) {
      return existing.workspaceId;
    }

    const workspaceId = newId();

    // One transaction: a workspace with no owner is unreachable, and a
    // membership pointing at a missing workspace violates the FK.
    await this.prisma.$transaction([
      this.prisma.workspace.create({
        data: { id: workspaceId, name: defaultWorkspaceName(user) },
      }),
      this.prisma.workspaceMember.create({
        data: {
          id: newId(),
          workspaceId,
          userId: user.id,
          role: WorkspaceRole.OWNER,
        },
      }),
    ]);

    return workspaceId;
  }
}

function defaultWorkspaceName(user: NewUser): string {
  const trimmed = user.name?.trim();
  return trimmed && trimmed.length > 0 ? `${trimmed}'s Library` : "Personal";
}
