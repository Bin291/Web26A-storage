import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

/** Query cho GET /files (mục 11.A sort/filter, 11.H lăng kính). */
export class ListFilesQueryDto {
  // Lăng kính Thư mục: lọc theo folder. Bỏ qua khi dùng lăng kính Loại.
  @IsOptional()
  @IsString()
  folderId?: string;

  // Lăng kính Loại: cắt ngang mọi folder theo nhóm đuôi file (Angular truyền danh
  // sách extension của nhóm — mapping tĩnh ở Angular, mục 11.H).
  @IsOptional()
  @IsString()
  extensions?: string; // "png,jpg,webp"

  @IsOptional()
  @IsIn(['name', 'createdAt', 'updatedAt', 'size'])
  sort?: 'name' | 'createdAt' | 'updatedAt' | 'size';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  // true = chỉ lấy item gắn sao (view Favorite — mục 11.B).
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  starred?: boolean;

  // true = kèm breadcrumb folderPath cho mỗi file (lăng kính Loại — mục 11.H #37).
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  withPath?: boolean;
}
