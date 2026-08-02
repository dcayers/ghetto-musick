import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import "reflect-metadata";
import { generateOpenApiDocument } from "./openapi.js";

/**
 * Contract quality gates — plan §8.9.
 *
 * "Every public operation has a Zod request schema, response schema, examples,
 * auth declaration, and documented error cases." These assert the parts a
 * machine can check, so the requirement is enforced rather than aspirational.
 *
 * Also pins the checked-in artifact to the generator. CI catches a stale
 * `openapi.json` via `git diff`, but that is slow feedback; failing here means
 * you find out before pushing.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const document = generateOpenApiDocument();

type Operation = {
  summary?: string;
  description?: string;
  responses?: Record<string, unknown>;
  security?: unknown[];
  parameters?: Array<{ name: string; in: string; required?: boolean }>;
  requestBody?: { content?: Record<string, { schema?: unknown }> };
};

const operations = Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
  Object.entries(item as Record<string, Operation>).map(([method, operation]) => ({
    id: `${method.toUpperCase()} ${path}`,
    path,
    method,
    operation,
  })),
);

/** Health probes are intentionally unauthenticated. */
const isPublic = (path: string) => path.startsWith("/health");

describe("OpenAPI document", () => {
  it("matches the checked-in artifact", () => {
    // A stale openapi.json means the generated client is stale too, and the
    // contract of record no longer describes the API.
    const committed = JSON.parse(
      readFileSync(join(REPO_ROOT, "openapi.json"), "utf8"),
    ) as unknown;

    expect(committed).toEqual(document);
  });

  it("documents a non-trivial number of operations", () => {
    // Guards the guard: an empty document would satisfy every check below.
    expect(operations.length).toBeGreaterThanOrEqual(5);
  });
});

describe("§8.9 contract gates", () => {
  it.each(operations)("$id has a summary and description", ({ operation }) => {
    expect(operation.summary?.length ?? 0).toBeGreaterThan(0);
    expect(operation.description?.length ?? 0).toBeGreaterThan(0);
  });

  it.each(operations)("$id documents a success response", ({ operation }) => {
    const codes = Object.keys(operation.responses ?? {});
    expect(codes.some((code) => code.startsWith("2"))).toBe(true);
  });

  it.each(operations.filter((o) => !isPublic(o.path)))(
    "$id declares authentication",
    ({ operation }) => {
      expect(operation.security?.length ?? 0).toBeGreaterThan(0);
    },
  );

  it.each(operations.filter((o) => !isPublic(o.path)))(
    "$id documents 401 and 403",
    ({ operation }) => {
      const codes = Object.keys(operation.responses ?? {});
      expect(codes).toContain("401");
      expect(codes).toContain("403");
    },
  );

  it.each(operations.filter((o) => o.method === "post" || o.method === "put"))(
    "$id documents a request body schema",
    ({ operation }) => {
      const schema = operation.requestBody?.content?.["application/json"]?.schema as
        | { properties?: Record<string, unknown> }
        | undefined;

      // Not merely present — populated. An empty schema object satisfies a
      // naive existence check while telling a client nothing.
      expect(Object.keys(schema?.properties ?? {}).length).toBeGreaterThan(0);
    },
  );

  it.each(operations.filter((o) => o.path.includes("{")))(
    "$id documents its path parameters",
    ({ path, operation }) => {
      const declared = (operation.parameters ?? [])
        .filter((p) => p.in === "path")
        .map((p) => p.name);

      for (const name of [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1])) {
        expect(declared).toContain(name);
      }
    },
  );
});

describe("security schemes", () => {
  it("defines every scheme an operation references", () => {
    // An operation referencing an undefined scheme produces a document that
    // fails validation and a client that cannot authenticate.
    const defined = Object.keys(
      (document.components as { securitySchemes?: Record<string, unknown> })
        ?.securitySchemes ?? {},
    );

    expect(defined.length).toBeGreaterThan(0);

    for (const { operation } of operations) {
      for (const requirement of operation.security ?? []) {
        for (const name of Object.keys(requirement as Record<string, unknown>)) {
          expect(defined).toContain(name);
        }
      }
    }
  });
});
