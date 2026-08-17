import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { ZodSerializerDto } from 'nestjs-zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { UserEntity } from '../users/user.entity';
import { type AuthResult, AuthService } from './auth.service';
import {
  AuthResponseDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
} from './dto/auth.dto';
import type { ClientMeta } from './session.service';

const MINUTE_MS = 60_000;

function clientMeta(request: FastifyRequest): ClientMeta {
  return {
    userAgent: request.headers['user-agent']?.slice(0, 256) ?? null,
    ip: request.ip ?? null,
  };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ long: { limit: 3, ttl: MINUTE_MS } })
  @Post('register')
  @ApiOperation({ summary: 'Create an account and sign in' })
  @ZodSerializerDto(AuthResponseDto)
  register(
    @Body() dto: RegisterDto,
    @Req() request: FastifyRequest,
  ): Promise<AuthResult> {
    return this.auth.register(dto, clientMeta(request));
  }

  @Public()
  @Throttle({ long: { limit: 5, ttl: MINUTE_MS } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ZodSerializerDto(AuthResponseDto)
  login(
    @Body() dto: LoginDto,
    @Req() request: FastifyRequest,
  ): Promise<AuthResult> {
    return this.auth.login(dto, clientMeta(request));
  }

  @Public()
  @Throttle({ long: { limit: 10, ttl: MINUTE_MS } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate the refresh token, get a new token pair' })
  @ZodSerializerDto(AuthResponseDto)
  refresh(
    @Body() dto: RefreshDto,
    @Req() request: FastifyRequest,
  ): Promise<AuthResult> {
    return this.auth.refresh(dto.refreshToken, clientMeta(request));
  }

  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  @ApiOperation({ summary: 'Revoke one refresh token' })
  async logout(
    @Body() dto: RefreshDto,
    @CurrentUser() user: UserEntity,
  ): Promise<void> {
    await this.auth.logout(dto.refreshToken, user.id);
  }

  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout-all')
  @ApiOperation({ summary: 'Revoke every session of the current user' })
  async logoutAll(@CurrentUser() user: UserEntity): Promise<void> {
    await this.auth.logoutAll(user.id);
  }
}
