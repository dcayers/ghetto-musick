import type { ZodType } from "zod";

/**
 * Widens a Zod schema for use in a route-parameter decorator position.
 *
 * Rikta's `@Body` / `@Query` / `@Param` decorators are generic over
 * `ZodType<T>`. Zod 4's `ZodType` is itself deeply generic, and inferring `T`
 * from a concrete `ZodObject` at the decorator position exceeds TypeScript's
 * type-instantiation depth:
 *
 *   error TS2589: Type instantiation is excessively deep and possibly infinite.
 *
 * Resolving the inference once here — where `T` is bound to a named type
 * rather than re-derived from the schema's full shape — keeps the decorator
 * position shallow. Runtime behaviour is unchanged: the same schema object is
 * passed through, and Rikta validates it via `.safeParse()`.
 */
export function validator<T>(schema: ZodType<T>): ZodType<T> {
  return schema;
}
