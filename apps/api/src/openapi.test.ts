import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import "reflect-metadata";
import { z } from "zod";
import { generateOpenApiDocument } from "./openapi.js";
import { contractSchemas } from "./openapi-nullability.js";

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

/**
 * Nullability — the property `@riktajs/swagger` 0.12.0 silently drops.
 *
 * The generator converts a Zod schema by asking Zod for OpenAPI 3.0 JSON
 * Schema, which is correct, and then re-copying it through a whitelist that
 * has no `nullable` entry. `bpm: z.number().nullable()` arrived as
 * `{"type": "number"}`, `openapi-typescript` turned that into `bpm: number`,
 * and a client that trusted it crashed on the first track with no analysed
 * tempo. `openapi-nullability.ts` puts the flag back.
 *
 * These assertions are on the finished document rather than on that module,
 * because the failure that matters is not "the repair function is wrong" but
 * "the repair no longer reaches the document" — which is exactly what a Rikta
 * upgrade that changes its output shape would cause, with no other symptom.
 */

type SchemaNode = {
  type?: string;
  nullable?: boolean;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
};

const schemaAt = (path: string, method: string, code: string): SchemaNode =>
  (document.paths as Record<string, Record<string, {
    responses: Record<string, { content: Record<string, { schema: SchemaNode }> }>;
  }>>)[path]![method]!.responses[code]!.content["application/json"]!.schema;

const bodyAt = (path: string, method: string): SchemaNode =>
  (document.paths as Record<string, Record<string, {
    requestBody: { content: Record<string, { schema: SchemaNode }> };
  }>>)[path]![method]!.requestBody.content["application/json"]!.schema;

describe("nullable fields survive conversion", () => {
  it("marks a nullable track field nullable", () => {
    const track = schemaAt("/v1/tracks/{trackId}", "get", "200");

    expect(track.properties?.bpm).toEqual({ type: "number", nullable: true });
    expect(track.properties?.keySignature).toEqual({ type: "string", nullable: true });
    expect(track.properties?.timeSignature).toEqual({ type: "string", nullable: true });
  });

  it("marks a nullable transition field nullable", () => {
    const transition = schemaAt("/v1/transitions", "post", "201");

    expect(transition.properties?.notes?.nullable).toBe(true);
    expect(transition.properties?.score?.nullable).toBe(true);
    expect(transition.properties?.scoreAlgorithm?.nullable).toBe(true);
  });

  it("reaches a field nested inside a page of results", () => {
    // The repair has to descend, not just fix top-level response objects.
    const page = schemaAt("/v1/tracks", "get", "200");

    expect(page.properties?.nextCursor).toEqual({ type: "string", nullable: true });
    expect(page.properties?.items?.items?.properties?.bpm?.nullable).toBe(true);
  });

  it("reaches a field three levels down in the graph detail response", () => {
    const detail = schemaAt("/v1/graphs/{graphId}", "get", "200");

    expect(
      detail.properties?.nodes?.items?.properties?.track?.properties?.bpm?.nullable,
    ).toBe(true);
    expect(detail.properties?.transitions?.items?.properties?.notes?.nullable).toBe(true);
  });

  it("leaves a field the contract did not mark nullable alone", () => {
    // Over-application is the opposite failure and equally wrong: it tells
    // clients to handle a null the API never sends.
    const track = schemaAt("/v1/tracks/{trackId}", "get", "200");

    expect(track.properties?.title).toEqual({ type: "string" });
    expect(track.properties?.id?.nullable).toBeUndefined();
  });

  it("keeps optional distinct from nullable", () => {
    // `createTrackSchema.bpm` is `.optional()`, not `.nullable()` — absent is
    // allowed, explicit null is not. A repair keyed on field names rather than
    // schema shape would conflate the two and widen the request contract.
    expect(bodyAt("/v1/tracks", "post").properties?.bpm?.nullable).toBeUndefined();

    // Same name, same primitive type, opposite answer, in one document.
    expect(schemaAt("/v1/tracks", "post", "201").properties?.bpm?.nullable).toBe(true);
  });

  it("keeps a non-nullable score non-nullable beside a nullable one", () => {
    // `transitionSchema.score` is nullable; `transitionSuggestionSchema.score`
    // is not. Both are `score: number` on responses of the same document.
    const suggestion = schemaAt("/v1/transitions/suggestions", "get", "200");
    const suggested = suggestion.properties?.items?.items;

    expect(suggested?.properties?.score?.nullable).toBeUndefined();
    expect(suggested?.properties?.harmonicRelation?.nullable).toBe(true);
    expect(suggested?.properties?.pitchAdjustment?.nullable).toBe(true);
  });
});

