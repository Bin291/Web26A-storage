import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { FoldersService, BreadcrumbCrumb } from '../folders/folders.service';
import { FilesService } from '../files/files.service';

export interface TrashItem {
  kind: 'file' | 'folder';
  id: string;
  name: string;
  extension: string | null;
  size: string | null;
  isStarred: boolean;
  deletedAt: string;
  daysUntilPurge: number;
  folderPath: BreadcrumbCrumb[]; // vị trí gốc (mục 11.K)
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class TrashService {
  private readonly logger = new Logger(TrashService.name);
  private readonly retentionDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly folders: FoldersService,
    private readonly files: FilesService,
    config: ConfigService,
  ) {
    this.retentionDays = config.get<number>('trash.retentionDays') ?? 30;
  }

  private daysUntilPurge(deletedAt: Date): number {
    const elapsed = Math.floor((Date.now() - deletedAt.getTime()) / DAY_MS);
    return Math.max(0, this.retentionDays - elapsed);
  }

  /** Trash root = item bị trash trực tiếp (cha không bị trash) — mục 11.K. */
  async listTrashRoots(userId: string): Promise<TrashItem[]> {
    const [delFolders, delFiles] = await Promise.all([
      this.prisma.folder.findMany({
        where: { userId, deletedAt: { not: null } },
        select: { id: true, name: true, parentId: true, isStarred: true, deletedAt: true },
      }),
      this.prisma.file.findMany({
        where: { userId, deletedAt: { not: null } },
        select: {
          id: true,
          name: true,
          extension: true,
          size: true,
          folderId: true,
          isStarred: true,
          deletedAt: true,
        },
      }),
    ]);

    const deletedFolderIds = new Set(delFolders.map((f) => f.id));
    const items: TrashItem[] = [];

    for (const f of delFolders) {
      if (f.parentId && deletedFolderIds.has(f.parentId)) continue; // con bị cascade
      items.push({
        kind: 'folder',
        id: f.id,
        name: f.name,
        extension: null,
        size: null,
        isStarred: f.isStarred,
        deletedAt: f.deletedAt!.toISOString(),
        daysUntilPurge: this.daysUntilPurge(f.deletedAt!),
        folderPath: f.parentId ? await this.folders.breadcrumb(userId, f.parentId) : [],
      });
    }

    for (const f of delFiles) {
      if (f.folderId && deletedFolderIds.has(f.folderId)) continue; // con bị cascade
      items.push({
        kind: 'file',
        id: f.id,
        name: f.name,
        extension: f.extension,
        size: f.size.toString(),
        isStarred: f.isStarred,
        deletedAt: f.deletedAt!.toISOString(),
        daysUntilPurge: this.daysUntilPurge(f.deletedAt!),
        folderPath: f.folderId ? await this.folders.breadcrumb(userId, f.folderId) : [],
      });
    }

    // Sort deletedAt desc (mới xoá lên đầu — mục 11.K).
    items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    return items;
  }

  /** Dọn toàn bộ Thùng rác của user (xoá vĩnh viễn từng trash root). */
  async emptyTrash(userId: string): Promise<void> {
    const roots = await this.listTrashRoots(userId);
    for (const item of roots) {
      try {
        if (item.kind === 'folder') await this.folders.permanentDelete(userId, item.id);
        else await this.files.permanentDelete(userId, item.id);
      } catch (err) {
        this.logger.warn(`Empty trash bỏ qua ${item.id}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Quét dọn trash root quá hạn giữ (mục 7.E) — gọi bởi cron hằng ngày.
   * Chạy toàn cục (không theo user) vì là job hệ thống.
   */
  async sweepExpired(): Promise<number> {
    const threshold = new Date(Date.now() - this.retentionDays * DAY_MS);
    const [folders, files] = await Promise.all([
      this.prisma.folder.findMany({
        where: { deletedAt: { not: null, lte: threshold } },
        select: { id: true, userId: true, parentId: true },
      }),
      this.prisma.file.findMany({
        where: { deletedAt: { not: null, lte: threshold } },
        select: { id: true, userId: true, folderId: true },
      }),
    ]);
    const deletedFolderIds = new Set(folders.map((f) => f.id));
    let purged = 0;

    for (const f of folders) {
      if (f.parentId && deletedFolderIds.has(f.parentId)) continue;
      try {
        await this.folders.permanentDelete(f.userId, f.id);
        purged++;
      } catch (err) {
        this.logger.warn(`Sweep folder ${f.id} lỗi: ${(err as Error).message}`);
      }
    }
    for (const f of files) {
      if (f.folderId && deletedFolderIds.has(f.folderId)) continue;
      try {
        await this.files.permanentDelete(f.userId, f.id);
        purged++;
      } catch (err) {
        this.logger.warn(`Sweep file ${f.id} lỗi: ${(err as Error).message}`);
      }
    }
    if (purged) this.logger.log(`Đã dọn ${purged} trash root quá hạn`);
    return purged;
  }
}
