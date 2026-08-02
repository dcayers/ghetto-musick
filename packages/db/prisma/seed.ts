import { config as loadDotenv } from "dotenv";
import { createPrismaClient, WorkspaceRole } from "../src/index.js";
import { newId } from "@flowgraph/contracts";

loadDotenv({ path: "../../.env" });

/**
 * Development seed.
 *
 * Creates one user and one personal workspace, matching the MVP model where
 * each user owns exactly one workspace (plan §7.1). IDs are fixed so the
 * vertical slice and local requests have a stable `x-workspace-id` to send
 * until session-derived context lands with ADR-0004.
 */
const DEV_USER_ID = "01930000-0000-7000-8000-000000000001";
const DEV_WORKSPACE_ID = "01930000-0000-7000-8000-000000000002";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to seed");
  }

  const prisma = createPrismaClient({ databaseUrl });

  try {
    const user = await prisma.user.upsert({
      where: { id: DEV_USER_ID },
      create: {
        id: DEV_USER_ID,
        email: "dev@flowgraph.local",
        displayName: "Dev User",
      },
      update: {},
    });

    const workspace = await prisma.workspace.upsert({
      where: { id: DEV_WORKSPACE_ID },
      create: { id: DEV_WORKSPACE_ID, name: "Personal" },
      update: {},
    });

    await prisma.workspaceMember.upsert({
      where: {
        workspaceId_userId: { workspaceId: workspace.id, userId: user.id },
      },
      create: {
        id: newId(),
        workspaceId: workspace.id,
        userId: user.id,
        role: WorkspaceRole.OWNER,
      },
      update: {},
    });

    console.log(`Seeded user    ${user.id} (${user.email})`);
    console.log(`Seeded workspace ${workspace.id} (${workspace.name})`);
    console.log(`\nUse header:  x-workspace-id: ${workspace.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("Seed failed", error);
  process.exit(1);
});
