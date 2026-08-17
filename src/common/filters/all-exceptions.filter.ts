import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Last line of defense: anything that is not an HttpException gets logged in
 * full on the server and reduced to a generic 500 for the client, so stack
 * traces, driver errors, and internal messages never leave the process.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    if (exception instanceof HttpException) {
      this.sendHttpException(reply, request, exception);

      return;
    }

    this.logger.error(
      `Unhandled exception on ${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    void reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      requestId: request.id,
    });
  }

  private sendHttpException(
    reply: FastifyReply,
    request: FastifyRequest,
    exception: HttpException,
  ): void {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const body =
      typeof response === 'string'
        ? { statusCode: status, message: response }
        : response;

    void reply.status(status).send({ ...body, requestId: request.id });
  }
}
