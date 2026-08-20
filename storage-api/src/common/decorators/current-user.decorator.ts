import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Thông tin user lấy từ JWT Supabase (mục 3). */
export interface AuthUser {
  id: string; // sub trong JWT = user id Supabase
  email?: string;
  role?: string;
}

/**
 * `@CurrentUser() user: AuthUser` — lấy user đã xác thực từ request.
 * `@CurrentUser('id') userId: string` — lấy 1 field.
 */
export const CurrentUser = createParamDecorator(
  (
    data: keyof AuthUser | undefined,
    ctx: ExecutionContext,
  ): AuthUser | string | undefined => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
