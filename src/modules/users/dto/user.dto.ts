import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { UserRole } from '../user.entity';

export const userResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: z.enum(UserRole),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export class UserResponseDto extends createZodDto(userResponseSchema) {}

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export class ListUsersQueryDto extends createZodDto(listUsersQuerySchema) {}

export const listUsersResponseSchema = z.object({
  data: z.array(userResponseSchema),
  meta: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});

export class ListUsersResponseDto extends createZodDto(
  listUsersResponseSchema,
) {}
