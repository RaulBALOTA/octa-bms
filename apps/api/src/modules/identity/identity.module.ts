import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { RolesController } from './roles.controller';
import { AuthModule } from '../../core/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [UsersController, RolesController],
})
export class IdentityModule {}
