import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@flowgraph/db";
import { WorkspaceProvisioningService } from "./workspace-provisioning.js";

/**
 * Personal workspace provisioning runs from better-auth's user-create hook.
 * Idempotency is the property that matters: the hook can fire more than once
 * (a retried signup, a replayed request), and duplicate personal workspaces
 * would silently split a user's library in two.
 */

interface FakeState {
  members: Array<{ workspaceId: string; userId: string; createdAt: Date }>;
  workspaces: Array<{ id: string; name: string }>;
  transactions: number;
}

function fakePrisma(state: FakeState) {
  return {
    workspaceMember: {
      findFirst: async ({ where }: { where: { userId: string } }) => {
        const found = state.members
          .filter((m) => m.userId === where.userId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
        return found ?? null;
      },
      create: ({ data }: { data: { workspaceId: string; userId: string } }) => ({
        __apply: () =>
          state.members.push({ ...data, createdAt: new Date(state.members.length) }),
      }),
    },
    workspace: {
      create: ({ data }: { data: { id: string; name: string } }) => ({
        __apply: () => state.workspaces.push(data),
      }),
    },
    $transaction: async (ops: Array<{ __apply: () => void }>) => {
      state.transactions += 1;
      for (const op of ops) op.__apply();
    },
  } as unknown as PrismaClient;
}

const emptyState = (): FakeState => ({ members: [], workspaces: [], transactions: 0 });

describe("WorkspaceProvisioningService", () => {
  it("creates a workspace and an owner membership", async () => {
    const state = emptyState();
    const service = new WorkspaceProvisioningService(fakePrisma(state));

    const workspaceId = await service.provisionPersonalWorkspace({
      id: "user_1",
      email: "dj@example.com",
      name: "Dewaun",
    });

    expect(state.workspaces).toHaveLength(1);
    expect(state.members).toHaveLength(1);
    expect(state.workspaces[0]?.id).toBe(workspaceId);
    expect(state.members[0]?.userId).toBe("user_1");
  });

  it("creates both rows in a single transaction", async () => {
    // A workspace with no owner is unreachable; a membership pointing at a
    // missing workspace violates the FK. Neither may exist alone.
    const state = emptyState();
    const service = new WorkspaceProvisioningService(fakePrisma(state));

    await service.provisionPersonalWorkspace({ id: "user_1", email: "a@b.c" });

    expect(state.transactions).toBe(1);
  });

  it("is idempotent — a second call creates nothing new", async () => {
    const state = emptyState();
    const service = new WorkspaceProvisioningService(fakePrisma(state));

    const first = await service.provisionPersonalWorkspace({ id: "user_1", email: "a@b.c" });
    const second = await service.provisionPersonalWorkspace({ id: "user_1", email: "a@b.c" });

    expect(second).toBe(first);
    expect(state.workspaces).toHaveLength(1);
    expect(state.members).toHaveLength(1);
    expect(state.transactions).toBe(1);
  });

  it("gives separate users separate workspaces", async () => {
    const state = emptyState();
    const service = new WorkspaceProvisioningService(fakePrisma(state));

    const alice = await service.provisionPersonalWorkspace({ id: "alice", email: "a@b.c" });
    const bob = await service.provisionPersonalWorkspace({ id: "bob", email: "b@b.c" });

    expect(alice).not.toBe(bob);
    expect(state.workspaces).toHaveLength(2);
  });

  it("mints a UUIDv7 workspace id", async () => {
    // ADR-0003: ids we generate are UUIDv7. better-auth's user ids are not,
    // which is exactly why the two must not be conflated.
    const state = emptyState();
    const service = new WorkspaceProvisioningService(fakePrisma(state));

    const id = await service.provisionPersonalWorkspace({ id: "user_1", email: "a@b.c" });

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("names the workspace after the user when a name is present", async () => {
    const state = emptyState();
    const service = new WorkspaceProvisioningService(fakePrisma(state));

    await service.provisionPersonalWorkspace({ id: "u", email: "a@b.c", name: "Dewaun" });

    expect(state.workspaces[0]?.name).toBe("Dewaun's Library");
  });

  it("falls back to a default name when the name is absent or blank", async () => {
    for (const name of [undefined, null, "   "]) {
      const state = emptyState();
      const service = new WorkspaceProvisioningService(fakePrisma(state));

      await service.provisionPersonalWorkspace({ id: "u", email: "a@b.c", name });

      expect(state.workspaces[0]?.name).toBe("Personal");
    }
  });
});
