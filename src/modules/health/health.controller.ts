import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '../../common/decorators/public.decorator';
import { AppConfigService } from '../../config/app-config.service';

// Skip keys must match the throttler names configured in AppModule; a bare
// @SkipThrottle() sets a 'default' key the guard never reads.
@ApiTags('health')
@Public()
@SkipThrottle({ short: true, medium: true, long: true })
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  private readonly bootedAt = new Date();

  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness: process, database, and memory' })
  async check() {
    const heapLimitBytes = this.config.env.HEALTH_HEAP_LIMIT_MB * 1024 * 1024;
    const result = await this.health.check([
      () => this.db.pingCheck('database', { timeout: 1_500 }),
      () => this.memory.checkHeap('memory_heap', heapLimitBytes),
    ]);

    return { ...result, ...this.meta() };
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness: process only, no dependencies' })
  live() {
    return { status: 'ok', ...this.meta() };
  }

  private meta() {
    return {
      bootedAt: this.bootedAt.toISOString(),
      uptimeSec: Math.round(process.uptime()),
      version: this.config.env.APP_VERSION,
    };
  }
}
