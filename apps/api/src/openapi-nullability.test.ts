import { describe, it, expect } from "vitest";
import { z } from "zod";

import { restoreNullability, contractSchemas } from "./openapi-nullability.js";

/**
 * Unit tests for the nullability repair — the generic behaviour, on schemas
 * this file owns.
 *
 * `openapi.test.ts` asserts the outcome on the real document; this asserts
 * the mechanism, including the cases the real contracts happen not to contain
 * (a field named `nullable`, an ambiguous pair, an unrecognised schema).
 *
 * Every "as emitted" fixture below is literally what `@riktajs/swagger`
 * 0.12.0 produces for the schema above it — the correct OpenAPI 3.0
 * conversion with the `nullable` flags deleted. They are written out rather
 * than derived so the defect being repaired stays visible in the test.
 */

const widget = z.object({ id: z.string(), size: z.number().nullable() });

const widgetAsEmitted = {
  type: "object",
  required: ["id", "size"],
  properties: { id: { type: "string" }, size: { type: "number" } },
  additionalProperties: false,
};

const page = z.object({ items: z.array(widget), nextCursor: z.string().nullable() });

const pageAsEmitted = {
  type: "object",
  required: ["items", "nextCursor"],
  properties: {
    items: { type: "array", items: widgetAsEmitted },
    nextCursor: { type: "string" },
  },
  additionalProperties: false,
};

/** A response document shaped the way the generator emits one. */
function responseDocument(schema: unknown, extras: Record<string, unknown> = {}) {
  return {
    openapi: "3.0.3",
    paths: {
      "/things": {
        get: {
          responses: {
            "200": { content: { "application/json": { schema, ...extras } } },
          },
        },
      },
    },
  };
}

type SchemaNode = {
  type?: string;
  nullable?: boolean;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
};

/** The repaired response schema of the single operation above. */
function repairedSchema(document: unknown): SchemaNode {
  const paths = (document as { paths: Record<string, Record<string, {
    responses: Record<string, { content: Record<string, { schema: SchemaNode }> }>;
  }>> }).paths;

  return paths["/things"]!.get!.responses["200"]!.content["application/json"]!.schema;
}

describe("restoreNullability", () => {
  it("restores a flag the generator dropped", () => {
    const repaired = repairedSchema(
      restoreNullability(responseDocument(widgetAsEmitted), [widget]),
    );

    expect(repaired.properties?.size).toEqual({ type: "number", nullable: true });
  });

  it("leaves a field the contract did not mark nullable alone", () => {
    // Over-application is the opposite failure and just as wrong: it would
    // tell clients to handle a null the API never sends.
    const repaired = repairedSchema(
      restoreNullability(responseDocument(widgetAsEmitted), [widget]),
    );

    expect(repaired.properties?.id).toEqual({ type: "string" });
  });

  it("reaches a schema nested inside an array", () => {
    // The failure this guards is a repair that only fixes top-level response
    // objects — every paginated list would keep lying about its items.
    const repaired = repairedSchema(
      restoreNullability(responseDocument(pageAsEmitted), [page]),
    );

    expect(repaired.properties?.nextCursor?.nullable).toBe(true);
    expect(repaired.properties?.items?.items?.properties?.size?.nullable).toBe(true);
  });

  it("finds a nested contract even when the schema wrapping it is unknown", () => {
    // Only `widget` is registered, so the envelope matches nothing and the
    // walk has to keep descending rather than give up at the top.
    const repaired = repairedSchema(
      restoreNullability(responseDocument(pageAsEmitted), [widget]),
    );

    expect(repaired.properties?.items?.items?.properties?.size?.nullable).toBe(true);
    // `page` itself was never registered, so its own nullable field stays lost.
    expect(repaired.properties?.nextCursor?.nullable).toBeUndefined();
  });

  it("does not mistake a field named `nullable` for the keyword", () => {
    // A property may legitimately be called `nullable` or `items`. Treating a
    // `properties` entry as a schema keyword would delete the field on the way
    // in and mark the wrong thing on the way out.
    const oddly = z.object({ nullable: z.string(), items: z.number().nullable() });
    const oddlyAsEmitted = {
      type: "object",
      required: ["nullable", "items"],
      properties: { nullable: { type: "string" }, items: { type: "number" } },
      additionalProperties: false,
    };

    const repaired = repairedSchema(
      restoreNullability(responseDocument(oddlyAsEmitted), [oddly]),
    );

    expect(repaired.properties?.items).toEqual({ type: "number", nullable: true });
    expect(repaired.properties?.nullable).toEqual({ type: "string" });
  });

  it("leaves a schema no contract accounts for untouched", () => {
    const document = responseDocument({ type: "string" });

    expect(restoreNullability(document, [widget])).toEqual(document);
  });

  it("repairs request bodies and component schemas as well as responses", () => {
    const document = {
      openapi: "3.0.3",
      paths: {
        "/things": {
          post: {
            requestBody: {
              content: { "application/json": { schema: structuredClone(widgetAsEmitted) } },
            },
            responses: {},
          },
        },
      },
      components: { schemas: { Widget: structuredClone(widgetAsEmitted) } },
    };

    const repaired = restoreNullability(document, [widget]) as typeof document;

    expect(
      repaired.paths["/things"].post.requestBody.content["application/json"].schema
        .properties.size,
    ).toEqual({ type: "number", nullable: true });
    expect(repaired.components.schemas.Widget.properties.size).toEqual({
      type: "number",
      nullable: true,
    });
  });

  it("ignores a response example that happens to look like a schema", () => {
    // Only schema positions are visited. A deep walk would rewrite payloads
    // and examples, which are data rather than descriptions of data.
    const example = structuredClone(widgetAsEmitted);
    const repaired = restoreNullability(
      responseDocument({ type: "string" }, { example }),
      [widget],
    ) as unknown as {
      paths: Record<string, Record<string, {
        responses: Record<string, { content: Record<string, { example: unknown }> }>;
      }>>;
    };

    expect(
      repaired.paths["/things"]!.get!.responses["200"]!.content["application/json"]!.example,
    ).toEqual(widgetAsEmitted);
  });

  it("does not mutate the document it is given", () => {
    const document = responseDocument(structuredClone(widgetAsEmitted));
    const before = structuredClone(document);

    restoreNullability(document, [widget]);

    expect(document).toEqual(before);
  });

  it("is idempotent", () => {
    const once = restoreNullability(responseDocument(widgetAsEmitted), [widget]);
    const twice = restoreNullability(once, [widget]);

    expect(twice).toEqual(once);
  });

  it("refuses to guess between two contracts that emit the same schema", () => {
    // Same stripped shape, different nullability: a document node matching it
    // could have come from either, so picking one silently would mislabel a
    // field. Loud at generation time is the only safe answer.
    const left = z.object({ x: z.string().nullable(), y: z.string() });
    const right = z.object({ x: z.string(), y: z.string().nullable() });

    expect(() => restoreNullability(responseDocument({}), [left, right])).toThrow(
      /disagree about which fields are nullable/,
    );
  });
});

describe("contract discovery", () => {
  it("finds the exported contracts, so a new one needs no registration", () => {
    // Guards the guard: if this returned nothing, every assertion about the
    // real document would be repairing an empty index.
    expect(contractSchemas().length).toBeGreaterThan(10);
  });
});
