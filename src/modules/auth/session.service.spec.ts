import { createHash } from 'node:crypto';

import { Logger, UnauthorizedException } from '@nestjs/common';
import { type DataSource, IsNull, type Repository } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../../config/app-config.service';
import { SessionService } from './session.service';
import { UserSessionEntity } from './user-session.entity';

const USER_ID = '4dfd3a53-1a5d-4f61-a9e0-04b1f34ec6a2';
const RAW_TOKEN = 'raw-refresh-token-from-the-client';
const META = { userAgent: 'vitest', ip: '127.0.0.1' };

function makeSession(): UserSessionEntity {
  return {
    id: 'old-session-id',
    userId: USER_ID,
    tokenHash: createHash('sha256').update(RAW_TOKEN).digest('hex'),
    expiresAt: new Date(Date.now() + 3_600_000),
    revokedAt: null,
    replacedById: null,
    userAgent: null,
    ip: null,
    createdAt: new Date(),
  } as UserSessionEntity;
}

describe('SessionService.rotate', () => {
  let manager: {
    findOne: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let service: SessionService;

  beforeAll(() => {
    // Silence the reuse warning that handleReuse logs on purpose.
    Logger.overrideLogger(false);
  });

  beforeEach(() => {
    manager = {
      findOne: vi.fn(),
      save: vi.fn().mockResolvedValue({ id: 'new-session-id' }),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const dataSource = {
      transaction: vi.fn(
        (cb: (m: typeof manager) => Promise<unknown>) => cb(manager),
      ),
    };
    const config = { env: { REFRESH_TOKEN_TTL_SEC: 3_600 } };

    service = new SessionService(
      {} as Repository<UserSessionEntity>,
      dataSource as unknown as DataSource,
      config as unknown as AppConfigService,
    );
  });

  it('revokes every session of the user when a revoked token comes back', async () => {
    const revoked = makeSession();
    revoked.revokedAt = new Date(Date.now() - 1_000);
    manager.findOne.mockResolvedValue(revoked);

    await expect(service.rotate(RAW_TOKEN, META)).rejects.toThrow(
      UnauthorizedException,
    );

    // Reuse containment: one update aimed at all live sessions of the user.
    expect(manager.update).toHaveBeenCalledExactlyOnceWith(
      UserSessionEntity,
      { userId: USER_ID, revokedAt: IsNull() },
      { revokedAt: expect.any(Date) as Date },
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects an expired token', async () => {
    const expired = makeSession();
    expired.expiresAt = new Date(Date.now() - 1_000);
    manager.findOne.mockResolvedValue(expired);

    await expect(service.rotate(RAW_TOKEN, META)).rejects.toThrow(
      'Refresh token expired',
    );
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('rejects a token that matches no session', async () => {
    manager.findOne.mockResolvedValue(null);

    await expect(service.rotate(RAW_TOKEN, META)).rejects.toThrow(
      'Invalid refresh token',
    );
  });

  it('returns a new token and links the old session to its replacement', async () => {
    manager.findOne.mockResolvedValue(makeSession());

    const result = await service.rotate(RAW_TOKEN, META);

    expect(result.userId).toBe(USER_ID);
    expect(typeof result.refreshToken).toBe('string');
    expect(result.refreshToken).not.toBe(RAW_TOKEN);

    // The replacement row stores only the hash of the new token.
    const savedSession = manager.save.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(manager.save).toHaveBeenCalledWith(
      UserSessionEntity,
      expect.objectContaining({ userId: USER_ID }),
    );
    expect(savedSession.tokenHash).toBe(
      createHash('sha256').update(result.refreshToken).digest('hex'),
    );

    expect(manager.update).toHaveBeenCalledExactlyOnceWith(
      UserSessionEntity,
      'old-session-id',
      {
        revokedAt: expect.any(Date) as Date,
        replacedById: 'new-session-id',
      },
    );
  });
});

describe('SessionService.revokeByToken', () => {
  let repo: { update: ReturnType<typeof vi.fn> };
  let service: SessionService;

  beforeEach(() => {
    repo = { update: vi.fn().mockResolvedValue({ affected: 1 }) };
    service = new SessionService(
      repo as unknown as Repository<UserSessionEntity>,
      {} as DataSource,
      { env: {} } as unknown as AppConfigService,
    );
  });

  it('revokes only the live session of that user', async () => {
    await service.revokeByToken(RAW_TOKEN, USER_ID);

    expect(repo.update).toHaveBeenCalledExactlyOnceWith(
      {
        tokenHash: createHash('sha256').update(RAW_TOKEN).digest('hex'),
        userId: USER_ID,
        revokedAt: IsNull(),
      },
      { revokedAt: expect.any(Date) as Date },
    );
  });

  it('resolves when the token was already revoked', async () => {
    repo.update.mockResolvedValue({ affected: 0 });

    await expect(
      service.revokeByToken(RAW_TOKEN, USER_ID),
    ).resolves.toBeUndefined();
  });
});
