import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../../config/app-config.service';
import { AdminSeedService } from './admin-seed.service';
import { type UserEntity, UserRole } from './user.entity';
import type { UsersService } from './users.service';

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'AdminPassword-2026';

function makeUser(role: UserRole): UserEntity {
  return { id: 'user-1', email: ADMIN_EMAIL, role } as UserEntity;
}

describe('AdminSeedService', () => {
  let users: {
    findByEmail: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  let errors: string[];

  function makeService(env: Record<string, unknown>): AdminSeedService {
    return new AdminSeedService(users as unknown as UsersService, {
      env,
    } as AppConfigService);
  }

  beforeEach(() => {
    users = { findByEmail: vi.fn(), create: vi.fn() };
    errors = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation((message) => {
      errors.push(String(message));
    });
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('creates the admin when the email is free', async () => {
    users.findByEmail.mockResolvedValue(null);

    await makeService({ ADMIN_EMAIL, ADMIN_PASSWORD }).onApplicationBootstrap();

    expect(users.create).toHaveBeenCalledWith(
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      UserRole.ADMIN,
    );
  });

  it('does nothing without both credentials', async () => {
    await makeService({ ADMIN_EMAIL }).onApplicationBootstrap();

    expect(users.findByEmail).not.toHaveBeenCalled();
    expect(users.create).not.toHaveBeenCalled();
  });

  it('logs an error when the email belongs to a non-admin account', async () => {
    users.findByEmail.mockResolvedValue(makeUser(UserRole.USER));

    await makeService({ ADMIN_EMAIL, ADMIN_PASSWORD }).onApplicationBootstrap();

    expect(users.create).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/no admin was seeded/);
  });

  it('stays quiet when the admin already exists', async () => {
    users.findByEmail.mockResolvedValue(makeUser(UserRole.ADMIN));

    await makeService({ ADMIN_EMAIL, ADMIN_PASSWORD }).onApplicationBootstrap();

    expect(users.create).not.toHaveBeenCalled();
    expect(errors).toHaveLength(0);
  });
});
