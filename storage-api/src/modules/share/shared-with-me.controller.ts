import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ShareService } from './share.service';

/** Nhóm C — người NHẬN truy cập (có đăng nhập) — mục 12.E. */
@Controller('shared')
export class SharedWithMeController {
  constructor(private readonly share: ShareService) {}

  /** View "Được chia sẻ với tôi". */
  @Get()
  list(@CurrentUser('id') userId: string) {
    return this.share.listSharedWithMe(userId);
  }

  @Get('file/:fileId/content')
  content(@CurrentUser('id') userId: string, @Param('fileId') fileId: string) {
    return this.share.sharedFileContentUrl(userId, fileId, 'inline');
  }

  @Get('file/:fileId/download')
  download(@CurrentUser('id') userId: string, @Param('fileId') fileId: string) {
    return this.share.sharedFileContentUrl(userId, fileId, 'attachment');
  }
}
