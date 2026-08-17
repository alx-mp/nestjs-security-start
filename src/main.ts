import 'reflect-metadata';
import './load-env';

import { randomUUID } from 'node:crypto';

import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import compress from '@fastify/compress';
import helmet from '@fastify/helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { type Env, getEnv, isSwaggerEnabled, splitOrigins } from './config/env';
import { setupSwagger } from './swagger';

function buildAdapter(env: Env): FastifyAdapter {
  return new FastifyAdapter({
    trustProxy: env.TRUST_PROXY,
    bodyLimit: env.BODY_LIMIT_BYTES,
    genReqId: (req: {
      headers: Record<string, string | string[] | undefined>;
    }) => {
      const header = req.headers['x-request-id'];

      return (Array.isArray(header) ? header[0] : header) ?? randomUUID();
    },
    logger: false,
  });
}

async function registerSecurity(
  app: NestFastifyApplication,
  env: Env,
): Promise<void> {
  // Helmet first, before anything else touches the reply pipeline.
  await app.register(helmet, {
    contentSecurityPolicy: isSwaggerEnabled(env)
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
          },
        }
      : { directives: { defaultSrc: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  // Compression stays out of production on purpose. Nest's own guidance is to
  // offload it to the reverse proxy for anything under real traffic, and the
  // Astro BFF reaches this API over loopback, where compressing JSON only
  // burns CPU. Kept in development so the header path stays exercised.
  if (env.NODE_ENV !== 'production') {
    await app.register(compress);
  }

  const allowlist = splitOrigins(env.CORS_ORIGINS);

  app.enableCors({
    origin: (origin, cb) => cb(null, !origin || allowlist.includes(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    maxAge: 86_400,
  });
}

async function bootstrap(): Promise<void> {
  const env = getEnv();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    buildAdapter(env),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, reply, done) => {
      void reply.header('X-Request-ID', request.id);
      done();
    });

  await registerSecurity(app, env);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  if (isSwaggerEnabled(env)) {
    setupSwagger(app, env);
  }

  await app.listen({ port: env.PORT, host: env.HOST });
}

void bootstrap();
