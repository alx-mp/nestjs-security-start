import { randomUUID } from 'node:crypto';

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';

import { AppConfigService } from '../../config/app-config.service';
import { UserEntity, UserRole } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import type { LoginDto, RegisterDto } from './dto/auth.dto';
import { type ClientMeta, SessionService } from './session.service';

// Valid argon2id hash of a random throwaway value. Verifying against it when
// the email does not exist keeps response timing equal for both paths.
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$a5D+9fwBNGf5rhuqr78zAQ$ZlUpnCtMEI+6OKVjJI/dY64zvZrjaxJUOjLtnFr8kdY';

const INVALID_CREDENTIALS = 'Invalid credentials';

export interface AuthResult {
  tokenType: 'Bearer';
  accessToken: string;
  expiresInSec: number;
  refreshToken: string;
  user: UserEntity;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async register(dto: RegisterDto, meta: ClientMeta): Promise<AuthResult> {
    const user = await this.users.create(dto.email, dto.password, UserRole.USER);

    return this.buildAuthResult(user, meta);
  }

  async login(dto: LoginDto, meta: ClientMeta): Promise<AuthResult> {
    const user = await this.validateCredentials(dto.email, dto.password);

    return this.buildAuthResult(user, meta);
  }

  private async validateCredentials(
    email: string,
    password: string,
  ): Promise<UserEntity> {
    const user = await this.users.findAuthByEmail(email);

    if (!user) {
      await this.burnDummyHash(password);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    await this.assertNotLocked(user, password);
    await this.assertPassword(user, password);

    if (!user.isActive) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    await this.users.resetLoginFailures(user);

    return user;
  }

  /** Spends the same argon2 work a real verification costs. */
  private async burnDummyHash(password: string): Promise<void> {
    await argon2.verify(DUMMY_HASH, password).catch(() => false);
  }

  /**
   * The lockout stays invisible to the client: an "account locked" answer can
   * only ever reach an address that exists, which turns the login form into an
   * account enumeration oracle. The operator reads the reason in the log, and
   * the dummy hash keeps this rejection as slow as an unknown address so the
   * timing does not leak what the message withholds.
   */
  private async assertNotLocked(
    user: UserEntity,
    password: string,
  ): Promise<void> {
    if (!user.lockedUntil || user.lockedUntil.getTime() <= Date.now()) {
      return;
    }

    this.logger.warn(
      `Login rejected for user ${user.id}: account locked until ` +
        user.lockedUntil.toISOString(),
    );
    await this.burnDummyHash(password);
    throw new UnauthorizedException(INVALID_CREDENTIALS);
  }

  private async assertPassword(
    user: UserEntity,
    password: string,
  ): Promise<void> {
    const valid = await argon2
      .verify(user.passwordHash, password)
      .catch(() => false);

    if (!valid) {
      const { AUTH_MAX_LOGIN_ATTEMPTS, AUTH_LOCKOUT_MINUTES } = this.config.env;
      await this.users.recordLoginFailure(
        user.id,
        AUTH_MAX_LOGIN_ATTEMPTS,
        AUTH_LOCKOUT_MINUTES,
      );
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
  }

  async refresh(rawToken: string, meta: ClientMeta): Promise<AuthResult> {
    const { userId, refreshToken } = await this.sessions.rotate(rawToken, meta);
    const user = await this.users.findById(userId);

    if (!user?.isActive) {
      await this.sessions.revokeAllForUser(userId);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return this.buildAuthResultWithRefresh(user, refreshToken);
  }

  logout(rawToken: string, userId: string): Promise<void> {
    return this.sessions.revokeByToken(rawToken, userId);
  }

  logoutAll(userId: string): Promise<void> {
    return this.sessions.revokeAllForUser(userId);
  }

  private async buildAuthResult(
    user: UserEntity,
    meta: ClientMeta,
  ): Promise<AuthResult> {
    const refreshToken = await this.sessions.create(user.id, meta);

    return this.buildAuthResultWithRefresh(user, refreshToken);
  }

  private async buildAuthResultWithRefresh(
    user: UserEntity,
    refreshToken: string,
  ): Promise<AuthResult> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role, typ: 'access' },
      { jwtid: randomUUID() },
    );

    return {
      tokenType: 'Bearer',
      accessToken,
      expiresInSec: this.config.env.JWT_ACCESS_TTL_SEC,
      refreshToken,
      user,
    };
  }
}
