import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateFolderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;
}

export class RenameFolderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;
}

export class MoveFolderDto {
  // null = chuyển về thư mục gốc
  @IsOptional()
  @IsString()
  targetParentId?: string | null;
}

export class StarDto {
  @IsBoolean()
  isStarred!: boolean;
}
