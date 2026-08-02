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
  "ADR-0002 rule 2: @riktajs/* and fastify may only be imported from the HTTP " +
  "binding layer — apps/api/src/**/*.controller.ts, apps/api/src/bootstrap.ts, " +
  "or apps/api/src/openapi.ts. Services accept plain interfaces; controllers " +
  "translate at the boundary.";

/**
 * The HTTP binding layer — the only files permitted to touch the framework.
 *
 * Each exists solely to bind HTTP to the application and holds no domain
 * logic, so each would be rewritten (or, for openapi.ts, deleted) rather than
 * ported if the framework were replaced. That is the test for admitting a
 * file here. Do not add anything that would need to *survive* a swap.
 */
const HTTP_BINDING_LAYER = [
  "apps/api/src/**/*.controller.ts",
  "apps/api/src/bootstrap.ts",
  "apps/api/src/openapi.ts",
];

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

  // Framework containment: everything under apps/api EXCEPT the binding layer.
  {
    files: ["apps/api/src/**/*.ts"],
    ignores: HTTP_BINDING_LAYER,
    rules: restrictedFrameworkImports,
  },

  // Framework containment: shared packages may never import the framework at all.
  {
    files: ["packages/**/*.ts"],
    rules: restrictedFrameworkImports,
  },
);
