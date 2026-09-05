import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/generated/**"],
    coverage: {
      provider: "v8",
      include: ["packages/domain/src/**/*.ts"],
      exclude: ["**/index.ts"],
    },
  },
});
