import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { userResponseSchema } from '../../users/dto/user.dto';

// Exported so other account-creating flows (e.g. staff) apply the same policy.
export const passwordSchema = z
  .string()
  .min(12, 'password must be at least 12 characters')
  .max(128)
  .regex(/[a-z]/, 'password must contain a lowercase letter')
  .regex(/[A-Z]/, 'password must contain an uppercase letter')
  .regex(/\d/, 'password must contain a digit');

export const registerSchema = z
  .object({
    email: z.email().max(320),
    password: passwordSchema,
  })
  .strict();

export class RegisterDto extends createZodDto(registerSchema) {}

export const loginSchema = z
  .object({
    email: z.email().max(320),
    // No policy checks here: rejecting early would leak the current policy.
    password: z.string().min(1).max(128),
  })
  .strict();

export class LoginDto extends createZodDto(loginSchema) {}

export const refreshSchema = z
  .object({
    refreshToken: z.string().min(32).max(256),
  })
  .strict();

export class RefreshDto extends createZodDto(refreshSchema) {}

export const authResponseSchema = z.object({
  tokenType: z.literal('Bearer'),
  accessToken: z.string(),
  expiresInSec: z.number().int(),
  refreshToken: z.string(),
  user: userResponseSchema,
});

export class AuthResponseDto extends createZodDto(authResponseSchema) {}
