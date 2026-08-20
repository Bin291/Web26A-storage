/**
 * Cấu hình môi trường (dev). Điền giá trị thật từ Supabase project.
 * KHÔNG commit key nhạy cảm — anon key là public-safe nhưng vẫn nên qua env khi CI.
 */
export const environment = {
  production: false,
  // DEV: bỏ qua đăng nhập để vào mọi trang bằng route (đặt false để bật lại authGuard)
  bypassAuth: true,
  // URL của storage-api (NestJS)
  apiUrl: 'http://localhost:3000',
  // Supabase Auth (Project Settings → API)
  supabaseUrl: 'https://your-project.supabase.co',
  supabaseAnonKey: 'your-anon-key',
  // Kích thước chunk mặc định (server trả về chuẩn khi init, đây là fallback)
  chunkSizeBytes: 8 * 1024 * 1024,
  // Số chunk upload song song (mục 5.A)
  uploadConcurrency: 4,
};
