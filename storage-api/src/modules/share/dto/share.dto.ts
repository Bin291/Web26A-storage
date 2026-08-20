import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateLinkDto {
  @IsOptional() @IsString() fileId?: string;
  @IsOptional() @IsString() folderId?: string;
  @IsOptional() @IsBoolean() allowDownload?: boolean;
  @IsOptional() @IsInt() @Min(1) expiresInDays?: number;
  @IsOptional() @IsString() @MinLength(1) password?: string;
}

export class InviteDto {
  @IsOptional() @IsString() fileId?: string;
  @IsOptional() @IsString() folderId?: string;
  @IsEmail() email!: string;
  @IsOptional() @IsBoolean() allowDownload?: boolean;
  @IsOptional() @IsInt() @Min(1) expiresInDays?: number;
}

export class UpdateShareDto {
  @IsOptional() @IsBoolean() allowDownload?: boolean;
  @IsOptional() @IsInt() @Min(0) expiresInDays?: number | null;
  // '' hoặc null = gỡ mật khẩu
  @IsOptional() @IsString() password?: string | null;
}

export class UnlockDto {
  @IsString() @MinLength(1) password!: string;
}
