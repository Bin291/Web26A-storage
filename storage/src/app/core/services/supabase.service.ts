import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  createClient,
  Session,
  SupabaseClient,
  User,
} from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

/** Storage in-memory cho môi trường SSR (không có localStorage). */
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

/**
 * Bọc SupabaseClient — chỉ dùng cho Auth (login/JWT) và Realtime (mục 3, 6).
 * File/metadata đi qua storage-api, KHÔNG gọi thẳng Supabase DB từ client.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client: SupabaseClient;
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  constructor() {
    this.client = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      auth: {
        persistSession: this.isBrowser,
        autoRefreshToken: this.isBrowser,
        detectSessionInUrl: this.isBrowser,
        storage: this.isBrowser ? undefined : (new MemoryStorage() as unknown as Storage),
      },
    });
  }

  getSession(): Promise<{ data: { session: Session | null } }> {
    return this.client.auth.getSession();
  }

  onAuthChange(cb: (session: Session | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => cb(session));
    return () => data.subscription.unsubscribe();
  }

  signInWithPassword(email: string, password: string) {
    return this.client.auth.signInWithPassword({ email, password });
  }

  signUp(email: string, password: string) {
    return this.client.auth.signUp({ email, password });
  }

  signOut() {
    return this.client.auth.signOut();
  }

  getUser(): Promise<{ data: { user: User | null } }> {
    return this.client.auth.getUser();
  }
}
