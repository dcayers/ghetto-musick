import { z } from "zod";

/**
 * Runtime environment validation.
 *
 * Fails loudly at boot rather than producing an undefined connection string
 * that surfaces as a confusing error on first query.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().default("127.0.0.1"),
  // Signs session cookies. A weak value here undermines every session in the
  // system, so it is required and length-checked rather than defaulted.
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  AUTH_BASE_URL: z.string().default("http://127.0.0.1:4000"),
  // Comma-separated origins permitted to carry credentials (the web app).
  AUTH_TRUSTED_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),
  /**
   * Extra `_Serato_` directories to offer alongside the standard macOS ones.
   *
   * Comma-separated absolute paths. A DJ's library often lives on an external
   * drive, which is exactly the case `defaultSeratoRoots` misses — and it is
   * what lets an end-to-end test point the import at a fixture instead of
   * reading whatever is on the machine running it.
   */
  SERATO_ROOTS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((root) => root.trim())
        .filter((root) => root.length > 0),
    ),
  LOG_QUERIES: z
    .string()
    .optional()
    .transform((value) => value === "true"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return parsed.data;
}

export function isProduction(env: Env): boolean {
  return env.NODE_ENV === "production";
}
