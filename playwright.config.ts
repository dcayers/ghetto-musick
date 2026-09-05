import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests — plan §21.1.
 *
 * The stack (Postgres, API, Vite) is started by `e2e/global-setup.ts` rather
 * than by Playwright's `webServer`, because the web server's proxy target
 * depends on the API's port and `webServer` starts independently of global
 * setup. Fixed ports, deliberately off the development ones, so a run cannot
 * accidentally drive the dev stack.
 */
const WEB_PORT = 3310;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // The suite shares one database and one account namespace, so files running
  // in parallel would import into and reorder each other's workspaces.
  workers: 1,
  fullyParallel: false,
  // Startup dominates; a per-test timeout tight enough to catch a hang still
  // has to clear a cold Vite transform of the whole app.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? "list" : [["list"]],
  // A retry would hide a real flake behind a green run. If one of these is
  // unreliable it should be fixed or deleted.
  retries: 0,
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1400, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
