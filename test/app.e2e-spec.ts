import type { Server } from 'node:http';

import helmet from '@fastify/helmet';
import { VersioningType } from '@nestjs/common';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { getStorageToken } from '@nestjs/throttler';
import request, { type Response } from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';

const PASSWORD = 'CorrectHorse1Battery';
const EMAIL = 'user@example.com';

interface AuthBody {
  tokenType: string;
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  user: { email: string; role: string };
}

interface HealthBody {
  status: string;
  bootedAt: string;
  info: { database: { status: string } };
}

interface ErrorBody {
  statusCode: number;
  message: string;
}

/** Single place where the untyped supertest body gets a shape. */
function body<T>(res: Response): T {
  return res.body as T;
}

// Counters that never trip a limit, so tests cannot flake on the throttler.
const unlimitedThrottlerStorage = {
  increment: () =>
    Promise.resolve({
      totalHits: 1,
      timeToExpire: 1,
      isBlocked: false,
      timeToBlockExpire: 0,
    }),
};

describe('back-eduia e2e', () => {
  let app: NestFastifyApplication;
  let server: Server;
  let accessToken: string;
  let refreshToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getStorageToken())
      .useValue(unlimitedThrottlerStorage)
      .compile();

    // Same adapter setup as main.ts, minus the port binding.
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await app.register(helmet, {
      contentSecurityPolicy: { directives: { defaultSrc: ["'self'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const dataSource = app.get(DataSource);
    await dataSource.query(
      'DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
    );
    await dataSource.runMigrations();

    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('health', () => {
    it('GET /health/live answers with status ok and bootedAt', async () => {
      const res = await request(server).get('/health/live').expect(200);

      expect(body<HealthBody>(res).status).toBe('ok');
      expect(body<HealthBody>(res).bootedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('GET /health reports the database as up', async () => {
      const res = await request(server).get('/health').expect(200);

      expect(body<HealthBody>(res).status).toBe('ok');
      expect(body<HealthBody>(res).info.database.status).toBe('up');
    });
  });

  describe('register', () => {
    it('creates an account and returns tokens without the password hash', async () => {
      const res = await request(server)
        .post('/v1/auth/register')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(201);

      const auth = body<AuthBody>(res);
      expect(auth.tokenType).toBe('Bearer');
      expect(typeof auth.accessToken).toBe('string');
      expect(typeof auth.refreshToken).toBe('string');
      expect(auth.user.email).toBe(EMAIL);
      expect(auth.user.role).toBe('user');
      expect(auth.user).not.toHaveProperty('passwordHash');

      accessToken = auth.accessToken;
      refreshToken = auth.refreshToken;
    });

    it('rejects a duplicate email with 409', async () => {
      const res = await request(server)
        .post('/v1/auth/register')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(409);

      expect(body<ErrorBody>(res).message).toBe('Email is already registered');
    });

    it('rejects a weak password with 400', async () => {
      await request(server)
        .post('/v1/auth/register')
        .send({ email: 'weak@example.com', password: 'short' })
        .expect(400);
    });

    it('rejects unknown body properties with 400 (strict schema)', async () => {
      await request(server)
        .post('/v1/auth/register')
        .send({ email: 'extra@example.com', password: PASSWORD, admin: true })
        .expect(400);
    });
  });

  describe('login', () => {
    it('answers wrong password and unknown email with the same 401 body', async () => {
      const wrongPassword = await request(server)
        .post('/v1/auth/login')
        .send({ email: EMAIL, password: 'not-the-password' })
        .expect(401);

      const unknownEmail = await request(server)
        .post('/v1/auth/login')
        .send({ email: 'ghost@example.com', password: 'not-the-password' })
        .expect(401);

      // Anti-enumeration: both failures must be indistinguishable.
      expect(body<ErrorBody>(wrongPassword).message).toBe(
        body<ErrorBody>(unknownEmail).message,
      );
    });

    it('signs in with the right credentials', async () => {
      const res = await request(server)
        .post('/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200);

      expect(body<AuthBody>(res).tokenType).toBe('Bearer');
    });

    it('locks the account after too many failures, even with the right password', async () => {
      const lockEmail = 'locktest@example.com';
      await request(server)
        .post('/v1/auth/register')
        .send({ email: lockEmail, password: PASSWORD })
        .expect(201);

      // setup-e2e pins AUTH_MAX_LOGIN_ATTEMPTS to 5; drive it to the threshold.
      for (let i = 0; i < 5; i++) {
        await request(server)
          .post('/v1/auth/login')
          .send({ email: lockEmail, password: 'wrong-password' })
          .expect(401);
      }

      // The right password now bounces: that refusal IS the lock. What the
      // caller is told must not give the lock away, or the message becomes an
      // oracle for which emails have accounts, so it has to read exactly like
      // an address that was never registered.
      const locked = await request(server)
        .post('/v1/auth/login')
        .send({ email: lockEmail, password: PASSWORD })
        .expect(401);

      const unknown = await request(server)
        .post('/v1/auth/login')
        .send({ email: 'nobody-here@example.com', password: PASSWORD })
        .expect(401);

      expect(body<ErrorBody>(locked).message).toBe(
        body<ErrorBody>(unknown).message,
      );
      expect(body<ErrorBody>(locked).message).not.toMatch(/locked|bloque/i);
    });
  });

  describe('users', () => {
    it('GET /v1/users/me returns the profile with a Bearer token', async () => {
      const res = await request(server)
        .get('/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(body<{ email: string }>(res).email).toBe(EMAIL);
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('GET /v1/users/me without a token answers 401', async () => {
      await request(server).get('/v1/users/me').expect(401);
    });

    it('GET /v1/users answers 403 for the user role', async () => {
      await request(server)
        .get('/v1/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
    });
  });

  describe('refresh rotation', () => {
    let rotatedToken: string;

    it('rotates a valid refresh token', async () => {
      const res = await request(server)
        .post('/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      rotatedToken = body<AuthBody>(res).refreshToken;
      expect(typeof rotatedToken).toBe('string');
      expect(rotatedToken).not.toBe(refreshToken);
    });

    it('rejects reuse of the already-rotated token with 401', async () => {
      await request(server)
        .post('/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });

    it('also rejects the newer token, since reuse revokes every session', async () => {
      await request(server)
        .post('/v1/auth/refresh')
        .send({ refreshToken: rotatedToken })
        .expect(401);
    });
  });

  describe('hardening', () => {
    it('sends security headers and hides x-powered-by', async () => {
      const res = await request(server).get('/health/live').expect(200);

      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('answers unknown routes with sanitized JSON 404', async () => {
      const res = await request(server).get('/v1/nonexistent').expect(404);

      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(body<ErrorBody>(res).statusCode).toBe(404);
      expect(typeof body<ErrorBody>(res).message).toBe('string');
      expect(res.body).not.toHaveProperty('stack');
    });
  });
});
