import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { UserRole } from './user.entity';
import { UsersService } from './users.service';

/**
 * Creates the first admin account from ADMIN_EMAIL / ADMIN_PASSWORD when the
 * database has no user with that email yet. Both vars unset means no-op, so
 * production can bootstrap once and then drop the credentials from the env.
 */
@Injectable()
export class AdminSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(
    private readonly users: UsersService,
    private readonly config: AppConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { ADMIN_EMAIL, ADMIN_PASSWORD } = this.config.env;

    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
      return;
    }

    const existing = await this.users.findByEmail(ADMIN_EMAIL);

    if (existing) {
      this.reportSkipped(ADMIN_EMAIL, existing.role);

      return;
    }

    await this.users.create(ADMIN_EMAIL, ADMIN_PASSWORD, UserRole.ADMIN);
    this.logger.log(`Admin account created for ${ADMIN_EMAIL}`);
  }

  /**
   * The seed never touches an existing row, so an email already taken by a
   * non-admin account leaves the platform with no admin at all. That has to be
   * loud: it is the only sign the bootstrap did not happen.
   */
  private reportSkipped(email: string, role: UserRole): void {
    if (role === UserRole.ADMIN) {
      this.logger.log(`Admin account already present for ${email}`);

      return;
    }

    this.logger.error(
      `ADMIN_EMAIL ${email} belongs to a ${role} account; no admin was seeded`,
    );
  }
}
