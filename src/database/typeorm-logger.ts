import { Logger as NestLogger } from '@nestjs/common';
import type { Logger } from 'typeorm';

/**
 * TypeORM's default console logger prints the failed/slow SQL together with
 * its full parameter array, which for the users table means emails and argon2
 * hashes land on stdout outside pino's redaction. This logger keeps the SQL
 * text (useful for debugging) but never the parameters, and routes through the
 * Nest logger so the output matches the rest of the app.
 */
export class QuietTypeormLogger implements Logger {
  private readonly logger = new NestLogger('TypeORM');

  logQuery(): void {
    // Per-query logging stays off; enable via env + a custom build if needed.
  }

  logQueryError(error: string | Error, query: string): void {
    const message = error instanceof Error ? error.message : error;
    this.logger.error(`Query failed: ${message} | SQL: ${query}`);
  }

  logQuerySlow(time: number, query: string): void {
    this.logger.warn(`Slow query (${time}ms): ${query}`);
  }

  logSchemaBuild(message: string): void {
    this.logger.log(message);
  }

  logMigration(message: string): void {
    this.logger.log(message);
  }

  log(level: 'log' | 'info' | 'warn', message: unknown): void {
    if (level === 'warn') {
      this.logger.warn(String(message));
    } else {
      this.logger.log(String(message));
    }
  }
}
