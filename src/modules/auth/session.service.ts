import { createHash, randomBytes } from 'node:crypto';

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  type EntityManager,
  IsNull,
  type Repository,
} from 'typeorm';

import { AppConfigService } from '../../config/app-config.service';
import { UserSessionEntity } from './user-session.entity';

export interface ClientMeta {
  userAgent: string | null;
  ip: string | null;
}

export interface RotationResult {
  userId: string;
  refreshToken: string;
}

type RotationOutcome =
  | { kind: 'ok'; userId: string; refreshToken: string }
  | { kind: 'reuse'; userId: string }
  | { kind: 'expired' }
  | { kind: 'invalid' };

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Refresh tokens are opaque random strings, stored hashed. Rotation marks the
 * old session as revoked and links its replacement; a revoked token showing
 * up again means the token leaked, so every session of that user is revoked.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @InjectRepository(UserSessionEntity)
    private readonly repo: Repository<UserSessionEntity>,
    private readonly dataSource: DataSource,
    private readonly config: AppConfigService,
  ) {}

  async create(userId: string, meta: ClientMeta): Promise<string> {
    const raw = randomBytes(48).toString('base64url');

    await this.repo.insert(this.buildSession(userId, raw, meta));
    await this.pruneExpired(userId);

    return raw;
  }

  private buildSession(
    userId: string,
    raw: string,
    meta: ClientMeta,
  ): Partial<UserSessionEntity> {
    const ttlMs = this.config.env.REFRESH_TOKEN_TTL_SEC * 1_000;

    return {
      userId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + ttlMs),
      userAgent: meta.userAgent,
      ip: meta.ip,
    };
  }

  async rotate(rawToken: string, meta: ClientMeta): Promise<RotationResult> {
    // The outcome is thrown AFTER the transaction commits. Throwing inside
    // would roll back the reuse-triggered mass revocation.
    const outcome = await this.dataSource.transaction((manager) =>
      this.rotateInTransaction(manager, rawToken, meta),
    );

    if (outcome.kind === 'reuse') {
      this.logger.warn(
        `Refresh token reuse detected for user ${outcome.userId}; all sessions revoked`,
      );
    }

    if (outcome.kind !== 'ok') {
      throw new UnauthorizedException(
        outcome.kind === 'expired'
          ? 'Refresh token expired'
          : 'Invalid refresh token',
      );
    }

    return { userId: outcome.userId, refreshToken: outcome.refreshToken };
  }

  private async rotateInTransaction(
    manager: EntityManager,
    rawToken: string,
    meta: ClientMeta,
  ): Promise<RotationOutcome> {
    const session = await manager.findOne(UserSessionEntity, {
      where: { tokenHash: hashToken(rawToken) },
      lock: { mode: 'pessimistic_write' },
    });

    if (!session) {
      return { kind: 'invalid' };
    }

    if (session.revokedAt) {
      await this.revokeAllInTransaction(manager, session.userId);

      return { kind: 'reuse', userId: session.userId };
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      return { kind: 'expired' };
    }

    return this.replaceSession(manager, session, meta);
  }

  private async revokeAllInTransaction(
    manager: EntityManager,
    userId: string,
  ): Promise<void> {
    await manager.update(
      UserSessionEntity,
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  private async replaceSession(
    manager: EntityManager,
    session: UserSessionEntity,
    meta: ClientMeta,
  ): Promise<RotationOutcome> {
    const newRaw = randomBytes(48).toString('base64url');
    const replacement = await manager.save(
      UserSessionEntity,
      this.buildSession(session.userId, newRaw, meta),
    );

    await manager.update(UserSessionEntity, session.id, {
      revokedAt: new Date(),
      replacedById: replacement.id,
    });

    return { kind: 'ok', userId: session.userId, refreshToken: newRaw };
  }

  /**
   * Idempotent: a token already revoked, already rotated, or pruned leaves the
   * caller with no usable session either way, so a retried logout must not
   * surface as an authentication failure.
   */
  async revokeByToken(rawToken: string, userId: string): Promise<void> {
    await this.repo.update(
      { tokenHash: hashToken(rawToken), userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /**
   * Pass the caller's EntityManager when the revocation has to land with the
   * change that motivated it. A password reset that commits the new hash and
   * then dies before this call leaves the old refresh tokens alive, which is
   * the one thing the reset was for.
   */
  async revokeAllForUser(
    userId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(UserSessionEntity) : this.repo;

    await repo.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  private async pruneExpired(userId: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .delete()
      .where('user_id = :userId AND expires_at < now()', { userId })
      .execute();
  }
}
