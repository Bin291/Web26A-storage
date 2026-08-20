import { Pipe, PipeTransform, inject } from '@angular/core';
import { LangService } from './lang.service';

/**
 * `{{ 'nav.myStorage' | t }}` — impure pipe để cập nhật khi đổi ngôn ngữ.
 * LangService.lang là signal nên đọc trong transform tạo phụ thuộc reactive.
 */
@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly lang = inject(LangService);

  transform(key: string, params?: Record<string, string | number>): string {
    // Đọc signal để pipe re-run khi ngôn ngữ đổi.
    this.lang.lang();
    return this.lang.translate(key, params);
  }
}
