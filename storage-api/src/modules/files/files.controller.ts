import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ListFilesQueryDto } from './dto/file-query.dto';
import {
  MoveFileDto,
  RenameFileDto,
  StarFileDto,
} from './dto/file-mutation.dto';
import { FilesService } from './files.service';

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** GET /files — lăng kính Thư mục (folderId) hoặc Loại (extensions), sort/filter. */
  @Get()
  list(@CurrentUser('id') userId: string, @Query() q: ListFilesQueryDto) {
    return this.files.list(userId, q);
  }

  /** GET /files/stats — số đếm theo đuôi file cho sidebar (mục 11.H). */
  @Get('stats')
  stats(@CurrentUser('id') userId: string) {
    return this.files.statsByExtension(userId);
  }

  @Get(':id')
  get(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.files.get(userId, id);
  }

  @Get(':id/download-url')
  downloadUrl(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.files.getDownloadUrl(userId, id);
  }

  @Get(':id/preview-url')
  previewUrl(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.files.getPreviewUrl(userId, id);
  }

  @Patch(':id')
  rename(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: RenameFileDto,
  ) {
    return this.files.rename(userId, id, dto.name);
  }

  @Post(':id/move')
  move(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: MoveFileDto,
  ) {
    return this.files.move(userId, id, dto.targetFolderId ?? null);
  }

  @Patch(':id/star')
  star(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: StarFileDto,
  ) {
    return this.files.setStar(userId, id, dto.isStarred);
  }

  /** Xoá mềm -> Thùng rác (mục 7.E giai đoạn 1, 11.K). */
  @Patch(':id/trash')
  async trash(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.files.moveToTrash(userId, id);
    return { success: true };
  }

  /** Khôi phục từ Thùng rác (mục 11.K). */
  @Patch(':id/restore')
  restore(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.files.restore(userId, id);
  }

  /** Xoá vĩnh viễn (chỉ khi đã ở Thùng rác — mục 7.E giai đoạn 2, 11.K). */
  @Delete(':id')
  async remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.files.permanentDelete(userId, id);
    return { success: true };
  }
}
