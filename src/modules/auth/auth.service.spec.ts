import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../../config/app-config.service';
import { UserRole, type UserEntity } from '../users/user.entity';
import type { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import type { SessionService } from './session.service';

const CORRECT_PASSWORD = 'CorrectHorse1Battery';
const META = { userAgent: 'vitest', ip: '127.0.0.1' };

let correctHash: string;

function makeUser(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: 'b3f4c34e-6f5f-4a2e-9e58-6a2f2fb31c01',
    email: 'user@example.com',
    passwordHash: correctHash,
    role: UserRole.USER,
    isActive: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('AuthService.login', () => {
  let users: {
    findAuthByEmail: ReturnType<typeof vi.fn>;
    recordLoginFailure: ReturnType<typeof vi.fn>;
    resetLoginFailures: ReturnType<typeof vi.fn>;
  };
  let sessions: { create: ReturnType<typeof vi.fn> };
  let jwt: { signAsync: ReturnType<typeof vi.fn> };
  let service: AuthService;

  beforeAll(async () => {
    // Hashing once here keeps each test fast; argon2id is deliberately slow.
    correctHash = await argon2.hash(CORRECT_PASSWORD);
  });

  beforeEach(() => {
    users = {
      findAuthByEmail: vi.fn(),
      recordLoginFailure: vi.fn().mockResolvedValue(undefined),
      resetLoginFailures: vi.fn().mockResolvedValue(undefined),
    };
    sessions = { create: vi.fn().mockResolvedValue('raw-refresh-token') };
    jwt = { signAsync: vi.fn().mockResolvedValue('signed-access-token') };
    const config = {
      env: {
        AUTH_MAX_LOGIN_ATTEMPTS: 5,
        AUTH_LOCKOUT_MINUTES: 15,
        JWT_ACCESS_TTL_SEC: 900,
      },
    };

    service = new AuthService(
      users as unknown as UsersService,
      sessions as unknown as SessionService,
      jwt as unknown as JwtService,
      config as unknown as AppConfigService,
    );
  });

  async function loginError(email: string, password: string): Promise<Error> {
    try {
      await service.login({ email, password }, META);
    } catch (error) {
      return error as Error;
    }
    throw new Error('expected login to throw');
  }

  it('rejects an unknown email with the same message as a wrong password', async () => {
    users.findAuthByEmail.mockResolvedValueOnce(null);
    const unknownEmailError = await loginError('ghost@example.com', 'whatever');

    users.findAuthByEmail.mockResolvedValueOnce(makeUser());
    const wrongPasswordError = await loginError(
      'user@example.com',
      'not-the-password',
    );

    expect(unknownEmailError).toBeInstanceOf(UnauthorizedException);
    expect(wrongPasswordError).toBeInstanceOf(UnauthorizedException);
    // Identical messages so responses cannot be used to enumerate accounts.
    expect(unknownEmailError.message).toBe(wrongPasswordError.message);
  });

  it('records a failure when the password is wrong', async () => {
    const user = makeUser();
    users.findAuthByEmail.mockResolvedValue(user);

    const error = await loginError('user@example.com', 'not-the-password');

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(users.recordLoginFailure).toHaveBeenCalledExactlyOnceWith(
      user.id,
      5,
      15,
    );
    expect(users.resetLoginFailures).not.toHaveBeenCalled();
  });

  it('rejects a locked account, attempt counter untouched', async () => {
    const user = makeUser({
      lockedUntil: new Date(Date.now() + 60_000),
    });
    users.findAuthByEmail.mockResolvedValue(user);

    // Wrong password on purpose: if the stored hash were verified, a failure
    // would be recorded. The lockout check has to throw before that can happen.
    const error = await loginError('user@example.com', 'not-the-password');

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(users.recordLoginFailure).not.toHaveBeenCalled();
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('answers a locked account exactly like an unknown email', async () => {
    users.findAuthByEmail.mockResolvedValueOnce(null);
    const unknownEmail = (await loginError(
      'ghost@example.com',
      'whatever',
    )) as UnauthorizedException;

    users.findAuthByEmail.mockResolvedValueOnce(
      makeUser({ lockedUntil: new Date(Date.now() + 60_000) }),
    );
    const locked = (await loginError(
      'user@example.com',
      'whatever',
    )) as UnauthorizedException;

    // Same status and same body: the response cannot tell an attacker whether
    // the address is registered.
    expect(locked.getStatus()).toBe(unknownEmail.getStatus());
    expect(locked.getResponse()).toEqual(unknownEmail.getResponse());
    expect(locked.message).toBe('Invalid credentials');
  });

  it('rejects an inactive user even with the correct password', async () => {
    users.findAuthByEmail.mockResolvedValue(makeUser({ isActive: false }));

    const error = await loginError('user@example.com', CORRECT_PASSWORD);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.message).toBe('Invalid credentials');
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('resets failures and returns a Bearer result on success', async () => {
    const user = makeUser({ failedLoginAttempts: 2 });
    users.findAuthByEmail.mockResolvedValue(user);

    const result = await service.login(
      { email: 'user@example.com', password: CORRECT_PASSWORD },
      META,
    );

    expect(users.resetLoginFailures).toHaveBeenCalledExactlyOnceWith(user);
    expect(sessions.create).toHaveBeenCalledExactlyOnceWith(user.id, META);
    expect(result).toMatchObject({
      tokenType: 'Bearer',
      accessToken: 'signed-access-token',
      refreshToken: 'raw-refresh-token',
      expiresInSec: 900,
      user,
    });
    expect(jwt.signAsync).toHaveBeenCalledExactlyOnceWith(
      { sub: user.id, role: user.role, typ: 'access' },
      { jwtid: expect.any(String) as string },
    );
  });
});
