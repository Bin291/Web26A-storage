import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  PublicListing,
  PublicShareApiService,
  ShareMeta,
} from '../../core/services/public-share-api.service';
import { formatBytes, iconOf } from '../../core/util/file-types';

/** Trang công khai /s/:token (mục 12.E nhóm B) — ngoài authGuard. */
@Component({
  selector: 'app-public-share',
  imports: [],
  templateUrl: './public-share.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicShare implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(PublicShareApiService);

  private token = '';
  private session: string | null = null;

  protected readonly meta = signal<ShareMeta | null>(null);
  protected readonly listing = signal<PublicListing | null>(null);
  protected readonly password = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(true);

  protected readonly iconOf = iconOf;
  protected readonly formatBytes = formatBytes;

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    void this.loadMeta();
  }

  async loadMeta(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const meta = await firstValueFrom(this.api.meta(this.token, this.session));
      this.meta.set(meta);
      if (!meta.requiresPassword && meta.kind === 'folder') {
        this.listing.set(await firstValueFrom(this.api.list(this.token, this.session)));
      }
    } catch {
      this.error.set('Link không tồn tại hoặc đã hết hạn.');
      this.meta.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  async unlock(event: Event): Promise<void> {
    event.preventDefault();
    this.error.set(null);
    try {
      const res = await firstValueFrom(this.api.unlock(this.token, this.password()));
      this.session = res.sessionToken;
      await this.loadMeta();
    } catch {
      this.error.set('Mật khẩu không đúng.');
    }
  }

  async view(fileId?: string): Promise<void> {
    const { url } = await firstValueFrom(this.api.contentUrl(this.token, this.session, fileId));
    window.open(url, '_blank');
  }

  async download(fileId?: string, name?: string): Promise<void> {
    const { url } = await firstValueFrom(this.api.downloadUrl(this.token, this.session, fileId));
    const a = document.createElement('a');
    a.href = url;
    if (name) a.download = name;
    a.click();
  }
}
