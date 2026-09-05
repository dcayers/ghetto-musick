import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    // Integration tests need Docker and take tens of seconds; they run
    // from `vitest.integration.config.ts` so this suite stays a
    // one-second loop worth running on every save.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/generated/**",
      "**/*.integration.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["packages/domain/src/**/*.ts"],
      exclude: ["**/index.ts"],
    },
  },
});
