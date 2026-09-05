import "reflect-metadata";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { generateOpenApiDocument } from "../src/openapi.js";

/**
 * Writes the OpenAPI document to disk as a checked-in artifact.
 *
 * No server, no database, no environment — the generator reads controller
 * metadata only. That is what makes the CI diff check possible: regenerate,
 * and a non-empty `git diff` means someone changed the API contract without
 * committing it.
 *
 * Deterministic output matters as much as correctness here. A document whose
 * key order or formatting varied between runs would fail the diff check on
 * every unrelated commit, and the check would be switched off within a week.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const OUTPUT = join(REPO_ROOT, "openapi.json");

function main(): void {
  const document = generateOpenApiDocument();

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  const paths = Object.keys(document.paths ?? {});
  const operations = paths.reduce(
    (total, path) =>
      total +
      Object.keys((document.paths as Record<string, object>)[path] ?? {}).length,
    0,
  );

  console.log(
    `Wrote ${relative(REPO_ROOT, OUTPUT)} — ${paths.length} paths, ${operations} operations`,
  );
}

main();
