import { ChangeDetectionStrategy, Component, computed, inject, signal, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { FilesApiService } from '../../core/services/files-api.service';
import { LangService } from '../../core/i18n/lang.service';
import { SettingsService } from '../../core/services/settings.service';
import { NotificationService, AppNotification } from '../../core/services/notification.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { CATEGORIES, CategoryKey, categoryOf } from '../../core/util/file-types';
import { ExtensionStat } from '../../core/models/file.model';

interface NavItem {
  icon: string;
  labelKey: string;
  path: string;
}

@Component({
  selector: 'app-main-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MainLayout implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly filesApi = inject(FilesApiService);
  private readonly lang = inject(LangService);
  private readonly router = inject(Router);
  protected readonly settings = inject(SettingsService);
  protected readonly notifications = inject(NotificationService);

  protected readonly profile = this.auth.profile;
  protected readonly categories = CATEGORIES;
  protected readonly notifOpen = signal(false);

  private readonly stats = signal<ExtensionStat[]>([]);

  protected readonly browseItems: NavItem[] = [
    { icon: 'cloud', labelKey: 'nav.myStorage', path: '/files' },
    { icon: 'star_border', labelKey: 'nav.starred', path: '/starred' },
    { icon: 'schedule', labelKey: 'nav.recent', path: '/recent' },
    { icon: 'search', labelKey: 'nav.search', path: '/search' },
    { icon: 'group', labelKey: 'nav.shared', path: '/shared' },
    { icon: 'delete_outline', labelKey: 'nav.trash', path: '/trash' },
  ];

  /** Số đếm theo nhóm loại, gộp từ stats theo extension (mục 11.H #36). */
  protected readonly categoryCounts = computed<Record<CategoryKey, number>>(() => {
    const counts: Record<CategoryKey, number> = {
      document: 0,
      image: 0,
      video: 0,
      audio: 0,
      code: 0,
      archive: 0,
      other: 0,
    };
    for (const s of this.stats()) counts[categoryOf(s.extension)] += s.count;
    return counts;
  });

  ngOnInit(): void {
    this.loadStats();
    void this.notifications.refresh();
  }

  loadStats(): void {
    this.filesApi.stats().subscribe({
      next: (s) => this.stats.set(s),
      error: () => this.stats.set([]),
    });
  }

  toggleNotif(): void {
    this.notifOpen.update((v) => !v);
    if (this.notifOpen()) void this.notifications.refresh();
  }

  async openNotif(n: AppNotification): Promise<void> {
    await this.notifications.markRead(n.id);
    this.notifOpen.set(false);
    if (n.linkPath) void this.router.navigateByUrl(n.linkPath);
  }

  markAllRead(): void {
    void this.notifications.markAllRead();
  }

  toggleLang(): void {
    this.lang.toggle();
  }

  currentLang(): string {
    return this.lang.lang().toUpperCase();
  }

  async logout(): Promise<void> {
    await this.auth.signOut();
    location.href = '/login';
  }
}
