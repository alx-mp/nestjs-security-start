import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { validateEnv } from './env';

// Real material: the schema parses the keys, so a placeholder string would
// only prove that the placeholder is rejected.
const keys = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const PRIVATE_PEM = keys.privateKey.trim();
const PUBLIC_PEM = keys.publicKey.trim();

/** Minimal raw env that passes validation, before any test-specific tweaks. */
function baseEnv(): Record<string, unknown> {
  return {
    DB_HOST: '127.0.0.1',
    DB_USERNAME: 'eduia',
    DB_PASSWORD: 'db-password',
    DB_DATABASE: 'eduia',
    JWT_PRIVATE_KEY: PRIVATE_PEM,
    JWT_PUBLIC_KEY: PUBLIC_PEM,
  };
}

describe('validateEnv', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'eduia-env-spec-'));

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects a production env with empty CORS_ORIGINS', () => {
    const raw = { ...baseEnv(), NODE_ENV: 'production', CORS_ORIGINS: '' };

    expect(() => validateEnv(raw)).toThrow(/CORS_ORIGINS/);
    expect(() => validateEnv(raw)).toThrow(/required in production/);
  });

  it("rejects '*' inside CORS_ORIGINS in production", () => {
    const raw = {
      ...baseEnv(),
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://app.example.com, *',
    };

    expect(() => validateEnv(raw)).toThrow(/must not contain '\*'/);
  });

  // Which address the throttler counts and the audit trail records depends on
  // this. A bare number used to mean proxy hops; fastify >= 5.12.1 ignores
  // it, and z.stringbool() would read "1" as true, which trusts the whole
  // forwarded chain: any client could then hand over an invented IP and spend
  // somebody else's rate limit. So a hop count has to fail the boot.
  describe('TRUST_PROXY', () => {
    const parse = (value: string): unknown =>
      validateEnv({ ...baseEnv(), TRUST_PROXY: value }).TRUST_PROXY;

    it('refuses a hop count instead of reading it as "true"', () => {
      for (const hops of ['0', '1', '2', ' 1 ']) {
        expect(() => parse(hops)).toThrow(/hop count is not supported/);
      }
    });

    it('says what to use instead of a hop count', () => {
      expect(() => parse('1')).toThrow(/TRUST_PROXY/);
      expect(() => parse('1')).toThrow(
        /Use false, or list the proxy addresses/,
      );
    });

    it('still understands the booleans', () => {
      expect(parse('false')).toBe(false);
      expect(parse('true')).toBe(true);
    });

    it('takes a list of proxies that may set the header', () => {
      expect(parse('10.0.0.1, 10.0.0.2')).toEqual(['10.0.0.1', '10.0.0.2']);
    });

    it('trusts nothing by default', () => {
      expect(validateEnv(baseEnv()).TRUST_PROXY).toBe(false);
    });
  });

  it('applies defaults in development', () => {
    const env = validateEnv(baseEnv());

    expect(env.NODE_ENV).toBe('development');
    expect(env.HOST).toBe('127.0.0.1');
    expect(env.PORT).toBe(3125);
    expect(env.DB_PORT).toBe(5433);
    expect(env.TRUST_PROXY).toBe(false);
    expect(env.BODY_LIMIT_BYTES).toBe(524_288);
    expect(env.CORS_ORIGINS).toBe('');
    expect(env.JWT_ACCESS_TTL_SEC).toBe(900);
    expect(env.REFRESH_TOKEN_TTL_SEC).toBe(14 * 86_400);
    expect(env.AUTH_MAX_LOGIN_ATTEMPTS).toBe(5);
    expect(env.AUTH_LOCKOUT_MINUTES).toBe(15);
  });

  it('resolves *_FILE secrets and lets the file win over the plain var', () => {
    const secretPath = join(tempDir, 'db-password');
    writeFileSync(secretPath, 'secret-from-file\n', 'utf8');

    const env = validateEnv({
      ...baseEnv(),
      DB_PASSWORD: 'plain-var-loses',
      DB_PASSWORD_FILE: secretPath,
    });

    // Trailing newline from the file must be trimmed away.
    expect(env.DB_PASSWORD).toBe('secret-from-file');
  });

  it('rejects JWT keys that are not PEM encoded', () => {
    const raw = { ...baseEnv(), JWT_PRIVATE_KEY: 'clearly-not-a-pem-key' };

    expect(() => validateEnv(raw)).toThrow(/PEM/);
  });

  it('rejects a truncated PEM key that still carries the BEGIN header', () => {
    const truncated = `${PRIVATE_PEM.slice(0, 60)}\n-----END PRIVATE KEY-----`;

    expect(() =>
      validateEnv({ ...baseEnv(), JWT_PRIVATE_KEY: truncated }),
    ).toThrow(/JWT_PRIVATE_KEY/);
  });

  it('rejects the private key pasted into the public slot', () => {
    expect(() =>
      validateEnv({ ...baseEnv(), JWT_PUBLIC_KEY: PRIVATE_PEM }),
    ).toThrow(/JWT_PUBLIC_KEY/);
  });

  it('rejects a key on a curve other than P-256', () => {
    const wrongCurve = generateKeyPairSync('ec', {
      namedCurve: 'secp384r1',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });

    expect(() =>
      validateEnv({ ...baseEnv(), JWT_PRIVATE_KEY: wrongCurve.privateKey }),
    ).toThrow(/ES256/);
  });

  it('unescapes literal \\n sequences in PEM keys', () => {
    // Single-line value as it would arrive through docker-compose or systemd.
    const escaped = PRIVATE_PEM.replaceAll('\n', '\\n');

    const env = validateEnv({ ...baseEnv(), JWT_PRIVATE_KEY: escaped });

    expect(env.JWT_PRIVATE_KEY).toBe(PRIVATE_PEM);
    expect(env.JWT_PRIVATE_KEY).toContain('\n');
    expect(env.JWT_PRIVATE_KEY).not.toContain('\\n');
  });
});