/**
 * The same claim, derived from the contracts instead of hand-listed.
 *
 * The assertions above name fields, so they only cover what someone
 * remembered to name; a `.nullable()` added tomorrow is not among them. This
 * one reads the nullability out of every Zod contract and checks the document
 * agrees wherever that shape appears.
 *
 * It anchors on property names, deliberately *not* the way
 * `openapi-nullability.ts` anchors (whole-schema equality). A check that
 * matched the way the repair matches would fail only when the repair was
 * already failing loudly, and pass in the case that matters — the repair
 * quietly matching nothing at all.
 */

type NullableByShape = Map<string, Set<string>>;

/** Recursively: object shape (its sorted field names) → its nullable fields. */
function collectShapes(node: unknown, into: NullableByShape, conflicts: Set<string>): void {
  if (Array.isArray(node)) {
    for (const entry of node) collectShapes(entry, into, conflicts);
    return;
  }
  if (typeof node !== "object" || node === null) return;

  const schema = node as SchemaNode & Record<string, unknown>;
  const properties = schema.properties;

  if (properties && typeof properties === "object") {
    const signature = Object.keys(properties).sort().join(",");
    const nullable = new Set(
      Object.entries(properties)
        .filter(([, value]) => (value as SchemaNode)?.nullable === true)
        .map(([name]) => name),
    );

    const existing = into.get(signature);
    if (existing && !setsEqual(existing, nullable)) {
      // Two shapes share field names but disagree — the signature cannot
      // decide between them, so it is excluded rather than asserted wrongly.
      conflicts.add(signature);
    } else {
      into.set(signature, nullable);
    }

    for (const value of Object.values(properties)) collectShapes(value, into, conflicts);
  }

  for (const key of ["items", "not", "additionalProperties", "allOf", "oneOf", "anyOf"]) {
    if (key in schema) collectShapes(schema[key], into, conflicts);
  }
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

/** Every request-body and response schema the document declares. */
function documentSchemas(): unknown[] {
  return operations.flatMap(({ operation }) => [
    operation.requestBody?.content?.["application/json"]?.schema,
    ...Object.values(operation.responses ?? {}).map(
      (response) =>
        (response as { content?: Record<string, { schema?: unknown }> }).content?.[
          "application/json"
        ]?.schema,
    ),
  ]);
}

describe("nullability matches the Zod contracts", () => {
  const conflicts = new Set<string>();

  const expected: NullableByShape = new Map();
  for (const schema of contractSchemas()) {
    collectShapes(
      z.toJSONSchema(schema, { target: "openapi-3.0", unrepresentable: "any" }),
      expected,
      conflicts,
    );
  }

  const actual: NullableByShape = new Map();
  for (const schema of documentSchemas()) collectShapes(schema, actual, new Set());

  it("finds shapes on both sides", () => {
    // Guards the guard: two empty maps agree about everything.
    expect(expected.size).toBeGreaterThan(5);
    expect(actual.size).toBeGreaterThan(5);
  });

  it("declares at least one nullable field, from more than one contract", () => {
    // The contracts really do use `.nullable()`; if this ever reads zero, the
    // agreement check below has become vacuous.
    const declared = [...expected.values()].filter((fields) => fields.size > 0);

    expect(declared.length).toBeGreaterThan(1);
  });

  it("marks every field the contracts declare nullable, and no others", () => {
    const disagreements = [...actual]
      .filter(([signature]) => !conflicts.has(signature) && expected.has(signature))
      .map(([signature, fields]) => ({
        shape: signature,
        document: [...fields].sort(),
        contract: [...expected.get(signature)!].sort(),
      }))
      .filter(({ document: inDocument, contract }) => inDocument.join() !== contract.join());

    expect(disagreements).toEqual([]);
  });
});
