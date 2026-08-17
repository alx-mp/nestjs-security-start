import { Injectable } from '@nestjs/common';

import {
  type Env,
  getEnv,
  isSwaggerEnabled,
  splitOrigins,
} from './env';

@Injectable()
export class AppConfigService {
  readonly env: Env;

  constructor() {
    this.env = getEnv();
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get corsOrigins(): string[] {
    return splitOrigins(this.env.CORS_ORIGINS);
  }

  get swaggerEnabled(): boolean {
    return isSwaggerEnabled(this.env);
  }
}
