import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import {
  clearRefreshCookie,
  readCookie,
  REFRESH_COOKIE,
  setRefreshCookie,
  wantsBodyTransport,
} from './auth-cookies';
import { AuthService } from './auth.service';
import { AuthUser, CurrentUser, Public } from './decorators';

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

class RefreshDto {
  /** Only for non-browser clients; browsers send the httpOnly cookie. */
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(req, res, await this.auth.login(dto.email, dto.password));
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // a body token is accepted too, so sessions stored by older web builds
    // can be exchanged once for the cookie
    const token = dto.refreshToken ?? readCookie(req, REFRESH_COOKIE);
    if (!token) throw new UnauthorizedException('No session');
    try {
      return this.respond(req, res, await this.auth.refresh(token));
    } catch (error) {
      clearRefreshCookie(res);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = dto.refreshToken ?? readCookie(req, REFRESH_COOKIE);
    if (token) await this.auth.logout(token);
    clearRefreshCookie(res);
  }

  /** Puts the refresh token in the session cookie; the body carries it only on request. */
  private respond(
    req: Request,
    res: Response,
    pair: { accessToken: string; refreshToken: string },
  ) {
    if (wantsBodyTransport(req)) return pair;
    setRefreshCookie(res, pair.refreshToken, this.auth.refreshTtlSeconds());
    return { accessToken: pair.accessToken };
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
