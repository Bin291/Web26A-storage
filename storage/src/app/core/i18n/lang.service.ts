import { Injectable, signal } from '@angular/core';
import { Dict, Lang, dictionaries } from './dictionaries';

const STORAGE_KEY = 'app.lang';

/** Quản lý ngôn ngữ, lưu localStorage như mọi setting cá nhân (mục 11.D, 11.Q). */
@Injectable({ providedIn: 'root' })
export class LangService {
  private readonly _lang = signal<Lang>(this.load());
  readonly lang = this._lang.asReadonly();

  private load(): Lang {
    if (typeof localStorage === 'undefined') return 'vi';
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'en' || saved === 'vi' ? saved : 'vi';
  }

  setLang(lang: Lang): void {
    this._lang.set(lang);
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, lang);
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }

  toggle(): void {
    this.setLang(this._lang() === 'vi' ? 'en' : 'vi');
  }

  translate(key: string, params?: Record<string, string | number>): string {
    const dict: Dict = dictionaries[this._lang()];
    let text = dict[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return text;
  }
}
