import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-dashboard',
  imports: [MatIconModule, MatProgressSpinnerModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  protected readonly userName = signal('binh\'\'\'');
  protected readonly usedBytes = signal(0);
  protected readonly totalBytes = signal(10 * 1024 * 1024 * 1024);
  protected readonly fileCount = signal(0);
  protected readonly isLoadingRecent = signal(true);

  protected readonly usedPercent = computed(() => {
    const total = this.totalBytes();
    return total === 0 ? 0 : Math.round((this.usedBytes() / total) * 100);
  });

  protected readonly usedLabel = computed(() => this.formatBytes(this.usedBytes()));
  protected readonly totalLabel = computed(() => this.formatBytes(this.totalBytes()));

  private formatBytes(bytes: number): string {
    if (bytes === 0) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(
      Math.floor(Math.log(bytes) / Math.log(1024)),
      units.length - 1,
    );
    const value = bytes / 1024 ** exponent;
    return `${exponent === 0 ? value : value.toFixed(1)} ${units[exponent]}`;
  }
}
