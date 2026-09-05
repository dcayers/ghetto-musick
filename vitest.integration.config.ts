import { defineConfig } from "vitest/config";

/**
 * Integration and repository tests — plan §21.1.
 *
 * Separate from the unit config because these have a different cost and a
 * different prerequisite. The unit suite runs in about a second and needs
 * nothing; these need Docker and take tens of seconds, and folding them
 * together would make the fast feedback loop slow enough to stop using.
 *
 * Files run one at a time against the single shared database. Parallel
 * workers would truncate each other's rows mid-test, and giving each worker
 * its own container costs more than the parallelism returns at this size.
 */
export default defineConfig({
  test: {
    include: ["apps/**/*.integration.test.ts", "packages/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/generated/**"],
    globalSetup: ["apps/api/src/testing/postgres-setup.ts"],
    pool: "forks",
    fileParallelism: false,
    // Pulling and starting the image on a cold machine is slow, and a timeout
    // that fires during it reads as a test failure rather than a slow start.
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
