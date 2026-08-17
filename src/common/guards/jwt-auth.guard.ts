import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { UsersService } from '../../modules/users/users.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type {
  AccessTokenPayload,
  AuthenticatedRequest,
} from '../interfaces/authenticated-request.interface';

function extractBearerToken(request: AuthenticatedRequest): string | null {
  const header = request.headers.authorization;

  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(' ');

  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const payload = await this.verifyToken(extractBearerToken(request));
    const user = await this.users.findById(payload.sub);

    if (!user?.isActive) {
      throw new UnauthorizedException();
    }

    request.user = user;

    return true;
  }

  private async verifyToken(token: string | null): Promise<AccessTokenPayload> {
    if (!token) {
      throw new UnauthorizedException();
    }

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);

      if (payload.typ !== 'access') {
        throw new Error('wrong token type');
      }

      return payload;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
