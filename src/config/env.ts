import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { z } from 'zod';

/**
 * Secrets can arrive as plain env vars or as *_FILE paths (docker secrets).
 * The file variant wins when both are present.
 */
const SECRET_FILE_KEYS = [
  'DB_PASSWORD',
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'ADMIN_PASSWORD',
] as const;

const portSchema = z.coerce.number().int().min(1).max(65_535);
const boolSchema = z.stringbool();

/**
 * How much of X-Forwarded-For Fastify may believe. The value decides which
 * address the throttler counts against and which one the audit trail records,
 * so it is a security setting, not plumbing.
 *
 * - `false`: trust nothing, correct when the app is reached directly.
 * - a list of addresses or CIDRs: trust only those to set the header. With
 *   the proxy or BFF on the same host, that is `127.0.0.1`.
 * - `true` is accepted for compatibility and should not be used in
 *   production: it trusts the whole chain, so any client can hand over an
 *   invented client IP and take somebody else's rate limit with it.
 * - a hop count (`1`, `2`) is refused. Fastify 5.12.1 stopped honouring it
 *   (GHSA-3m5p-2c4r-xxw2): a count cannot check who the immediate peer is,
 *   so a client that reaches the app directly could forge the header.
 *   Fastify now trusts nothing when handed a number, and a setting that
 *   quietly does nothing is worse than a failed boot.
 */
const HOP_COUNT_MESSAGE =
  'a hop count is not supported: fastify >= 5.12.1 trusts nothing when given ' +
  'a number (GHSA-3m5p-2c4r-xxw2). Use false, or list the proxy addresses ' +
  'or CIDRs that may set the header, e.g. 127.0.0.1';

// The digit check runs FIRST on purpose: z.stringbool() reads "1" as true,
// which would silently turn an old single-hop setting into the one value
// that trusts the whole chain.
const trustProxySchema = z
  .string()
  .refine((value) => !/^\d+$/.test(value.trim()), {
    error: HOP_COUNT_MESSAGE,
  })
  .pipe(
    z.union([
      z.stringbool(),
      z
        .string()
        .min(1)
        .transform((value) => value.split(',').map((part) => part.trim())),
    ]),
  );

// OpenSSL name of the P-256 curve ES256 signs with.
const ES256_CURVE = 'prime256v1';

/**
 * The keys are parsed at boot, not at the first signature: a truncated paste
 * or a private/public swap would otherwise only show up as a 500 on the first
 * login. createPublicKey happily derives a public key from a private PEM, so
 * the public slot is also pinned to the SPKI header.
 */
function isEs256Key(value: string, kind: 'private' | 'public'): boolean {
  if (kind === 'public' && !value.startsWith('-----BEGIN PUBLIC KEY')) {
    return false;
  }

  try {
    const key =
      kind === 'private' ? createPrivateKey(value) : createPublicKey(value);

    return (
      key.asymmetricKeyType === 'ec' &&
      key.asymmetricKeyDetails?.namedCurve === ES256_CURVE
    );
  } catch {
    return false;
  }
}

function pemSchema(kind: 'private' | 'public') {
  return z
    .string()
    .transform((value) => value.replaceAll('\\n', '\n').trim())
    .refine((value) => isEs256Key(value, kind), {
      error: `must be a PEM-encoded ES256 ${kind} key (P-256)`,
    });
}

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    // Loopback by default: only the Astro BFF talks to this API. The
    // production container overrides HOST to 0.0.0.0 to accept the port map.
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: portSchema.default(3125),
    APP_VERSION: z.string().default('0.0.0-dev'),
    TRUST_PROXY: trustProxySchema.default(false),
    BODY_LIMIT_BYTES: z.coerce.number().int().min(1_024).default(524_288),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .optional(),
    CORS_ORIGINS: z.string().default(''),
    SWAGGER_ENABLED: boolSchema.optional(),

    DB_HOST: z.string().min(1),
    DB_PORT: portSchema.default(5433),
    DB_USERNAME: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_DATABASE: z.string().min(1),
    DB_SSL: boolSchema.default(false),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    JWT_PRIVATE_KEY: pemSchema('private'),
    JWT_PUBLIC_KEY: pemSchema('public'),
    JWT_ACCESS_TTL_SEC: z.coerce.number().int().min(60).max(3_600).default(900),
    REFRESH_TOKEN_TTL_SEC: z.coerce
      .number()
      .int()
      .min(3_600)
      .default(14 * 86_400),

    AUTH_MAX_LOGIN_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
    AUTH_LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),

    // Keep this below the container memory limit so /health degrades before
    // the kernel OOM-kills the process.
    HEALTH_HEAP_LIMIT_MB: z.coerce.number().int().min(64).default(350),

    ADMIN_EMAIL: z.email().optional(),
    ADMIN_PASSWORD: z.string().min(12).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') {
      return;
    }

    const origins = splitOrigins(env.CORS_ORIGINS);

    if (origins.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'required in production (comma-separated origin allowlist)',
      });
    }

    if (origins.includes('*')) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: "must not contain '*' in production",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function splitOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function isSwaggerEnabled(env: Env): boolean {
  return env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production';
}

function resolveSecretFiles(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...raw };

  for (const key of SECRET_FILE_KEYS) {
    const filePath = raw[`${key}_FILE`];

    if (typeof filePath === 'string' && filePath.length > 0) {
      merged[key] = readFileSync(filePath, 'utf8').trim();
    }
  }

  return merged;
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(resolveSecretFiles(raw));

  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}

export function loadDotEnvIfPresent(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Production containers pass real env vars; there is no .env file.
  }
}

let cachedEnv: Env | undefined;

/** Single parse of process.env, shared by bootstrap, DI, and the ORM. */
export function getEnv(): Env {
  cachedEnv ??= validateEnv(process.env);

  return cachedEnv;
}
