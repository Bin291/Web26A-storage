import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../../common/decorators/current-user.decorator';

/** Payload JWT do Supabase Auth phát hành (HS256, symmetric — mục 3). */
interface SupabaseJwtPayload {
  sub: string;
  email?: string;
  role?: string;
  aud?: string;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    const secret = config.get<string>('supabase.jwtSecret');
    if (!secret) {
      throw new Error(
        'SUPABASE_JWT_SECRET chưa cấu hình — không thể verify JWT',
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  // Trả về gì thì gắn vào request.user. Lọc lấy các field cần dùng.
  validate(payload: SupabaseJwtPayload): AuthUser {
    if (!payload?.sub) {
      throw new UnauthorizedException('Token không hợp lệ');
    }
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
