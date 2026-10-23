import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { OidcController } from './oidc.controller';
import { RbacService } from '../rbac/rbac.service';
import { jwtSecret } from './jwt-secret';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: jwtSecret(),
        signOptions: { expiresIn: Number(process.env.JWT_ACCESS_TTL ?? 900) },
      }),
    }),
  ],
  controllers: [AuthController, OidcController],
  providers: [AuthService, JwtStrategy, RbacService],
  exports: [AuthService, RbacService],
})
export class AuthModule {}
