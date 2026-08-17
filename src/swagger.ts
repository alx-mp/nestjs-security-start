import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

import type { Env } from './config/env';

export function setupSwagger(app: INestApplication, env: Env): void {
  const config = new DocumentBuilder()
    .setTitle('EduIA API')
    .setVersion(env.APP_VERSION)
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, cleanupOpenApiDoc(document), {
    swaggerOptions: { persistAuthorization: true },
  });
}
