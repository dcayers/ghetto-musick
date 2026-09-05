import { z, type ZodType } from "zod";
import * as contracts from "@flowgraph/contracts";

/**
 * Restores `nullable` to a generated OpenAPI document.
 *
 * `@riktajs/swagger` 0.12.0 converts a Zod schema in two steps: it asks Zod
 * for OpenAPI 3.0 JSON Schema — which is already correct, `nullable: true`
 * and all — and then re-copies that result key by key through a whitelist.
 * The whitelist has no `nullable` entry, so the flag Zod got right is dropped
 * on the way out. `z.number().nullable()` reaches the document as
 * `{"type": "number"}`.
 *
 * The consequence is not cosmetic. `openapi-typescript` faithfully turns the
 * wrong document into `bpm: number`, and `packages/api-client` hands that to
 * callers who then crash on the null the API genuinely returns for a track
 * with no analysed tempo. `openapi.json` is the contract of record, so a
 * document that understates nullability is a contract that lies.
 *
 * Nothing else is lost, notably: unions still arrive as `anyOf`, and Rikta's
 * `OpenApiSchemaObject` type already declares `nullable`. This is a single
 * omitted whitelist entry, so the repair is correspondingly narrow — it adds
 * `nullable: true` back and touches nothing else.
 *
 * ## Why post-process rather than fix the source
 *
 * Rikta passes a plain OpenAPI object straight through, so the decorators
 * could be handed pre-converted schemas instead of Zod ones. That was
 * rejected: it means every `@ApiOkResponse` in every controller has to
 * remember the wrapper, and the day someone forgets, the field silently loses
 * its null again. Repairing the finished document cannot be forgotten.
 *
 * Forking or patching Rikta was rejected for the reason ADR-0002 gives:
 * the framework stays confined and replaceable. This file imports no
 * `@riktajs/*` — it operates on plain JSON — so it survives the exit path
 * that `openapi.ts` and the controllers would not.
 *
 * ## How a document node is matched to its schema
 *
 * The generator inlines schemas rather than emitting `components.schemas`, so
 * nothing in the document says which contract produced a given node. The
 * match is made by content instead: for each Zod contract, ask Zod for the
 * correct conversion, delete its `nullable` flags, and look for document
 * nodes equal to *that*. An exact whole-subtree match — types, formats,
 * patterns, enums, `required` lists, nested shape — is strong evidence the
 * node came from that schema, and it degrades safely: an unmatched node is
 * left untouched and its children are searched instead.
 *
 * Two contracts whose stripped forms collide but whose nullability differs
 * would make the match ambiguous, so that throws at generation time rather
 * than silently picking one. `openapi.test.ts` asserts the outcome on the
 * real document, which is what catches the case where the match stops
 * working entirely.
 */

type JsonObject = Record<string, unknown>;

/** OpenAPI 3.0 keys whose value is a single nested schema. */
const NESTED_SCHEMA = ["items", "not", "additionalProperties"] as const;

/** Keys whose value is an array of schemas. */
const NESTED_SCHEMA_LIST = ["allOf", "oneOf", "anyOf"] as const;

/** Keys whose value is a name-to-schema map. */
const NESTED_SCHEMA_MAP = ["properties"] as const;

const HTTP_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural rather than `instanceof`, matching how Rikta detects a schema.
 *
 * `@riktajs/core` bundles its own copy of Zod, so a class identity check is
 * unreliable across that boundary even though the workspace pins one version.
 */
function isZodSchema(value: unknown): value is ZodType {
  return (
    isJsonObject(value) &&
    ("_zod" in value || "_def" in value) &&
    typeof (value as { safeParse?: unknown }).safeParse === "function"
  );
}

/**
 * Converts a contract the way Rikta does, minus the lossy copy.
 *
 * The options mirror `zodToOpenApi`'s exactly, so the output differs from
 * what lands in the document only by the flags this file exists to restore.
 * Rikta additionally overrides `date` and `bigint`; no contract uses either
 * (timestamps are `z.iso.datetime()`, i.e. strings), so omitting it changes
 * nothing and leaves nothing to keep in sync.
 */
function toOpenApiSchema(schema: ZodType): JsonObject {
  return z.toJSONSchema(schema, {
    target: "openapi-3.0",
    unrepresentable: "any",
  }) as JsonObject;
}

