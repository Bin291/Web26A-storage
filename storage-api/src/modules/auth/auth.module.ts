import { Global, Module } from '@nestjs/common';
import { SupabaseJwtService } from './supabase-jwt.service';

/** Cung cấp SupabaseJwtService cho guard toàn cục (verify JWKS). */
@Global()
@Module({
  providers: [SupabaseJwtService],
  exports: [SupabaseJwtService],
})
export class AuthModule {}
