/**
 * Cấu hình môi trường (dev). Điền giá trị thật từ Supabase project.
 * KHÔNG commit key nhạy cảm — anon key là public-safe nhưng vẫn nên qua env khi CI.
 */
export const environment = {
  production: false,
  // DEV: bỏ qua đăng nhập để vào mọi trang bằng route (đặt false để bật lại authGuard)
  bypassAuth: false,
  // URL của storage-api (NestJS)
  apiUrl: 'http://localhost:3000',
  // Supabase Auth (Project Settings → API)
  supabaseUrl: 'https://nkibcazurnysuozyozez.supabase.co',
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5raWJjYXp1cm55c3VvenlvemV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMTY5MTAsImV4cCI6MjEwMjc5MjkxMH0.oAPdOnmr9XDK11-gyDwb2tG605Rc9kCOcdgV25UcCw8',
  // Kích thước chunk mặc định (server trả về chuẩn khi init, đây là fallback)
  chunkSizeBytes: 8 * 1024 * 1024,
  // Số chunk upload song song (mục 5.A)
  uploadConcurrency: 4,
};
