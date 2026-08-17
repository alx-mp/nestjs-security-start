import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  ListUsersQueryDto,
  ListUsersResponseDto,
  UserResponseDto,
} from './dto/user.dto';
import { UserEntity, UserRole } from './user.entity';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Profile of the authenticated user' })
  @ZodSerializerDto(UserResponseDto)
  me(@CurrentUser() user: UserEntity): UserEntity {
    return user;
  }

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'List users (admin only)' })
  @ZodSerializerDto(ListUsersResponseDto)
  async list(@Query() query: ListUsersQueryDto) {
    const { data, total } = await this.users.list(query.page, query.limit);

    return {
      data,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }
}
