import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TrashApiService, TrashItem } from '../../core/services/trash-api.service';
import { FilesApiService } from '../../core/services/files-api.service';
import { FoldersApiService } from '../../core/services/folders-api.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { formatBytes, iconOf } from '../../core/util/file-types';

/** Thùng rác (mục 7.E, 11.K): khôi phục / xoá vĩnh viễn / dọn thùng rác. */
@Component({
  selector: 'app-trash',
  imports: [TranslatePipe],
  templateUrl: './trash.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Trash implements OnInit {
  private readonly trashApi = inject(TrashApiService);
  private readonly filesApi = inject(FilesApiService);
  private readonly foldersApi = inject(FoldersApiService);

  protected readonly items = signal<TrashItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly iconOf = iconOf;
  protected readonly formatBytes = formatBytes;

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.items.set(await firstValueFrom(this.trashApi.list()));
    } catch {
      this.items.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  async restore(item: TrashItem): Promise<void> {
    if (item.kind === 'file') await firstValueFrom(this.filesApi.restore(item.id));
    else await firstValueFrom(this.foldersApi.restore(item.id));
    void this.load();
  }

  async purge(item: TrashItem): Promise<void> {
    if (!window.confirm('Xoá vĩnh viễn? Không thể hoàn tác.')) return;
    if (item.kind === 'file') await firstValueFrom(this.filesApi.remove(item.id));
    else await firstValueFrom(this.foldersApi.remove(item.id));
    void this.load();
  }

  async empty(): Promise<void> {
    // Xác nhận mạnh hơn cho hành động phá huỷ hàng loạt (mục 11.K).
    if (window.prompt('Gõ "XOÁ" để dọn toàn bộ Thùng rác') !== 'XOÁ') return;
    await firstValueFrom(this.trashApi.empty());
    void this.load();
  }
}
