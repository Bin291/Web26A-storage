import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Kết nối trực tiếp Postgres của Supabase (service-role). RLS KHÔNG áp dụng —
 * mọi query tự lọc `WHERE userId` tường minh (mục 3).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Prisma đã kết nối Postgres');
    } catch (err) {
      // Không chặn khởi động khi DB chưa sẵn sàng (dev) — log để biết.
      this.logger.error('Không kết nối được Postgres — kiểm tra DATABASE_URL', err as Error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
