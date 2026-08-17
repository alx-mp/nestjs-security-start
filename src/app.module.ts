import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import { Module } from '@nestjs/common';
import {
  APP_FILTER,
  APP_GUARD,
  APP_INTERCEPTOR,
  APP_PIPE,
} from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { seconds, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { QueryFailedFilter } from './common/filters/query-failed.filter';
import { AppConfigModule } from './config/config.module';
import { getEnv } from './config/env';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';

function buildLoggerOptions() {
  const env = getEnv();
  const isProduction = env.NODE_ENV === 'production';

  return {
    pinoHttp: {
      level: env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
      genReqId: (req: IncomingMessage) => {
        const header = req.headers['x-request-id'];

        return (Array.isArray(header) ? header[0] : header) ?? randomUUID();
      },
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      autoLogging: {
        ignore: (req: IncomingMessage) => (req.url ?? '').startsWith('/health'),
      },
      transport: isProduction
        ? undefined
        : { target: 'pino-pretty', options: { singleLine: true } },
    },
  };
}

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot(buildLoggerOptions()),
    // Tier sizing assumes the BFF architecture: every browser request fans
    // out into several server-to-server API calls, and ALL of them arrive
    // from the frontend's IP, so these buckets are effectively shared by
    // every concurrent user. The tight per-route @Throttle overrides on the
    // auth endpoints (3-10/min) are what guard brute force; these global
    // tiers only need to stop runaway loops. Real per-client tracking needs
    // the BFF to forward X-Forwarded-For + TRUST_PROXY=1.
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'short', ttl: seconds(1), limit: 40 },
        { name: 'medium', ttl: seconds(10), limit: 200 },
        { name: 'long', ttl: seconds(60), limit: 800 },
      ],
    }),
    // Cron scheduler, registered once at the root as the docs recommend.
    // @Cron jobs live in feature providers; the scanner picks them up
    // wherever they sit as long as forRoot runs once.
    ScheduleModule.forRoot(),
    DatabaseModule,
    HealthModule,
    UsersModule,
    AuthModule,
  ],
  providers: [
    // Throttling runs before the auth guards registered in AuthModule.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_FILTER, useClass: QueryFailedFilter },
  ],
})
export class AppModule {}
