import { Injectable, Logger } from '@nestjs/common';
import { File } from '@prisma/client';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'avif']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v', 'flv', 'wmv']);
const THUMB_W = 400;
const THUMB_H = 300;
const MAX_VIDEO_BYTES = 300 * 1024 * 1024; // >300MB thì bỏ qua để không xử lý nặng

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);

/**
 * Sinh thumbnail (mục 7): ảnh dùng sharp; video chụp 1 frame trong ~10s đầu bằng
 * ffmpeg. Lưu webp lên R2 tại `{userId}/{fileId}.thumb.webp`, set File.thumbnailUrl
 * = key đó (FilesService sẽ ký presigned URL khi trả về client).
 */
@Injectable()
export class ThumbnailService {
  private readonly logger = new Logger(ThumbnailService.name);
  private readonly inProgress = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  supports(extension: string): boolean {
    const e = extension.toLowerCase();
    return IMAGE_EXT.has(e) || VIDEO_EXT.has(e);
  }

  /** Chạy nền, nuốt lỗi (không chặn luồng upload). Dedupe theo fileId. */
  generateInBackground(file: Pick<File, 'id' | 'userId' | 'r2Key' | 'extension' | 'size'>): void {
    if (this.inProgress.has(file.id)) return;
    this.inProgress.add(file.id);
    void this.generate(file)
      .catch((err) => this.logger.warn(`Thumbnail ${file.id} lỗi: ${(err as Error).message}`))
      .finally(() => this.inProgress.delete(file.id));
  }

  async generate(
    file: Pick<File, 'id' | 'userId' | 'r2Key' | 'extension' | 'size'>,
  ): Promise<void> {
    const ext = file.extension.toLowerCase();
    let webp: Buffer | null = null;

    if (IMAGE_EXT.has(ext)) {
      const src = await this.storage.getObjectBuffer(file.r2Key);
      webp = await this.toWebp(src);
    } else if (VIDEO_EXT.has(ext)) {
      if (Number(file.size) > MAX_VIDEO_BYTES) return;
      webp = await this.videoThumb(file.r2Key, file.id, ext);
    } else {
      return;
    }

    if (!webp) return;
    const key = this.storage.thumbnailKey(file.userId, file.id);
    await this.storage.putObject(key, webp, 'image/webp');
    await this.prisma.file.update({ where: { id: file.id }, data: { thumbnailUrl: key } });
    this.logger.log(`Đã sinh thumbnail cho ${file.id}`);
  }

  private toWebp(input: Buffer): Promise<Buffer> {
    return sharp(input)
      .rotate() // tôn trọng EXIF orientation
      .resize(THUMB_W, THUMB_H, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
  }

  /** Chụp 1 frame video trong 10s đầu (thử giây 1, fallback giây 0). */
  private async videoThumb(r2Key: string, fileId: string, ext: string): Promise<Buffer | null> {
    const srcPath = join(tmpdir(), `thumb-${fileId}.${ext}`);
    const framePath = join(tmpdir(), `thumb-${fileId}.png`);
    try {
      await this.storage.downloadToFile(r2Key, srcPath);
      let ok = await this.grabFrame(srcPath, framePath, 1).catch(() => false);
      if (!ok) ok = await this.grabFrame(srcPath, framePath, 0).catch(() => false);
      if (!ok) return null;
      const frame = await fs.readFile(framePath);
      return await this.toWebp(frame);
    } finally {
      await fs.rm(srcPath, { force: true }).catch(() => undefined);
      await fs.rm(framePath, { force: true }).catch(() => undefined);
    }
  }

  private grabFrame(srcPath: string, outPath: string, atSeconds: number): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      ffmpeg(srcPath)
        .inputOptions(['-ss', String(atSeconds)]) // seek nhanh trước input
        .outputOptions(['-frames:v', '1'])
        .output(outPath)
        .on('end', () => resolve(true))
        .on('error', (e: Error) => reject(e))
        .run();
    });
  }
}
