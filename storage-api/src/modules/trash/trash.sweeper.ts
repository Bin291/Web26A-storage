import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TrashService } from './trash.service';

/** Job dọn Thùng rác quá hạn — 03:00 mỗi ngày (mục 7.E, 11.K). */
@Injectable()
export class TrashSweeper {
  private readonly logger = new Logger(TrashSweeper.name);

  constructor(private readonly trash: TrashService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handle(): Promise<void> {
    try {
      await this.trash.sweepExpired();
    } catch (err) {
      this.logger.error('Sweep Thùng rác lỗi', err as Error);
    }
  }
}