/**
 * Applies `fn` to the schemas nested under `key`, leaving other values alone.
 *
 * Keyed on the schema keyword rather than walking every object, because a
 * `properties` map may legitimately contain a field *named* `items` or
 * `nullable`, and a blind walk would treat that field's schema as a keyword.
 */
function mapNested(
  key: string,
  value: unknown,
  fn: (schema: JsonObject) => JsonObject,
): unknown {
  if ((NESTED_SCHEMA as readonly string[]).includes(key)) {
    // `additionalProperties` is a schema or a boolean.
    return isJsonObject(value) ? fn(value) : value;
  }

  if ((NESTED_SCHEMA_LIST as readonly string[]).includes(key)) {
    return Array.isArray(value)
      ? value.map((entry) => (isJsonObject(entry) ? fn(entry) : entry))
      : value;
  }

  if ((NESTED_SCHEMA_MAP as readonly string[]).includes(key)) {
    if (!isJsonObject(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [
        name,
        isJsonObject(entry) ? fn(entry) : entry,
      ]),
    );
  }

  return value;
}

/** The nested schemas of one schema object, in no particular order. */
function nestedSchemas(schema: JsonObject): JsonObject[] {
  const found: JsonObject[] = [];

  for (const [key, value] of Object.entries(schema)) {
    mapNested(key, value, (child) => {
      found.push(child);
      return child;
    });
  }

  return found;
}

/** A deep copy with every `nullable` keyword removed — Rikta's output shape. */
function withoutNullable(schema: JsonObject): JsonObject {
  const result: JsonObject = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === "nullable") continue;
    result[key] = mapNested(key, value, withoutNullable);
  }

  return result;
}

/**
 * Order-insensitive identity for a schema.
 *
 * Rikta rebuilds objects key by key, so its output differs from Zod's in key
 * order while describing the same schema. Comparing sorted keys makes the
 * match immune to that, and to any future reordering.
 */
function canonicalise(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalise).join(",")}]`;
  }

  if (isJsonObject(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalise(value[key])}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

/**
 * Copies `nullable: true` from `source` onto the matching nodes of `target`.
 *
 * An overlay rather than a wholesale replacement: the document keeps the
 * shape and key order Rikta produced, and gains only the flags it dropped.
 * That keeps the diff in `openapi.json` to the added lines, which is what
 * makes the CI diff check readable.
 *
 * Safe to walk in parallel because the caller only reaches here after
 * establishing that the two are the same schema modulo `nullable`.
 */
function applyNullable(target: JsonObject, source: JsonObject): void {
  if (source.nullable === true) {
    target.nullable = true;
  }

  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = target[key];

    if ((NESTED_SCHEMA as readonly string[]).includes(key)) {
      if (isJsonObject(sourceValue) && isJsonObject(targetValue)) {
        applyNullable(targetValue, sourceValue);
      }
      continue;
    }

    if ((NESTED_SCHEMA_LIST as readonly string[]).includes(key)) {
      if (Array.isArray(sourceValue) && Array.isArray(targetValue)) {
        sourceValue.forEach((entry, index) => {
          const match = targetValue[index];
          if (isJsonObject(entry) && isJsonObject(match)) applyNullable(match, entry);
        });
      }
      continue;
    }

    if ((NESTED_SCHEMA_MAP as readonly string[]).includes(key)) {
      if (isJsonObject(sourceValue) && isJsonObject(targetValue)) {
        for (const [name, entry] of Object.entries(sourceValue)) {
          const match = targetValue[name];
          if (isJsonObject(entry) && isJsonObject(match)) applyNullable(match, entry);
        }
      }
    }
  }
}

interface Repair {
  /** Export name of the contract, used only in the ambiguity message. */
  readonly contract: string;
  /** The correct conversion, `nullable` flags intact. */
  readonly corrected: JsonObject;
}

/** Every Zod schema exported by `@flowgraph/contracts`. */
export function contractSchemas(): ZodType[] {
  // Widened to `unknown[]` first: the module's exports are a union of schemas,
  // types and helper functions, and a type predicate only narrows a `filter`
  // when its result extends the array's element type.
  const exported: unknown[] = Object.values(contracts);

  return exported.filter(isZodSchema);
}

/**
 * Indexes contracts by the shape Rikta would emit for them.
 *
 * Only contracts that actually contain a `nullable` are indexed. Everything
 * else needs no repair, and leaving it out keeps the keyspace to a handful of
 * large, highly distinctive object schemas — which is what makes an
 * accidental collision implausible rather than merely unlikely.
 */
function buildRepairIndex(schemas: Iterable<ZodType>): Map<string, Repair> {
  const index = new Map<string, Repair>();

  for (const [name, exported] of namedSchemas(schemas)) {
    const corrected = toOpenApiSchema(exported);
    const stripped = withoutNullable(corrected);
    const key = canonicalise(stripped);

    if (key === canonicalise(corrected)) continue; // no nullability to restore

    const existing = index.get(key);
    if (existing && canonicalise(existing.corrected) !== canonicalise(corrected)) {
      throw new Error(
        `Cannot restore nullability: contracts \`${existing.contract}\` and ` +
          `\`${name}\` produce the same OpenAPI schema but disagree about which ` +
          `fields are nullable, so a document node matching it is ambiguous. ` +
          `Give one of them a distinguishing field, or document it explicitly.`,
      );
    }

    index.set(key, { contract: name, corrected });
  }

  return index;
}

