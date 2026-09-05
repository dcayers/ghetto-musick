import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import { ESLint } from "eslint";

/**
 * ADR-0002 rule 2, enforced as a test — plan §21.3.
 *
 * `@riktajs/*` and Fastify may only be imported from `*.controller.ts` and
 * `bootstrap.ts`. This is what keeps the documented Rikta exit path a
 * days-long change rather than a rewrite, so it gets a test and not just a
 * lint rule.
 *
 * Two independent checks, because either alone is insufficient:
 *
 *   1. A static scan proves the tree is clean *right now*. It would still
 *      pass if someone deleted the ESLint rule.
 *   2. Linting a deliberately violating snippet proves the rule is still
 *      configured and would catch the *next* violation. It would still pass
 *      if the tree had already drifted.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

const SCAN_ROOTS = [join(REPO_ROOT, "apps"), join(REPO_ROOT, "packages")];

/**
 * The HTTP binding layer — the only files permitted to import the framework.
 * Kept in sync with `HTTP_BINDING_LAYER` in eslint.config.mjs.
 *
 * `openapi.ts` earns its place on the same test as the others: it exists only
 * to describe HTTP surface, holds no domain logic, and would be deleted rather
 * than ported if the framework changed.
 */
const ALLOWED = [
  /\.controller\.ts$/,
  /(^|[\\/])bootstrap\.ts$/,
  /(^|[\\/])openapi\.ts$/,
];

/**
 * This file is excluded from the static scan: it necessarily contains the
 * literal string "@riktajs/core" inside the violating snippet below, and a
 * source scanner cannot tell that from a real import.
 */
const SCAN_EXCLUDED = /framework-boundary\.test\.ts$/;

const FRAMEWORK_IMPORT =
  /(?:^|\n)\s*(?:import[\s\S]{0,200}?from\s*|import\s*|(?:const|let|var)[\s\S]{0,80}?=\s*require\s*\(\s*)["'](@riktajs\/[^"']*|fastify(?:\/[^"']*)?)["']/;

function collectTsFiles(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries.flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "generated") {
        return [];
      }
      return collectTsFiles(full);
    }
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [full] : [];
  });
}

describe("ADR-0002 framework containment", () => {
  const files = SCAN_ROOTS.flatMap(collectTsFiles);

  it("scans a non-trivial number of source files", () => {
    // Guards the guard: a broken path would make every assertion below
    // vacuously true.
    expect(files.length).toBeGreaterThan(10);
  });

  it("confines @riktajs/* and fastify imports to controllers and bootstrap", () => {
    const offenders = files
      .filter((file) => !SCAN_EXCLUDED.test(file))
      .filter((file) => !ALLOWED.some((pattern) => pattern.test(file)))
      .filter((file) => FRAMEWORK_IMPORT.test(readFileSync(file, "utf8")))
      .map((file) => relative(REPO_ROOT, file).split(sep).join("/"));

    expect(offenders).toEqual([]);
  });

  it("finds the allowlisted files that legitimately import the framework", () => {
    // If this drops to zero, the regex has stopped matching real imports and
    // the check above is no longer testing anything.
    const importers = files
      .filter((file) => ALLOWED.some((pattern) => pattern.test(file)))
      .filter((file) => FRAMEWORK_IMPORT.test(readFileSync(file, "utf8")));

    expect(importers.length).toBeGreaterThan(0);
  });
});

describe("ADR-0002 lint rule", () => {
  const violating = [
    'import { NotFoundException } from "@riktajs/core";',
    "export const value = NotFoundException;",
    "",
  ].join("\n");

  const lint = async (filePath: string) => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const [result] = await eslint.lintText(violating, { filePath, warnIgnored: false });
    return result?.messages ?? [];
  };

  it("rejects a framework import from a service", async () => {
    const messages = await lint(join(REPO_ROOT, "apps/api/src/tracks/probe.service.ts"));
    const restricted = messages.filter((m) => m.ruleId === "no-restricted-imports");

    expect(restricted.length).toBeGreaterThan(0);
    expect(restricted[0]?.message).toContain("ADR-0002 rule 2");
    expect(restricted[0]?.severity).toBe(2); // error, not warning
  });

  it("rejects a framework import from a shared package", async () => {
    const messages = await lint(join(REPO_ROOT, "packages/contracts/src/probe.ts"));

    expect(messages.some((m) => m.ruleId === "no-restricted-imports")).toBe(true);
  });

  it("allows the same import from a controller", async () => {
    const messages = await lint(join(REPO_ROOT, "apps/api/src/tracks/probe.controller.ts"));

    expect(messages.some((m) => m.ruleId === "no-restricted-imports")).toBe(false);
  });

  it("allows the same import from bootstrap", async () => {
    const messages = await lint(join(REPO_ROOT, "apps/api/src/bootstrap.ts"));

    expect(messages.some((m) => m.ruleId === "no-restricted-imports")).toBe(false);
  });

  it("allows the same import from the OpenAPI descriptor", async () => {
    const messages = await lint(join(REPO_ROOT, "apps/api/src/openapi.ts"));

    expect(messages.some((m) => m.ruleId === "no-restricted-imports")).toBe(false);
  });

  it("still rejects a near-miss filename", async () => {
    // The allowlist must match whole filenames, not substrings — an
    // `openapi-helpers.ts` full of domain logic must not slip through.
    const messages = await lint(join(REPO_ROOT, "apps/api/src/openapi-helpers.ts"));

    expect(messages.some((m) => m.ruleId === "no-restricted-imports")).toBe(true);
  });
});
