import { Injectable, signal } from '@angular/core';

/**
 * Tín hiệu "dữ liệu file thay đổi" để các nơi (sidebar counts, ...) tự nạp lại.
 * Bump sau upload / xoá / khôi phục.
 */
@Injectable({ providedIn: 'root' })
export class RefreshService {
  readonly filesChanged = signal(0);

  bump(): void {
    this.filesChanged.update((v) => v + 1);
  }
}
