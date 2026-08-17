import type { FastifyRequest } from 'fastify';

import type { UserEntity } from '../../modules/users/user.entity';

export interface AuthenticatedRequest extends FastifyRequest {
  user?: UserEntity;
}

export interface AccessTokenPayload {
  sub: string;
  role: string;
  typ: 'access';
  jti: string;
  iat: number;
  exp: number;
}
