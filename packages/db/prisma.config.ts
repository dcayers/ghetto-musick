import { defineConfig } from "prisma/config";
import { config as loadDotenv } from "dotenv";

// Prisma 7 no longer reads .env implicitly, and no longer accepts `url` in the
// datasource block — connection configuration for Migrate lives here instead.
// See ADR-0008.
loadDotenv({ path: "../../.env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
