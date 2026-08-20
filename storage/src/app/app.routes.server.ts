import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * App yêu cầu đăng nhập + dùng localStorage/Supabase ở client — render phía client
 * (SPA shell) để tránh chạy guard/Supabase khi prerender. Route có tham số
 * (/files/folder/:id, /type/:category) cũng không hợp prerender.
 */
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Client,
  },
];
