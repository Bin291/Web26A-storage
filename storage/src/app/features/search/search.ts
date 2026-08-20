import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/**
 * Trang tìm kiếm AI (mục 8). UI đã dựng; nhánh gọi RPC hybrid search sẽ nối ở
 * phase AI (backend `/search` + match_document_chunks). Hiện chỉ dựng khung.
 */
@Component({
  selector: 'app-search',
  imports: [TranslatePipe],
  template: `
    <h1 class="page-title">{{ 'search.title' | t }}</h1>
    <form class="search-bar" (submit)="submit($event)">
      <span class="mi">search</span>
      <input
        class="search-input"
        [placeholder]="'search.placeholder' | t"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
      />
    </form>
    @if (note()) {
      <p class="empty">{{ note() }}</p>
    }
  `,
  styles: [
    `
      .search-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 10px 18px;
        max-width: 640px;
      }
      .search-input {
        border: none;
        background: none;
        color: var(--text);
        font-size: 16px;
        flex: 1;
        outline: none;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Search {
  readonly query = signal('');
  readonly note = signal<string | null>(null);

  submit(event: Event): void {
    event.preventDefault();
    if (this.query().trim().length < 2) return;
    // Sẽ nối API hybrid search ở phase AI.
    this.note.set('AI Search sẽ được kích hoạt ở giai đoạn tích hợp AI.');
  }
}
