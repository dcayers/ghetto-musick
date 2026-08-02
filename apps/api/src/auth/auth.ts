import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import type { PrismaClient } from "@flowgraph/db";

/**
 * Authentication — ADR-0004.
 *
 * better-auth is a first-party session service running against our own
 * Postgres: sessions, credentials, and OAuth account linking all live in the
 * same database and participate in the same migration discipline.
 *
 * A factory rather than a module-level singleton, because the PrismaClient is
 * constructed in `bootstrap.ts` and there must be exactly one of it.
 *
 * No framework imports here — this is not a controller.
 */

export interface AuthOptions {
  readonly prisma: PrismaClient;
  readonly secret: string;
  readonly baseUrl: string;
  readonly trustedOrigins: readonly string[];
  readonly isProduction: boolean;
  /**
   * Called after a user row is created. Provisions the personal workspace —
   * injected rather than inlined so the provisioning logic stays a testable
   * service (see workspace-provisioning.ts).
   */
  readonly onUserCreated: (user: {
    id: string;
    email: string;
    name?: string | null;
  }) => Promise<void>;
}

export function createAuth(options: AuthOptions) {
  return betterAuth({
    database: prismaAdapter(options.prisma, { provider: "postgresql" }),
    secret: options.secret,
    baseURL: options.baseUrl,
    trustedOrigins: [...options.trustedOrigins],

    /**
     * Email + password, deliberately — and a documented deviation from
     * ADR-0004's passwordless-first position.
     *
     * Passkeys need a browser to enrol and magic links need an email
     * transport; neither exists yet, and `apps/web` has not been built. Email
     * and password is the only flow that can be exercised end to end today,
     * which means it is the only one that can actually be verified.
     *
     * Revisit when the web app lands: add the passkey plugin, make it the
     * primary flow, and demote this to a fallback.
     */
    emailAndPassword: {
      enabled: true,
      // No mail transport yet, so requiring verification would lock every
      // account out on creation.
      requireEmailVerification: false,
      minPasswordLength: 12,
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh the expiry at most once a day
    },

    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await options.onUserCreated({
              id: user.id,
              email: user.email,
              name: user.name,
            });
          },
        },
      },
    },

    advanced: {
      // Plan §16.1: HttpOnly, SameSite=Lax, Secure outside development.
      // Secure cookies over plain http://localhost would never be sent, so
      // this is gated on the environment rather than hardcoded.
      useSecureCookies: options.isProduction,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
