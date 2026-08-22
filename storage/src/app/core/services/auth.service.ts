import { Injectable, computed, signal } from '@angular/core';
import { Session } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

export interface AuthProfile {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * State đăng nhập dựa trên signal (mục 32 — dùng thẳng Supabase Auth metadata,
 * không tạo bảng User riêng).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _session = signal<Session | null>(null);
  private readonly _ready = signal(false);

  readonly session = this._session.asReadonly();
  readonly ready = this._ready.asReadonly();
  readonly isAuthenticated = computed(() => this._session() !== null);
  /** Email đã xác thực (email_confirmed_at có giá trị) — dùng cho guard. */
  readonly isEmailConfirmed = computed(() => {
    const u = this._session()?.user;
    return !!u && !!u.email_confirmed_at;
  });

  readonly profile = computed<AuthProfile | null>(() => {
    const s = this._session();
    if (!s) return null;
    const meta = (s.user.user_metadata ?? {}) as Record<string, unknown>;
    return {
      id: s.user.id,
      email: s.user.email ?? null,
      displayName:
        (meta['display_name'] as string) ??
        (meta['full_name'] as string) ??
        (s.user.email ? s.user.email.split('@')[0] : null),
      avatarUrl: (meta['avatar_url'] as string) ?? null,
    };
  });

  readonly accessToken = computed(() => this._session()?.access_token ?? null);

  constructor(private readonly supabase: SupabaseService) {
    void this.init();
  }

  private async init(): Promise<void> {
    try {
      const { data } = await this.supabase.getSession();
      this._session.set(data.session);
      // Theo dõi mọi sự kiện auth: INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED,
      // USER_UPDATED (cập nhật session mới), SIGNED_OUT (xoá).
      this.supabase.onAuthChange((session) => this._session.set(session));
    } catch {
      this._session.set(null);
    } finally {
      // Luôn set ready để guard không treo dù Supabase chưa cấu hình.
      this._ready.set(true);
    }
  }

  /** Gửi mã OTP + Magic Link tới email. mode 'signin' = user phải tồn tại. */
  async sendEmailOtp(email: string, mode: 'signin' | 'signup'): Promise<void> {
    const emailRedirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await this.supabase.signInWithOtp(
      email,
      mode === 'signup',
      emailRedirectTo,
    );
    if (error) throw error;
  }

  /** Xác thực mã OTP 6 số → tạo session ngay. */
  async verifyEmailOtp(email: string, token: string): Promise<void> {
    const { data, error } = await this.supabase.verifyEmailOtp(email, token);
    if (error) throw error;
    this._session.set(data.session);
  }

  async signIn(email: string, password: string): Promise<void> {
    const { data, error } = await this.supabase.signInWithPassword(email, password);
    if (error) throw error;
    this._session.set(data.session);
  }

  async signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }> {
    const { data, error } = await this.supabase.signUp(email, password);
    if (error) throw error;
    // Nếu Supabase bật email confirmation, session sẽ null cho tới khi xác nhận.
    this._session.set(data.session);
    return { needsConfirmation: data.session === null };
  }

  /**
   * Điều hướng sang Google OAuth. Quay lại qua /auth/callback (mang theo đích cần
   * tới) — chỉ cần allow-list 1 Redirect URL. Session set khi client detectSessionInUrl.
   */
  async signInWithGoogle(target = '/files'): Promise<void> {
    const redirectTo = `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(target)}`;
    const { error } = await this.supabase.signInWithGoogle(redirectTo);
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    await this.supabase.signOut();
    this._session.set(null);
  }
}
