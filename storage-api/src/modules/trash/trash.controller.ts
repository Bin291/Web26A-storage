import { Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TrashService } from './trash.service';

@Controller('trash')
export class TrashController {
  constructor(private readonly trash: TrashService) {}

  /** GET /trash — danh sách trash root (file + folder) kèm folderPath + daysUntilPurge. */
  @Get()
  list(@CurrentUser('id') userId: string) {
    return this.trash.listTrashRoots(userId);
  }

  /** POST /trash/empty — dọn toàn bộ Thùng rác. */
  @Post('empty')
  async empty(@CurrentUser('id') userId: string) {
    await this.trash.emptyTrash(userId);
    return { success: true };
  }
}
