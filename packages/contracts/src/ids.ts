import { v7 as uuidv7, validate as uuidValidate, version as uuidVersion } from "uuid";
import { z } from "zod";

/**
 * UUIDv7 identifiers — ADR-0003.
 *
 * Generated application-side rather than by the database so IDs exist before
 * insert. That is what lets the web app mint a graph node ID for optimistic
 * rendering, and lets the desktop bridge generate IDs during an offline scan.
 *
 * UUIDv7 is time-ordered, which keeps inserts at the right edge of the B-tree
 * and makes an ID a valid cursor tiebreak.
 */
export function newId(): string {
  return uuidv7();
}

/** True only for a well-formed UUID that is specifically version 7. */
export function isUuidV7(value: string): boolean {
  return uuidValidate(value) && uuidVersion(value) === 7;
}

/**
 * Accepts any valid UUID, not just v7.
 *
 * Route params must not 404-by-validation on identifiers minted before a
 * version change, and better-auth (ADR-0004) owns some of its own ID formats.
 * Use `uuidV7Schema` where we are asserting our own generator's output.
 */
export const uuidSchema = z.uuid();

export const uuidV7Schema = z
  .string()
  .refine(isUuidV7, { message: "Expected a UUIDv7 identifier" });