/** Pairs each schema with its export name, falling back to a positional one. */
function namedSchemas(schemas: Iterable<ZodType>): Array<[string, ZodType]> {
  const byIdentity = new Map<unknown, string>();
  for (const [name, exported] of Object.entries(contracts)) {
    if (isZodSchema(exported)) byIdentity.set(exported, name);
  }

  return [...schemas].map((schema, index) => [
    byIdentity.get(schema) ?? `schema#${index}`,
    schema,
  ]);
}

/**
 * The schema-valued positions of an OpenAPI document.
 *
 * Enumerated explicitly rather than found by a deep walk, so that an
 * `example` or a vendor extension that happens to look like a schema is never
 * mistaken for one.
 */
function schemaPositions(document: JsonObject): JsonObject[] {
  const found: JsonObject[] = [];

  const add = (value: unknown) => {
    if (isJsonObject(value)) found.push(value);
  };

  const addContent = (container: unknown) => {
    if (!isJsonObject(container)) return;
    const content = container.content;
    if (!isJsonObject(content)) return;
    for (const media of Object.values(content)) {
      if (isJsonObject(media)) add(media.schema);
    }
  };

  const paths = document.paths;
  if (isJsonObject(paths)) {
    for (const item of Object.values(paths)) {
      if (!isJsonObject(item)) continue;

      for (const [method, operation] of Object.entries(item)) {
        if (!HTTP_METHODS.has(method) || !isJsonObject(operation)) continue;

        if (Array.isArray(operation.parameters)) {
          for (const parameter of operation.parameters) {
            if (isJsonObject(parameter)) add(parameter.schema);
          }
        }

        addContent(operation.requestBody);

        if (isJsonObject(operation.responses)) {
          for (const response of Object.values(operation.responses)) {
            addContent(response);
          }
        }
      }
    }
  }

  const components = document.components;
  if (isJsonObject(components) && isJsonObject(components.schemas)) {
    for (const schema of Object.values(components.schemas)) add(schema);
  }

  return found;
}

function repairSchema(schema: JsonObject, index: Map<string, Repair>): void {
  const match = index.get(canonicalise(schema));

  if (match) {
    // The overlay covers the whole subtree, so there is nothing below to do.
    applyNullable(schema, match.corrected);
    return;
  }

  // No whole-schema match. The node may still *contain* one — an array of
  // tracks, or a response that wraps a contract in an envelope — so keep
  // descending rather than giving up here.
  for (const child of nestedSchemas(schema)) {
    repairSchema(child, index);
  }
}

/**
 * Returns `document` with the `nullable` flags Rikta dropped restored.
 *
 * Pure: the input is left untouched. Idempotent, so it is safe to run over an
 * already-repaired document.
 *
 * `schemas` defaults to every contract, which is what makes this
 * un-forgettable — a new `.nullable()` field is covered the moment it is
 * exported, with no registration step to skip. Tests pass their own.
 */
export function restoreNullability<T>(
  document: T,
  schemas: Iterable<ZodType> = contractSchemas(),
): T {
  const index = buildRepairIndex(schemas);
  const repaired = structuredClone(document);

  if (isJsonObject(repaired)) {
    for (const schema of schemaPositions(repaired)) {
      repairSchema(schema, index);
    }
  }

  return repaired;
}
