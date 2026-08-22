import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { FilesApiService } from '../../core/services/files-api.service';
import { FoldersApiService } from '../../core/services/folders-api.service';
import { UploadService, UploadTask } from '../../core/services/upload.service';
import { RefreshService } from '../../core/services/refresh.service';
import { SettingsService } from '../../core/services/settings.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ShareDialog, ShareTarget } from '../share/share-dialog';
import {
  BreadcrumbCrumb,
  Folder,
  ListFilesQuery,
  StoredFile,
} from '../../core/models/file.model';
import { CATEGORIES, categoryByKey, categoryOf, formatBytes, iconOf } from '../../core/util/file-types';

type Mode = 'folder' | 'type' | 'starred' | 'recent';

interface ContextMenu {
  x: number;
  y: number;
  kind: 'file' | 'folder';
  id: string;
  name: string;
  isStarred: boolean;
}

@Component({
  selector: 'app-file-explorer',
  imports: [TranslatePipe, DatePipe, ShareDialog],
  templateUrl: './file-explorer.html',
  host: { class: 'explorer-host' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileExplorer {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly filesApi = inject(FilesApiService);
  private readonly foldersApi = inject(FoldersApiService);
  private readonly uploadService = inject(UploadService);
  private readonly refresh = inject(RefreshService);
  protected readonly settings = inject(SettingsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly mode = signal<Mode>('folder');
  protected readonly folderId = signal<string | null>(null);
  protected readonly category = signal<string | null>(null);

  protected readonly folders = signal<Folder[]>([]);
  protected readonly files = signal<StoredFile[]>([]);
  protected readonly breadcrumb = signal<BreadcrumbCrumb[]>([]);
  protected readonly loading = signal(false);
  protected readonly dragOver = signal(false);

  protected readonly sort = signal<ListFilesQuery['sort']>('createdAt');
  protected readonly order = signal<ListFilesQuery['order']>('desc');

  protected readonly uploads = signal<UploadTask[]>([]);
  protected readonly menu = signal<ContextMenu | null>(null);
  protected readonly shareTarget = signal<ShareTarget | null>(null);

  protected readonly iconOf = iconOf;
  protected readonly formatBytes = formatBytes;

  protected readonly title = computed(() => {
    switch (this.mode()) {
      case 'type': {
        const cat = categoryByKey((this.category() ?? 'other') as never);
        return cat ? cat.labelKey : 'cat.other';
      }
      case 'starred':
        return 'nav.starred';
      case 'recent':
        return 'nav.recent';
      default:
        return 'nav.myStorage';
    }
  });

  protected readonly isFolderLens = computed(() => this.mode() === 'folder');

  constructor() {
    // Phản ứng khi đổi route (mode qua data, folderId/category qua params).
    this.route.data.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((data) => {
      this.mode.set((data['mode'] as Mode) ?? 'folder');
      this.syncFromParams();
    });
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.syncFromParams();
    });
  }

  private thumbRetries = 0;

  private syncFromParams(): void {
    this.folderId.set(this.route.snapshot.paramMap.get('folderId'));
    this.category.set(this.route.snapshot.paramMap.get('category'));
    this.thumbRetries = 0;
    void this.load();
  }

  /** Thumbnail sinh nền ở backend — nạp lại vài lần để card tự hiện khi có (mục 7). */
  private scheduleThumbRefresh(): void {
    if (this.thumbRetries >= 3) return;
    const pending = this.files().some(
      (f) =>
        f.status === 'ready' &&
        !f.thumbnailUrl &&
        (categoryOf(f.extension) === 'image' || categoryOf(f.extension) === 'video'),
    );
    if (!pending) return;
    this.thumbRetries++;
    setTimeout(() => void this.load(), 3000);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.menu.set(null);
    try {
      if (this.isFolderLens()) {
        const fid = this.folderId();
        const [folders, files, crumbs] = await Promise.all([
          firstValueFrom(this.foldersApi.listChildren(fid)),
          firstValueFrom(this.filesApi.list(this.buildQuery())),
          fid ? firstValueFrom(this.foldersApi.breadcrumb(fid)) : Promise.resolve([]),
        ]);
        this.folders.set(folders);
        this.files.set(files);
        this.breadcrumb.set(crumbs);
      } else {
        this.folders.set([]);
        this.breadcrumb.set([]);
        const files = await firstValueFrom(this.filesApi.list(this.buildQuery()));
        this.files.set(files);
      }
    } catch {
      this.folders.set([]);
      this.files.set([]);
    } finally {
      this.loading.set(false);
      this.scheduleThumbRefresh();
    }
  }

  private buildQuery(): ListFilesQuery {
    const base: ListFilesQuery = { sort: this.sort(), order: this.order() };
    switch (this.mode()) {
      case 'folder':
        return { ...base, folderId: this.folderId() };
      case 'type': {
        const cat = categoryByKey((this.category() ?? 'other') as never);
        return { ...base, extensions: (cat?.extensions ?? []).join(','), withPath: true };
      }
      case 'starred':
        return { ...base, starred: true, extensions: this.allExtensions(), withPath: true };
      case 'recent':
        return {
          ...base,
          sort: 'updatedAt',
          order: 'desc',
          extensions: this.allExtensions(),
          withPath: true,
        };
    }
  }

  private allExtensions(): string {
    return CATEGORIES.flatMap((c) => c.extensions).join(',');
  }

  // --- Điều hướng ---
  openFolder(folder: Folder): void {
    void this.router.navigate(['/files/folder', folder.id]);
  }

  goCrumb(crumb: BreadcrumbCrumb | null): void {
    if (!crumb) void this.router.navigate(['/files']);
    else void this.router.navigate(['/files/folder', crumb.id]);
  }

  goToFilePath(file: StoredFile): void {
    const last = file.folderPath?.at(-1);
    if (last) void this.router.navigate(['/files/folder', last.id]);
    else void this.router.navigate(['/files']);
  }

  // --- Sort ---
  setSort(field: NonNullable<ListFilesQuery['sort']>): void {
    if (this.sort() === field) {
      this.order.set(this.order() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sort.set(field);
      this.order.set(field === 'name' ? 'asc' : 'desc');
    }
    void this.load();
  }

  // --- Tạo thư mục ---
  async createFolder(): Promise<void> {
    const name = window.prompt('Tên thư mục mới');
    if (!name?.trim()) return;
    await firstValueFrom(this.foldersApi.create(name.trim(), this.folderId()));
    void this.load();
  }

  // --- Download / mở file ---
  async openFile(file: StoredFile): Promise<void> {
    if (file.status !== 'ready') return;
    const { url } = await firstValueFrom(this.filesApi.previewUrl(file.id));
    window.open(url, '_blank');
  }

  async download(file: StoredFile): Promise<void> {
    this.menu.set(null);
    const { url } = await firstValueFrom(this.filesApi.downloadUrl(file.id));
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
  }

  // --- Context menu ---
  openMenu(event: MouseEvent, kind: 'file' | 'folder', item: StoredFile | Folder): void {
    event.preventDefault();
    event.stopPropagation();
    this.menu.set({
      x: event.clientX,
      y: event.clientY,
      kind,
      id: item.id,
      name: item.name,
      isStarred: item.isStarred,
    });
  }

  closeMenu(): void {
    this.menu.set(null);
  }

  openShare(): void {
    const m = this.menu();
    if (!m) return;
    this.shareTarget.set({ kind: m.kind, id: m.id, name: m.name });
    this.menu.set(null);
  }

  async renameItem(): Promise<void> {
    const m = this.menu();
    if (!m) return;
    const name = window.prompt('Tên mới');
    this.menu.set(null);
    if (!name?.trim()) return;
    if (m.kind === 'file') await firstValueFrom(this.filesApi.rename(m.id, name.trim()));
    else await firstValueFrom(this.foldersApi.rename(m.id, name.trim()));
    void this.load();
  }

  async toggleStar(): Promise<void> {
    const m = this.menu();
    if (!m) return;
    this.menu.set(null);
    if (m.kind === 'file') await firstValueFrom(this.filesApi.star(m.id, !m.isStarred));
    else await firstValueFrom(this.foldersApi.star(m.id, !m.isStarred));
    void this.load();
  }

  async deleteItem(): Promise<void> {
    const m = this.menu();
    if (!m) return;
    this.menu.set(null);
    if (!window.confirm('Chuyển vào Thùng rác?')) return;
    if (m.kind === 'file') await firstValueFrom(this.filesApi.trash(m.id));
    else await firstValueFrom(this.foldersApi.trash(m.id));
    void this.load();
    this.refresh.bump(); // cập nhật số đếm sidebar
  }

  // --- Upload ---
  onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) void this.uploadFileList(Array.from(input.files));
    input.value = '';
  }

  // Đếm depth để overlay không nhấp nháy khi rê qua các card con.
  private dragDepth = 0;

  private isFileDrag(event: DragEvent): boolean {
    return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');
  }

  onDragEnter(event: DragEvent): void {
    if (!this.isFileDrag(event)) return;
    event.preventDefault();
    this.dragDepth++;
    this.dragOver.set(true);
  }

  onDragOver(event: DragEvent): void {
    if (this.isFileDrag(event)) event.preventDefault(); // cho phép thả
  }

  onDragLeave(): void {
    this.dragDepth--;
    if (this.dragDepth <= 0) {
      this.dragDepth = 0;
      this.dragOver.set(false);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth = 0;
    this.dragOver.set(false);
    const files = event.dataTransfer?.files;
    if (files && files.length) void this.uploadFileList(Array.from(files));
  }

  /** Upload nhiều file; giữ cấu trúc thư mục nếu có webkitRelativePath (mục 2.1). */
  private async uploadFileList(files: File[]): Promise<void> {
    if (!this.isFolderLens()) {
      // Ở lăng kính Loại/Starred/Recent, upload về thư mục gốc.
    }
    const rootId = this.isFolderLens() ? this.folderId() : null;
    const folderCache = new Map<string, string | null>();
    folderCache.set('', rootId);

    for (const file of files) {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
      let targetFolderId = rootId;
      if (rel && rel.includes('/')) {
        const segments = rel.split('/').slice(0, -1); // bỏ tên file
        targetFolderId = await this.ensureFolderPath(segments, rootId, folderCache);
      }
      const task = this.uploadService.createTask(file);
      this.uploads.update((list) => [...list, task]);
      void this.uploadService.run(task, file, targetFolderId).then((result) => {
        if (result) {
          void this.load();
          this.refresh.bump(); // cập nhật số đếm sidebar
        }
      });
    }
  }

  /** Tạo/tìm chuỗi thư mục lồng nhau, trả id thư mục lá. */
  private async ensureFolderPath(
    segments: string[],
    rootId: string | null,
    cache: Map<string, string | null>,
  ): Promise<string | null> {
    let parentId = rootId;
    let pathKey = '';
    for (const seg of segments) {
      pathKey = pathKey ? `${pathKey}/${seg}` : seg;
      if (cache.has(pathKey)) {
        parentId = cache.get(pathKey)!;
        continue;
      }
      const children = await firstValueFrom(this.foldersApi.listChildren(parentId));
      const existing = children.find((c) => c.name === seg);
      const folder = existing ?? (await firstValueFrom(this.foldersApi.create(seg, parentId)));
      cache.set(pathKey, folder.id);
      parentId = folder.id;
    }
    return parentId;
  }

  dismissUploads(): void {
    this.uploads.set([]);
  }

  hasActiveUploads = computed(() => this.uploads().length > 0);

  /** Tra file trong danh sách hiện tại theo id (dùng cho menu download). */
  fileById(id: string): StoredFile {
    return this.files().find((f) => f.id === id) as StoredFile;
  }
}
