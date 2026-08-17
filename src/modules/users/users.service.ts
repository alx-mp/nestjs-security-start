import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import {
  type EntityManager,
  In,
  QueryFailedError,
  type Repository,
} from 'typeorm';

import { UserEntity, type UserRole } from './user.entity';

const PG_UNIQUE_VIOLATION = '23505';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Extras for account creation: join an open transaction so the account and
 * its sibling rows commit together.
 */
export interface CreateUserOptions {
  manager?: EntityManager;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly repo: Repository<UserEntity>,
  ) {}

  async create(
    email: string,
    password: string,
    role: UserRole,
    options: CreateUserOptions = {},
  ): Promise<UserEntity> {
    const passwordHash = await argon2.hash(password);
    const repo = options.manager
      ? options.manager.getRepository(UserEntity)
      : this.repo;

    try {
      return await repo.save(
        repo.create({
          email: normalizeEmail(email),
          passwordHash,
          role,
        }),
      );
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  private mapUniqueViolation(error: unknown): unknown {
    if (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION
    ) {
      return new ConflictException('Email is already registered');
    }

    return error;
  }

  findById(id: string): Promise<UserEntity | null> {
    return this.repo.findOneBy({ id });
  }

  findByIds(ids: string[]): Promise<UserEntity[]> {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }

    return this.repo.findBy({ id: In(ids) });
  }

  /**
   * Flips is_active. JwtAuthGuard rejects inactive accounts on every request
   * and the refresh flow revokes their sessions, so deactivating here is what
   * actually cuts the person off. Accepts an EntityManager so the flip can
   * commit together with related rows.
   */
  async setActive(
    id: string,
    isActive: boolean,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(UserEntity) : this.repo;

    await repo.update({ id }, { isActive });
  }

  /**
   * Replaces the password hash (argon2id, same as create) and clears any
   * lockout. Accepts an EntityManager so a reset can commit together with its
   * audit row. Session revocation is the caller's job.
   */
  async setPassword(
    id: string,
    password: string,
    manager?: EntityManager,
  ): Promise<void> {
    const passwordHash = await argon2.hash(password);
    const repo = manager ? manager.getRepository(UserEntity) : this.repo;

    await repo.update(
      { id },
      { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
    );
  }

  findByEmail(email: string): Promise<UserEntity | null> {
    return this.repo.findOneBy({ email: normalizeEmail(email) });
  }

  /** Includes password hash and lockout state; only for the auth flow. */
  findAuthByEmail(email: string): Promise<UserEntity | null> {
    return this.repo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: normalizeEmail(email) })
      .getOne();
  }

  /**
   * Atomic increment + conditional lock in one statement. A read-modify-write
   * would lose updates under concurrent failed logins and let an attacker keep
   * the counter below the lockout threshold indefinitely.
   */
  async recordLoginFailure(
    userId: string,
    maxAttempts: number,
    lockoutMinutes: number,
  ): Promise<void> {
    await this.repo.query(
      `UPDATE users SET
         failed_login_attempts = CASE
           WHEN failed_login_attempts + 1 >= $2 THEN 0
           ELSE failed_login_attempts + 1 END,
         locked_until = CASE
           WHEN failed_login_attempts + 1 >= $2
             THEN now() + make_interval(mins => $3)
           ELSE locked_until END,
         updated_at = now()
       WHERE id = $1`,
      [userId, maxAttempts, lockoutMinutes],
    );
  }

  async resetLoginFailures(user: UserEntity): Promise<void> {
    if (user.failedLoginAttempts === 0 && user.lockedUntil === null) {
      return;
    }

    await this.repo.update(user.id, {
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
  }

  async list(
    page: number,
    limit: number,
  ): Promise<{ data: UserEntity[]; total: number }> {
    const [data, total] = await this.repo.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total };
  }
}
