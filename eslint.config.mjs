// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Framework containment boundary — ADR-0002 rule 2.
 *
 * `@riktajs/*` and Fastify may only be imported from files that exist to bind
 * HTTP to the application: controllers and the bootstrap entrypoint. Everything
 * else — services, repositories, domain logic, contracts — stays framework
 * agnostic so the documented exit path in ADR-0002 stays cheap.
 *
 * This is the single most important rule in the codebase. Do not add
 * exceptions; move the code instead.
 */
const RIKTA_CONTAINMENT_MESSAGE =
  "ADR-0002 rule 2: @riktajs/* and fastify may only be imported from " +
  "apps/api/src/**/*.controller.ts or apps/api/src/bootstrap.ts. " +
  "Services accept plain interfaces; controllers translate at the boundary.";

const restrictedFrameworkImports = {
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          group: ["@riktajs/*", "@riktajs/**", "fastify", "fastify/*"],
          message: RIKTA_CONTAINMENT_MESSAGE,
        },
      ],
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/generated/**",
      "**/*.d.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // The prototype this repo replaced used `[key: string]: any` index
      // signatures on its two core domain types, which silently disabled
      // strict mode for the whole domain. Not again.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },

  // Framework containment: everything under apps/api EXCEPT controllers and bootstrap.
  {
    files: ["apps/api/src/**/*.ts"],
    ignores: ["apps/api/src/**/*.controller.ts", "apps/api/src/bootstrap.ts"],
    rules: restrictedFrameworkImports,
  },

  // Framework containment: shared packages may never import the framework at all.
  {
    files: ["packages/**/*.ts"],
    rules: restrictedFrameworkImports,
  },
);
