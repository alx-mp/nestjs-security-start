import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AppConfigService } from '../../config/app-config.service';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { UserSessionEntity } from './user-session.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserSessionEntity]),
    UsersModule,
    JwtModule.registerAsync({
      global: true,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        privateKey: config.env.JWT_PRIVATE_KEY,
        publicKey: config.env.JWT_PUBLIC_KEY,
        signOptions: {
          algorithm: 'ES256',
          expiresIn: config.env.JWT_ACCESS_TTL_SEC,
          issuer: 'back-eduia',
          audience: 'eduia',
        },
        verifyOptions: {
          algorithms: ['ES256'],
          issuer: 'back-eduia',
          audience: 'eduia',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    // Registered here (not AppModule) so the guards can inject UsersService.
    // Order matters: JwtAuthGuard attaches req.user, RolesGuard reads it.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  // SessionService is exported so a staff password reset can revoke every
  // refresh token of the affected account (logout-all).
  exports: [SessionService],
})
export class AuthModule {}
