import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Thông báo trong app + badge chưa đọc (mục 11.F, 12.J). Poll nhẹ + Realtime sau. */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/notifications`;

  readonly items = signal<AppNotification[]>([]);
  readonly unreadCount = signal(0);

  async refresh(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ items: AppNotification[]; unreadCount: number }>(this.base),
      );
      this.items.set(res.items);
      this.unreadCount.set(res.unreadCount);
    } catch {
      // im lặng — badge chỉ là phụ trợ
    }
  }

  async markRead(id: string): Promise<void> {
    await firstValueFrom(this.http.patch(`${this.base}/${id}/read`, {}));
    void this.refresh();
  }

  async markAllRead(): Promise<void> {
    await firstValueFrom(this.http.post(`${this.base}/read-all`, {}));
    void this.refresh();
  }

  /** Bắn Notification trình duyệt nếu được cấp quyền (mục 11.F Phương án 1). */
  notifyBrowser(title: string, body?: string): void {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if (Notification.permission !== 'denied') {
      void Notification.requestPermission();
    }
  }
}
