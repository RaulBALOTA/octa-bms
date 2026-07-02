import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { RolesController } from './roles.controller';

@Module({
  controllers: [UsersController, RolesController],
})
export class IdentityModule {}
