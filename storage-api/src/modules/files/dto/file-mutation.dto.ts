import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RenameFileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;
}

export class MoveFileDto {
  // null = chuyển về thư mục gốc
  @IsOptional()
  @IsString()
  targetFolderId?: string | null;
}

export class StarFileDto {
  @IsBoolean()
  isStarred!: boolean;
}
