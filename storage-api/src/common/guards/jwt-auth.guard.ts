import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SupabaseJwtService } from '../../modules/auth/supabase-jwt.service';
import { AuthUser } from '../decorators/current-user.decorator';

/**
 * Guard mặc định toàn app. Route gắn `@Public()` được bỏ qua (trang chia sẻ công
 * khai `/s/:token`, health check). Verify access token Supabase bằng JWKS (mục 3).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: SupabaseJwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Thiếu Bearer token');
    }
    const token = auth.slice('Bearer '.length).trim();
    request.user = await this.jwt.verify(token);
    return true;
  }
}
