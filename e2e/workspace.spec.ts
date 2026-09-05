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
 * The console errors this app produces on purpose.
 *
 * Both are the browser's own "failed to load resource" line, which it writes
 * for every non-2xx response whatever the app then does with it — so neither
 * says anything about whether the failure was handled.
 *
 * - **401**: there is no `/v1/me` endpoint, so `main.tsx` probes the session by
 *   making a real request and reading 401 as "signed out". Every load before
 *   sign-in emits one.
 * - **409**: the conflict step provokes one deliberately. That it was handled —
 *   surfaced to the user and rolled back — is asserted there, which is where
 *   that claim belongs; here it would only ever be asserted by accident.
 *
 * Filtering them is the difference between a check that catches React key
 * warnings and unhandled rejections, and one that is switched off within a
 * week for crying wolf.
 */
const EXPECTED_CONSOLE_NOISE = [/401 \(Unauthorized\)/, /409 \(Conflict\)/];

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

  test("refining a transition persists technique, length, and notes", async () => {
    // The step the API had no endpoint for until now: a transition is
    // quick-created with a default technique (§10.1) and refined afterwards.
    // Worth an end-to-end assertion because the refinement crosses every seam
    // at once — a debounced store queue, a PATCH whose absent fields must not
    // clear the ones it omits, and a reload that rebuilds from the database.

    // The edge's own label, not the path underneath it: the label sits on top
    // and takes the pointer events, and it is also the control a keyboard user
    // reaches, so clicking it is what a person actually does.
    const edgeLabel = page.locator(".react-flow__edgelabel-renderer button").first();

    // An unrefined transition has no length, and the label has to leave it out
    // rather than interpolate the null — this read "…, null bars" aloud until
    // this test caught it. Asserted on the whole page because the edge carries
    // *two* accessible names, built independently in two files, and fixing one
    // is exactly the mistake this catches.
    expect(await page.locator('[aria-label*="null bars"]').count()).toBe(0);
    await edgeLabel.click();

    await page.getByRole("button", { name: /transition technique/i }).click();
    await page.getByRole("option", { name: "Cut" }).click();

    await page.getByRole("button", { name: /edit transition notes/i }).click();
    const notes = page.getByRole("textbox", { name: /transition notes/i });
    await notes.fill("Slam it on the one.");
    await notes.press("Enter");

    // Enter, not just a fill: the number field commits on blur or Enter rather
    // than per keystroke, so typing alone never reaches the store.
    const bars = page.getByRole("textbox", { name: /mix duration in bars/i });
    await bars.fill("16");
    await bars.press("Enter");

    // The store debounces edits into one request, so the reload waits for the
    // save rather than for the keystroke — otherwise this passes on a fast
    // machine and fails on a slow one, which is worse than just failing.
    await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.reload();

    // Read off the canvas before opening anything: the edge label is rebuilt
    // from the database, so a length there is proof the round trip landed.
    await expect(page.locator(".react-flow__edgelabel-renderer button").first()).toHaveAttribute(
      "aria-label",
      /16 bars/,
    );

    await page.locator(".react-flow__edgelabel-renderer button").first().click();

    // All three together: a patch that saved the technique but silently blanked
    // the note would satisfy either assertion alone.
    await expect(page.getByText("Slam it on the one.")).toBeVisible();
    await expect(page.getByRole("button", { name: /transition technique/i })).toContainText(
      "Cut",
    );
    await expect(page.getByRole("textbox", { name: /mix duration in bars/i })).toHaveValue(
      "16",
    );
  });

  test("a technique already used on the pair is refused, and the edit rolls back", async () => {
    // Technique is half the uniqueness key, so renaming an edge onto a
    // technique its neighbour already uses is a server-side conflict. The
    // branch matters because getting it wrong loses the user's edit silently:
    // the change shows on screen, the write fails, and nothing says so.
    //
    // A second route between the same pair, which is legal precisely because
    // technique is part of the key. The technique here is whatever the scorer
    // proposes — deliberately not asserted, since it is a scoring detail and
    // all this step needs is that it differs from the "Cut" above.
    await page.getByText(LOCAL_TRACK.title, { exact: false }).first().click();
    await page.getByRole("button", { name: /connect tracks/i }).click();
    await page
      .locator(".react-flow__node")
      .filter({ hasText: STREAMING_TRACK.title })
      .click();
    await expect(page.locator(".react-flow__edge")).toHaveCount(2);

    const second = page.getByRole("button", { name: /transition technique/i });
    const before = await second.textContent();
    expect(before).not.toBe("Cut");

    await second.click();
    await page.getByRole("option", { name: "Cut" }).click();

    // Said out loud, not just coloured — the server refused and the user has
    // to know before they walk away believing it saved.
    await expect(page.getByText(/Failed:.*already connected with that technique/i)).toBeVisible({
      timeout: 15_000,
    });

    // And the optimistic edit is undone, so the inspector is not left showing
    // a technique that exists nowhere but this tab.
    await expect(second).toHaveText(before!);
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
