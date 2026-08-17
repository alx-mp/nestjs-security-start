import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { QueryFailedError } from 'typeorm';

interface PgErrorMapping {
  status: number;
  message: string;
}

// https://www.postgresql.org/docs/18/errcodes-appendix.html
const PG_ERROR_MAP: Record<string, PgErrorMapping> = {
  '23505': { status: HttpStatus.CONFLICT, message: 'Resource already exists' },
  '23503': {
    status: HttpStatus.CONFLICT,
    message: 'Operation conflicts with related data',
  },
  // RESTRICT constraints raise restrict_violation (23001), not 23503. Same
  // client-facing meaning: the row is referenced and cannot be deleted.
  '23001': {
    status: HttpStatus.CONFLICT,
    message: 'Operation conflicts with related data',
  },
  '23502': {
    status: HttpStatus.BAD_REQUEST,
    message: 'Missing required field',
  },
  '23514': {
    status: HttpStatus.BAD_REQUEST,
    message: 'Value violates a data constraint',
  },
  '22P02': { status: HttpStatus.BAD_REQUEST, message: 'Invalid input value' },
};

@Catch(QueryFailedError)
export class QueryFailedFilter implements ExceptionFilter<QueryFailedError> {
  private readonly logger = new Logger(QueryFailedFilter.name);

  catch(exception: QueryFailedError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const code = (exception.driverError as { code?: string }).code;
    const mapping = code ? PG_ERROR_MAP[code] : undefined;

    if (!mapping) {
      this.logger.error(
        `Unmapped database error (code ${code ?? 'unknown'}) on ${request.method} ${request.url}`,
        exception.stack,
      );
    }

    const status = mapping?.status ?? HttpStatus.INTERNAL_SERVER_ERROR;

    void reply.status(status).send({
      statusCode: status,
      message: mapping?.message ?? 'Internal server error',
      requestId: request.id,
    });
  }
}
