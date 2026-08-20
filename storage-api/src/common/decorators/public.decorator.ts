import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Đánh dấu route bỏ qua JwtAuthGuard (route công khai — mục 12). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
