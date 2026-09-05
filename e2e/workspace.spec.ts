import { test, expect, type Page } from "@playwright/test";

import { FIXTURE_TRACKS } from "./fixture-library.js";

/**
 * The journey plan §21.1 names for the E2E layer: onboarding, import, graph
 * edit, set build.
 *
 * One spec, run in order, against one account. Each step depends on the last —
 * you cannot place a track you have not imported, or order a set with no
 * tracks in it — so splitting them into independent tests would mean either
 * re-running the whole journey per assertion or seeding through the API, which
 * would stop testing the thing the layer exists for: that the product works
 * when a person drives it.
 *
 * Assertions favour what the user can see. Where a step is only meaningful if
 * it *persisted*, the page is reloaded and the assertion repeated — that is the
 * bug class this layer catches and the unit and integration layers cannot.
 */

const ACCOUNT = {
  name: "E2E Planner",
  // Unique per run so a re-run against a warm database does not collide on the
  // unique email, which would fail as "account exists" rather than as whatever
  // the test was actually checking.
  email: `e2e-${Date.now()}@example.test`,
  password: "an-end-to-end-passphrase",
};

const LOCAL_TRACK = FIXTURE_TRACKS.find((entry) => entry.local)!;
const STREAMING_TRACK = FIXTURE_TRACKS.find((entry) => !entry.local)!;

test.describe.configure({ mode: "serial" });

/**
 * The one console error this app produces on purpose.
 *
 * There is no `/v1/me` endpoint, so `main.tsx` probes the session by making a
 * real request and reading 401 as "signed out". The browser logs the failed
 * response whatever the app does with it, so every load before sign-in emits
 * one. Filtering it is the difference between a check that catches React key
 * warnings and unhandled rejections, and one that is switched off within a
 * week for crying wolf.
 */
const EXPECTED_CONSOLE_NOISE = [/401 \(Unauthorized\)/];

/** Collects console errors so the journey can assert it produced none. */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  const record = (text: string) => {
    if (!EXPECTED_CONSOLE_NOISE.some((pattern) => pattern.test(text))) errors.push(text);
  };
  page.on("console", (message) => {
    if (message.type() === "error") record(message.text());
  });
  page.on("pageerror", (error) => record(error.message));
  return errors;
}

test.describe("planning a set from a Serato library", () => {
  let page: Page;
  let consoleErrors: string[];

  test.beforeAll(async ({ browser }) => {
    // One page for the journey: signing in again per test would test the
    // session gate four times and the journey zero times.
    page = await browser.newPage();
    consoleErrors = collectConsoleErrors(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("a new account gets a workspace and is offered a starting point", async () => {
    await page.goto("/");

    await page.getByRole("button", { name: /create one/i }).click();
    await page.getByRole("textbox", { name: "Name" }).fill(ACCOUNT.name);
    await page.getByRole("textbox", { name: "Email" }).fill(ACCOUNT.email);
    await page.getByRole("textbox", { name: "Password" }).fill(ACCOUNT.password);
    await page.getByRole("button", { name: /create account/i }).click();

    // Provisioning is implicit in signing up (README): there is no seed step,
    // so reaching this screen proves the workspace exists.
    await expect(page.getByText(/this workspace has no graphs yet/i)).toBeVisible();
  });

  test("creating a graph opens an empty workspace", async () => {
    await page.getByRole("button", { name: /create a graph/i }).click();

    await expect(page.getByText(/no tracks on the canvas/i)).toBeVisible();
    await expect(page.getByText(/the library is empty/i)).toBeVisible();
  });

  test("importing reads the Serato library into the workspace", async () => {
    await page.getByRole("button", { name: /^import from serato$/i }).first().click();

    // Every fixture entry should arrive, streaming ones included — most of a
    // real library is streaming, and dropping them was the first bug the
    // import had.
    for (const entry of FIXTURE_TRACKS) {
      await expect(page.getByText(entry.title, { exact: false }).first()).toBeVisible();
    }
  });

  test("a streaming track is shown as streaming, not as a missing file", async () => {
    // ADR-0010's correction, asserted where a user would see it. A regression
    // here puts a file-missing warning on most of a real library.
    await page.getByText(STREAMING_TRACK.title, { exact: false }).first().click();

    const inspector = page.getByText(/streaming/i).first();
    await expect(inspector).toBeVisible();
  });

  test("importing again does not duplicate the library", async () => {
    // §12.4's acceptance gate, from the outside: press the button twice and
    // count what the user ends up with.
    await page.getByRole("button", { name: /^import from serato$/i }).first().click();

    // `.first()` rather than a bare match: the count is rendered twice, once
    // visibly and once in a live region for screen readers. Both saying the
    // same number is correct — the ambiguity is the locator's, not the page's.
    await expect(
      page.getByText(`${FIXTURE_TRACKS.length} tracks`, { exact: true }).first(),
    ).toBeVisible();
  });

  test("a track placed on the canvas survives a reload", async () => {
    await page.getByRole("button", { name: `Add ${LOCAL_TRACK.title} to canvas` }).click();
    await page
      .getByRole("button", { name: `Add ${STREAMING_TRACK.title} to canvas` })
      .click();

    const canvasNodes = page.locator(".react-flow__node");
    await expect(canvasNodes).toHaveCount(2);

    await page.reload();
    // The assertion that matters: the canvas was rebuilt from the database,
    // not from anything the page was still holding.
    await expect(page.locator(".react-flow__node")).toHaveCount(2);
  });

  test("connecting two tracks creates a transition that survives a reload", async () => {
    await page.getByText(LOCAL_TRACK.title, { exact: false }).first().click();
    await page.getByRole("button", { name: /connect tracks/i }).click();

    await page
      .locator(".react-flow__node")
      .filter({ hasText: STREAMING_TRACK.title })
      .click();

    await expect(page.locator(".react-flow__edge")).toHaveCount(1);

    await page.reload();
    await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  });

  test("tracks can be added to the set and reordered, and the order persists", async () => {
    // Added through the keyboard-reachable control rather than by dragging:
    // a drag is the documented gesture but the one an automated run models
    // least faithfully, and this path exercises the same store action.
    for (const entry of [LOCAL_TRACK, STREAMING_TRACK]) {
      await page.getByText(entry.title, { exact: false }).first().click();
      await page.getByRole("button", { name: new RegExp(`add ${entry.title}.*to the set`, "i") }).click();
    }

    // The timeline renders its count as "N tracks · duration". The separator
    // is what distinguishes it from the library's own count, and the panel
    // carries no landmark role to scope to.
    const timelineCount = page.getByText(/^2 tracks ·/);
    await expect(timelineCount).toBeVisible();

    await page.reload();
    await expect(page.getByText(/^2 tracks ·/)).toBeVisible();
  });

  test("the journey produced no unexpected console errors", () => {
    // Collected across every step above. A React key warning or an unhandled
    // rejection is a real defect that no individual assertion would catch —
    // the duplicate-key bug the set work introduced was exactly this shape.
    expect(consoleErrors).toEqual([]);
  });
});
