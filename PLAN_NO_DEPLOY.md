# Storage App — Kế hoạch dự án (bản không có Deploy/Hosting)

> **Bản rút gọn của [`PLAN.md`](./PLAN.md)** — lược bỏ các đoạn nói về nơi chạy API/Web (Render, Cloudflare Workers), Dockerfile, DEPLOY.md và checklist hosting. Toàn bộ kiến trúc, schema, storage (R2), AI, i18n... giữ nguyên. File `PLAN.md` gốc vẫn là nguồn kế hoạch sống chính thức — file này chỉ để tham khảo/chia sẻ khi không cần thông tin deploy.
>
> File này là nguồn kế hoạch sống (living plan). Cập nhật liên tục qua các buổi trò chuyện tiếp theo với Claude.
> Cập nhật lần cuối: 2026-08-18 (thêm **mục 8.E "Hybrid Search"** — text+image search kết hợp BGE-M3 + Gemini vision auto-caption + Postgres FTS unaccent + cross-encoder reranker, fuse bằng RRF; thêm hàng **#51** ở bảng tóm tắt)
> Trước đó: 2026-08-14 (**quay lại Cloudflare R2** — đảo ngược quyết định 2026-07-26. Hosting API đã chuyển từ Google Cloud Run sang **Render**, web deploy trên **Cloudflare Workers**; lý do gốc "gom về cùng nhà cung cấp với Cloud Run" không còn áp dụng, và R2 khớp hệ sinh thái Cloudflare Workers hơn. Việc đổi code diễn ra âm thầm không cập nhật plan — mục này rà lại toàn bộ mục 0/1/4-12 cho khớp thực tế; xem chi tiết ở mục 13)
> Trước đó: 2026-07-27 (thêm **mục 11.O** — kéo-thả để **di chuyển** tệp/thư mục vào thư mục khác, tính năng còn thiếu phát hiện khi dùng thật; thêm hàng **#50** ở bảng tóm tắt)
> Trước đó: 2026-07-26 (**đổi object storage từ Cloudflare R2 sang Google Cloud Storage** — xoá R2 khỏi toàn bộ plan; thêm **mục 5.F** về đặc thù GCS; rủi ro "bucket public" ở mục 9.9/10.B/12.B đã **đóng** nhờ Public access prevention. **LƯU Ý**: quyết định này đã bị **đảo ngược** ngày 2026-08-14, xem dòng trên)

## 0. Tóm tắt giải pháp đã chốt (đọc nhanh)

| # | Vấn đề | Giải pháp | Mô tả ngắn |
|---|---|---|---|
| 1 | Kiến trúc tổng thể | Angular ↔ NestJS ↔ Supabase + Cloudflare R2 | NestJS là lớp trung gian sinh presigned URL, nhận chunk upload, quản lý queue, gọi AI; Angular gọi thẳng Supabase Auth/Realtime; file thật nằm R2, Supabase chỉ lưu metadata + vector (mục 6) |
| 2 | Đăng nhập | Supabase Auth | Tận dụng sẵn cho login/JWT. Phân quyền public/private + roles xử lý ở tầng app (NestJS), **không dùng Postgres RLS** vì Prisma kết nối thẳng bằng connection string (mục 3) |
| 3 | Upload file lớn | Multipart Chunked Upload, chunk đi **qua backend** | Angular chia file thành chunk 8MB, gửi tuần tự/song song tới `POST /uploads/part`, NestJS đẩy lên R2 bằng API S3-compatible; resumable nếu đứt mạng (mục 5.A) |
| 4 | Trần dung lượng | 2GB/file (env var) | Trần kỹ thuật + kiểm soát chi phí: R2 free tier 10GB storage/tháng — 1 file khổng lồ có thể ăn gần hết quota tháng nếu không giới hạn; giữ trần để tránh tai nạn (mục 5.D). Cột `File.size` dùng `BigInt` (không phải `Int`) vì `Int` 32-bit tràn số ngay ở đúng mốc 2GB (mục 7.B) |
| 5 | Chống spam/abuse | Rate limiting theo user id (`@nestjs/throttler`) | 30/phút upload, 100/phút duyệt file, 20/phút AI search, 200/phút download (mục 5.D) |
| 6 | Tiết kiệm dung lượng R2 | Nén client-side + tách "AI Artifacts" khỏi file gốc | Ảnh/video nén trước khi gửi; text thô trích ra lưu riêng, nhẹ hơn file gốc ~1000 lần, dùng để embed (mục 4) |
| 7 | Tải xuống nhanh | Presigned URL trực tiếp từ R2 + Range Requests + Redis cache | R2 đi kèm CDN Cloudflare miễn phí ở edge gần người dùng; Range Requests cho preview; Redis cache metadata thường dùng (mục 5.C) |
| 8 | UX khi xử lý AI | Pipeline bất đồng bộ qua BullMQ + Redis | Báo "đã tải lên" ngay, xử lý embedding/OCR ngầm, có concurrency limit + retry backoff (mục 5.B) |
| 9 | Preview/Thumbnail | Background worker + Supabase Realtime | Card hiện ngay khi upload xong, thumbnail sinh ngầm rồi tự cập nhật qua Realtime (mục 7) |
| 10 | AI Embedding | Google Gemini Embedding API (`gemini-embedding-001`) | 768 chiều khớp pgvector, miễn phí, gọi qua `AiEmbeddingService` riêng để dễ đổi provider — backup Jina AI (mục 8) |
| 11 | Text extraction | `pdf-parse` + `mammoth` + Gemini OCR | PDF/DOCX đọc trực tiếp; ảnh/PDF scan ủy thác Gemini OCR; XLSX/PPTX là tính năng phụ (mục 8.D) |
| 12 | Vector search | Supabase pgvector | Không cần vector DB ngoài, cosine similarity chạy ngay trong Postgres (mục 3) |
| 13 | Database schema | Prisma models `File` + `Folder` + `DocumentChunk` | Folder dạng cây (`parentId`), file thuộc folder, mỗi file có nhiều `DocumentChunk` (text + vector) — xem mục 7.B |
| 14 | R2 object key strategy | Key = ID cố định, không phải path | VD `userId/fileId` — biến rename/move thành thao tác DB thuần túy, không cần copy+delete trên R2 (mục 5.A). Cột DB tên `r2Key` — đúng nghĩa trở lại sau khi quay về R2 (mục 7.B) |
| 15 | Bảo mật AI Search | RPC luôn filter theo `user_id` | Tránh user A search ra nội dung file riêng tư của user B — xem SQL cụ thể mục 8.C |
| 16 | Cascading delete | Soft flag `delete_pending` + job nền dọn R2 rồi mới xoá DB | File: xoá object trên R2 (gốc+thumbnail+artifact) rồi xoá row. Folder: cascade xuống toàn bộ con trước khi mất tham chiếu key (mục 7.E) |
| 17 | Download cả folder | Nén zip bất đồng bộ qua BullMQ | Nhất quán với pattern "không đồng bộ" toàn app, không treo request (mục 5.E) |
| 18 | Nén file gốc sau upload | **Không nén** (đã bỏ khỏi plan) | Ảnh/video/PDF đã tự nén sẵn, nén thêm phá khả năng Range Requests preview — chỉ giữ nén client-side trước khi upload (mục 4) |
| 19 | Trùng tên file/folder | Tự thêm hậu tố kiểu Windows Explorer | Áp dụng cho cả upload, rename, move — tự đổi thành `"tên (1)"`, `"tên (2)"`... không hỏi, không ghi đè (mục 2.1) |
| 20 | File xử lý AI bị lỗi | Thêm trạng thái `status: 'failed'` | Hết số lần retry của BullMQ (tối đa 3 lần, mục 5.B) mà vẫn lỗi → đánh dấu `failed` + lưu lý do, không kẹt mãi ở `processing` (mục 7.B) |
| 21 | Resume upload khi mất phiên (đóng tab, mất mạng giữa chừng) | Hỏi thẳng R2 qua `ListParts` (API S3-compatible) | Không cần bảng DB riêng theo dõi từng chunk — R2 tự biết đã nhận phần nào, chỉ upload tiếp phần thiếu (mục 5.A) |
| 22 | NestJS xác thực JWT | `passport-jwt` + Supabase JWT secret (symmetric) | Đủ cho MVP, không cần JWKS/asymmetric (mục 3) |
| 23 | Trigger AI Search | Chỉ khi nhấn Enter, không debounce theo từng ký tự gõ | Tiết kiệm quota Gemini free tier, khớp rate limit 20/phút (mục 5.D) |
| 24 | File không trích được text (ảnh trắng, PDF rỗng/mã hoá...) | Vẫn set `status = 'ready'` | Tìm được theo tên file bình thường, chỉ không có `DocumentChunk` nên không ra kết quả AI search (mục 4.B, 8.D) |
| 25 | Chunk size cho embedding | Cố định 1000 ký tự, overlap 100 ký tự | Tự cắt bằng vòng lặp string, không thêm thư viện ngoài — đủ đơn giản cho MVP (mục 8.C) |
| 26 | Thumbnail cho video | MVP: chỉ icon. Production: ffmpeg chụp frame giây thứ 1 | Cùng pattern với Office (MVP icon, production convert), tránh thêm dependency ffmpeg sớm (mục 7.C) |
| 27 | Phân quyền public/private + roles | Xử lý ở tầng app (NestJS), không dùng Postgres RLS | Prisma kết nối thẳng connection string nên RLS không tự áp dụng — mọi query tự lọc `WHERE userId` tường minh (mục 3) |
| 28 | Sort & Filter danh sách file | Query param thêm vào endpoint list sẵn có | Không tốn schema mới — sort theo tên/ngày/dung lượng, filter theo nhóm loại file suy ra từ `extension` (mục 11.A) |
| 29 | Cây thư mục sidebar | Lazy load con theo từng node khi expand | Không load hết cây 1 lần — tránh chậm khi cây sâu (mục 11.C) |
| 30 | Gắn dấu sao (favorite) | Thêm `isStarred` vào `File`/`Folder` | View riêng lọc `isStarred = true`, tái dùng query list sẵn có (mục 7.B, 11.B) |
| 31 | Cài đặt cá nhân (theme, mật độ...) | Lưu ở `localStorage`, không thêm bảng DB | Đủ dùng cho 1 người, tránh over-engineering vì chưa cần đồng bộ đa thiết bị (mục 11.D) |
| 32 | Trang Profile | Dùng thẳng Supabase Auth user metadata | Không tạo bảng `User` riêng — email/display name/avatar lấy từ Auth (mục 11.E) |
| 33 | Thông báo | Browser Notification API (không phải Web Push thật) | Tái dùng Supabase Realtime sẵn có, không cần Service Worker/VAPID — chỉ báo khi tab đang mở, đủ cho MVP (mục 11.F) |
| 34 | Chế độ hiển thị Lưới/Danh sách | Toggle đổi template, lưu ở `localStorage` | Cùng 1 nguồn dữ liệu (mục 11.A), Lưới tái dùng Card mục 7.D, Danh sách là bảng dòng ngang mới — không thêm API/schema (mục 11.G) |
| 35 | "Rối như Google Drive" (Recent đổ đầy màn hình, người mới không biết dùng) | Tách **2 lăng kính** điều hướng không trộn lẫn + **Dashboard** làm trang chủ | Điều hướng chia 2 vùng riêng: **Thư mục** (giữ đúng cấu trúc lúc upload) và **Theo loại** (cắt ngang mọi folder). Trang chủ là Dashboard tóm tắt (thanh dung lượng + lối tắt theo loại + Recent thu nhỏ), KHÔNG đổ feed Recent hỗn loạn vào mặt người dùng (mục 11.H) |
| 36 | Sidebar "Theo loại" + số đếm | **7 nhóm cấp cao**, mỗi nhóm dropdown ra từng đuôi file kèm count | Tài liệu / Ảnh / Video / Âm thanh / Code / Nén / Khác; mapping `extension → nhóm` tĩnh ở Angular (dễ mở rộng), số đếm lấy từ endpoint mới `GET /files/stats` (`groupBy extension`), cache Redis + invalidate khi upload/xoá/move (mục 11.H) |
| 37 | Biết folder cha của file khi đang ở view-theo-loại | List endpoint đính kèm **breadcrumb đầy đủ** (`folderPath`) cho từng file | View-theo-loại trộn file từ nhiều folder → mỗi dòng hiện `Gốc › Dự án › Ảnh`, bấm 1 crumb là nhảy sang lăng kính Thư mục tại đúng folder đó; file nằm ở gốc thì không có path (mục 11.H) |
| 38 | Xoá file/folder trước đây là **vĩnh viễn gần như ngay lập tức**, không có đường lùi khi lỡ tay | Thêm **Thùng rác (Trash)** — xoá mềm bằng cột `deletedAt`, giữ lại **30 ngày** (env `TRASH_RETENTION_DAYS`) trước khi thật sự xoá vĩnh viễn | Nâng cấp mục 7.E thành 2 giai đoạn: xoá thường → set `deletedAt` (khôi phục được, dữ liệu trên R2 chưa động tới); chỉ khi bấm "Xoá vĩnh viễn" từ Thùng rác hoặc hết hạn giữ mới chạy đúng luồng cũ (xoá R2 trước, DB sau). Nâng lên **MVP chính** vì là an toàn dữ liệu, không phải tiện ích phụ (mục 7.E, 11.K) |
| 39 | Thùng rác không phình to vô hạn, không hiện rối cây con khi xoá cả folder | Trash view chỉ liệt kê **"trash root"** (item bị xoá trực tiếp), cascade `deletedAt` xuống con nhưng ẩn khỏi danh sách Thùng rác | Giống hành vi Google Drive: xoá 1 folder thì cả cây bị đánh dấu, nhưng Thùng rác không rã cây ra hiển thị — khôi phục/xoá vĩnh viễn luôn thao tác trên cả cây con cùng lúc (mục 7.E, 11.K) |
| 40 | Chia sẻ file/folder | **2 kênh dùng chung 1 bảng `Share`**: (A) mời **theo email** user đã có tài khoản → họ nhận **thông báo**; (B) **link công khai** cho người ngoài app | Cùng bản chất "cấp quyền đọc vào target", chỉ khác cách nhận diện người nhận (`sharedWithUserId` vs `token`) ⇒ 1 dialog, 1 đường thu hồi. Token random 128-bit, không phải `fileId`. Role `editor` (quyền ghi) vẫn để ngoài phạm vi (mục 12.A, 12.C) |
| 41 | Chia sẻ phá vỡ bất biến **"thấy được = sở hữu"** (`WHERE userId = me` + `assertOwned()`) của toàn bộ code hiện tại | File được chia sẻ **KHÔNG trộn** vào các lăng kính sẵn có — chỉ hiện ở view mới **"Được chia sẻ với tôi"** | Giữ nguyên 100% query của Thư mục/Loại/Gần đây/Dashboard/Thùng rác/AI Search — không sửa dòng nào. Thêm hàm **mới** `assertGrantedAccess()` riêng cho đường đọc, `assertOwned()` giữ nguyên cho mọi thao tác ghi. Đúng triết lý "lăng kính không trộn lẫn" mục 11.H (mục 12.A, 12.I) |
| 42 | Tra user theo email khi mời (không có bảng `User` — mục 11.E) | Truy vấn thẳng `auth.users` bằng Prisma `$queryRaw` | Prisma đã kết nối cấp service-role nên đọc được schema `auth`; 1 query, `email` có unique index sẵn. Đánh đổi: phụ thuộc schema nội bộ Supabase — dự phòng là `auth.admin.listUsers()` (mục 12.I) |
| 43 | Thông báo chia sẻ bị mất nếu người nhận **đang offline** | Bảng `Notification` thật + Realtime, **không** chỉ dựa vào Realtime | Chia sẻ hay xảy ra lúc người nhận không mở app — Realtime-only (mục 11.F Phương án 1) sẽ nuốt mất thông báo. Có bảng thì đăng nhập lại vẫn còn badge chưa đọc. Tạo `Share` + `Notification` trong cùng 1 `$transaction` (mục 12.J) |
| 44 | **Link chia sẻ không thể thu hồi** nếu object đọc được ẩn danh (`pub-*.r2.dev` bật Public Development URL trên bucket R2) | **Không bật** Public Development URL trên bucket R2 + để trống `R2_PUBLIC_BASE_URL` ⇒ `publicUrl()` luôn trả `null`, **mọi** đường đọc đều là presigned; link chia sẻ TTL 10 phút | Quay lại R2 (2026-08-14) tái mở một phần rủi ro này: GCS từng có **Public access prevention** ở tầng hạ tầng (đảm bảo cứng, code lỡ gọi `publicUrl()` vẫn nhận `null`); R2 không có toggle tương đương — bảo vệ nay lại là **kỷ luật thao tác** (không bật Public Development URL trên dashboard) + **kỷ luật code** (không set `R2_PUBLIC_BASE_URL`). Ghi lại rõ ở mục 12.B để không quên khi launch (mục 12.B) |
| 45 | Chia sẻ 1 folder có thể bị lợi dụng để đọc file NGOÀI cây đó | Mọi request public kèm id con phải **verify hậu duệ** (lần `parentId` ngược lên gốc đã share) | Thiếu bước này thì 1 link folder bất kỳ trở thành chìa khoá đọc toàn bộ file của user. Tái dùng `folderMap` sẵn có ở mục 11.H (mục 12.D) |
| 46 | Endpoint công khai bị brute-force token/mật khẩu | Throttle riêng theo **IP**, bật cứng không phụ thuộc env `RATE_LIMIT` | `UserThrottlerGuard` hiện đang **tắt toàn cục** (`RATE_LIMIT !== 'on'`) — chấp nhận được với route đã đăng nhập, nhưng route ẩn danh thì không. Guard riêng không override `shouldSkip` (mục 12.D) |
| 47 | Avatar bị **cắt tự động vào giữa**, người dùng không kiểm soát khung hình | Cropper canvas **tự viết**, không thêm dependency | Hiện `sharp().resize(256,256,{fit:'cover'})` cắt giữa — ảnh chân dung dọc dễ mất đầu. Component ~150 dòng: mask tròn + pan + zoom + xoay, xuất 512px webp rồi dùng lại `AvatarService.upload()`; backend KHÔNG đổi (mục 11.L) |
| 48 | *(lịch sử, đã đảo ngược 2026-08-14)* Cloudflare R2 chạy không ổn khi deploy/kiểm thử trên môi trường Google Cloud (Cloud Run) → đổi sang GCS → sau đó **hosting API rời khỏi Google Cloud (sang Render)** nên lý do gốc hết hiệu lực | **Quay lại Cloudflare R2** — dùng API S3-compatible sẵn có, R2 API Token (Dashboard → R2 → Manage API tokens) thay cho HMAC key của GCS | Cùng một `@aws-sdk/client-s3`, chỉ đổi endpoint + credential lần nữa ⇒ toàn bộ luồng multipart/presign/ListParts giữ nguyên. Hosting API (Render) + web (Cloudflare Workers) đều không phải Google Cloud, nên gom về Cloudflare (cùng nhà cung cấp với web + đúng hệ sinh thái Workers) hợp lý hơn (mục 5.F) |
| 49 | *(lịch sử — bẫy gặp khi từng dùng GCS, không còn áp dụng trên R2)* AWS SDK v3 tự chèn checksum CRC32 vào presigned PUT, GCS từ chối | Đặt `requestChecksumCalculation: 'WHEN_REQUIRED'` (+ `responseChecksumValidation`) khi khởi tạo `S3Client` | SDK ≥ 3.729 thêm `x-amz-checksum-crc32`; API S3-compatible của GCS không hiểu header này ⇒ PUT lỗi. **R2 chấp nhận checksum CRC32 bình thường** nên bẫy này không tái hiện, nhưng vẫn giữ nguyên cấu hình (vô hại, không cần gỡ) để nếu tương lai đổi provider lần nữa thì đỡ dính lại (mục 5.F) |
| 50 | **Không kéo-thả được tệp/thư mục đã có vào thư mục khác** — chỉ kéo-thả được lúc TẢI LÊN | Kéo-thả **di chuyển** nội bộ, nhận diện bằng MIME riêng `application/x-storage-items` | Thiếu tính năng chứ không phải lỗi: plan trước đây chỉ định nghĩa kéo-thả cho luồng tải lên (mục 2.1). MIME riêng để không giẫm chân handler kéo-thả toàn màn hình của `Shell`; đích thả = ô thư mục + breadcrumb + cây sidebar; tái dùng nguyên endpoint `move` sẵn có ⇒ **backend không đổi gì** (mục 11.O) |
| 51 | Tìm bằng đúng-từ-khoá bỏ sót ảnh/tài liệu không dùng đúng chữ đó (VD "cứt lợn" không ra ảnh hoa xuyến chi) | **Hybrid Search 4 nhánh** (dense + BGE-M3 + Postgres FTS + ảnh qua Gemini vision auto-caption), fuse **RRF** + **cross-encoder rerank** cuối cùng | Text: 2 embedding model (BazaarLink/Gemini + BGE-M3 đa ngôn ngữ qua HF) + FTS accent-insensitive (`unaccent`). Ảnh: Gemini vision sinh OCR + mô tả + **từ khoá gồm cả tên dân dã** (SigLIP không dùng được — HF ngừng host serverless). Reranker `BAAI/bge-reranker-v2-m3` phân biệt paraphrase khó lúc RRF chưa đủ chính xác. Query < 2 ký tự bị chặn, leet-speak (`h0a`→`hoa`) tự normalize (mục 8.E) |
| 52 | Dashboard là trang yếu nhất, luôn chắn 1 click trước nội dung thật ("My Storage") | Bỏ hẳn route/page Dashboard, đổi **trang chủ mặc định thành "My Storage" (Files)** | Xoá toàn bộ `pages/dashboard/`; `app.routes.ts` đổi route gốc thành `redirectTo: 'files'`. Thiết kế "Trang chủ = Dashboard tóm tắt" ở mục 11.H/11.N coi như lịch sử, không còn áp dụng — xem mục 11.P |
| 53 | Chỉ có tiếng Việt, không có cách đổi ngôn ngữ | **Tự viết `LangService` + dictionary TS (`vi.ts`/`en.ts`) + `TranslatePipe`** riêng, không dùng `@ngx-translate/core` | Nhất quán triết lý "không thêm dependency khi tự viết đủ rẻ". Chọn ngôn ngữ ở **Cài đặt** (mục 11.D), lưu `localStorage` như mọi setting cá nhân khác. Dịch **toàn bộ app** ngay từ đầu, không phải 1 trang mẫu — xem mục 11.Q |

> Chi tiết đầy đủ + lý do từng quyết định nằm ở các mục bên dưới. Bảng này chỉ để tra cứu nhanh.

## 1. Tổng quan

Web app lưu trữ file/folder cá nhân, có AI search kiểu "omnisearch" (tìm bằng ngôn ngữ tự nhiên qua nội dung/metadata, không chỉ tên file).

- **Quy mô**: side project cá nhân, 1 người làm — ưu tiên tốc độ ra MVP, tránh over-engineering.
- **Stack**:
  - Frontend: **Angular**
  - Backend: **NestJS**
  - Database + Auth: **Supabase** (Postgres + pgvector + Supabase Auth)
  - Object storage: **Cloudflare R2** (gọi qua API tương thích S3 — mục 5.F)
  - Cache / Queue: **Redis** + **BullMQ** (chạy trên NestJS)

> **Ghi chú lịch sử**: object storage đổi nhà cung cấp **2 lần**. (1) **2026-07-26**: ban đầu là Cloudflare R2, khi deploy + kiểm thử trên môi trường Google Cloud (Cloud Run) thì luồng R2 không chạy ổn định nên bỏ hẳn R2, chuyển sang Google Cloud Storage. (2) **2026-08-14**: hosting API rời khỏi Google Cloud hẳn (sang Render), lý do gốc "gom về cùng nhà cung cấp với Cloud Run" không còn áp dụng ⇒ **quay lại Cloudflare R2** — khớp hệ sinh thái hơn vì web cũng deploy trên Cloudflare Workers. Ba dịch vụ (R2/GCS/S3) có cùng mô hình cơ bản (object storage, S3-compatible, multipart, presigned URL) và app chỉ dùng để **lưu trữ**, nên toàn bộ thiết kế trong plan giữ nguyên qua cả 2 lần đổi — chỉ khác nhà cung cấp + vài đặc thù ghi ở **mục 5.F**.

## 2. Phạm vi MVP

### 2.1 MVP chính (ưu tiên làm trước)
- [ ] Upload file (mọi loại: ảnh, video, pdf, doc, zip, code...) và folder (giữ cấu trúc cây)
  - Tương tác: **kéo thả (drag & drop)** vào vùng upload là phương thức chính, kèm nút "Chọn file/folder" (`<input>` picker) làm dự phòng cho người không quen thao tác kéo thả.
  - Kéo thả folder: đọc đệ quy qua `DataTransferItem.webkitGetAsEntry()` để giữ cấu trúc cây con; nút picker dự phòng dùng `<input webkitdirectory>` (trả lời câu hỏi mở cũ ở mục 9).
  - Trùng tên trong cùng 1 folder: tự động thêm hậu tố kiểu Windows Explorer — `"Báo cáo.pdf"` → `"Báo cáo (1).pdf"` → `"Báo cáo (2).pdf"`... không hỏi, không ghi đè. Áp dụng cho cả file và folder, và cho **cả 3 tình huống** có thể sinh trùng tên: tạo mới (upload), đổi tên (rename), và di chuyển vào folder khác đã có sẵn tên đó (move) — cùng 1 logic dùng chung, không chỉ riêng lúc upload.
- [ ] Upload theo cơ chế **chunked multipart** (xem mục 5) để chịu được file lớn (~1GB), resumable (xem cơ chế resume cụ thể ở mục 5.A)
- [ ] Lưu trữ trên Cloudflare R2 (key theo ID cố định, xem mục 5.A), metadata (tên, size, mime type, folderId, owner...) lưu ở Supabase Postgres (schema mục 7.B)
- [ ] Xem/duyệt cây thư mục (file explorer UI) — dạng Grid Card có thumbnail/icon (xem mục 7)
  - Tạo thư mục con bên trong thư mục khác: hoàn toàn dùng lại `Folder.parentId` sẵn có (mục 7.B) — nút "Thư mục mới" khi đang đứng trong folder X tạo `Folder` mới với `parentId = X.id`, không cần thiết kế gì thêm.
  - Sắp xếp (sort) + lọc theo loại file (filter) + điều hướng cây thư mục qua sidebar/breadcrumb — chi tiết cụ thể ở **mục 11**
- [ ] Download file (presigned URL + Range Requests cho preview, xem mục 5.C) / download cả folder (nén zip bất đồng bộ, xem mục 5.E)
- [ ] Xoá / đổi tên / di chuyển file/folder — di chuyển có **3 đường**: menu → "Chuyển" (dialog chọn cây), **Cắt/Dán** `Ctrl+X`/`Ctrl+V` (mục 11.N), và **kéo-thả** mục vào thư mục/breadcrumb/cây sidebar (mục 11.O). (rename & move chỉ là thao tác DB nhờ object key theo ID — mục 5.A; xoá đi qua **Thùng rác** trước — xoá mềm khôi phục được, xoá vĩnh viễn có trễ — xem mục 7.E, 11.K)
- [ ] **Tối ưu dung lượng lưu trữ** (xem mục 4): nén ảnh/video phía client, tách "AI Artifacts" (raw text) khỏi file gốc
- [ ] **AI Search (omnisearch-style)**:
  - Trích xuất raw text từ file (pdf/docx text trước; OCR ảnh — giai đoạn sau)
  - Sinh embedding vector từ raw text (nhẹ hơn nhiều so với embed nguyên file)
  - Lưu vector vào Supabase (pgvector)
  - Search bằng similarity search (semantic search) + có thể kết hợp full-text search truyền thống
- [ ] **Preview/Thumbnail tự động** (xem mục 7): sinh nền (background job), không chặn luồng upload chính

### 2.2 MVP phụ (làm sau khi chính đã chạy được)
- [ ] **Chia sẻ (Share)** — ✅ **đã thiết kế đầy đủ ở mục 12**, sẵn sàng implement. Gồm 2 kênh: (A) mời theo **email** user đã có tài khoản + **thông báo** trong app, (B) **link công khai** (hết hạn + mật khẩu tuỳ chọn). Kèm view "Được chia sẻ với tôi" + bảng `Notification`.
- [ ] Public / Private cho từng file hoặc folder — phần lớn đã được mục 12 bao phủ (mặc định mọi thứ private, "public" = đang có link mở); chỉ còn thiếu khái niệm "công khai vĩnh viễn không cần link"
- [ ] Role **editor** (người nhận được sửa/xoá/upload vào folder được chia sẻ) — **cố tình để ngoài mục 12** (xem 12.A): quyền ghi kéo theo hàng loạt câu hỏi khác (quota tính cho ai, người nhận xoá thì vào Thùng rác của ai, trùng tên theo cây của ai). Lượt này người nhận chỉ là `viewer` (xem + tải).
- [ ] Text extraction cho XLSX/PPTX để AI Search đọc được (dùng `officeparser`, xem mục 8.D) — **phụ**, không phải core vì trọng tâm sản phẩm là lưu trữ + AI search, thứ tự triển khai có thể điều chỉnh linh hoạt
- [ ] **Cá nhân hoá**: gắn dấu sao (favorite), trang Cài đặt (theme/mật độ hiển thị), trang Profile, thông báo — chi tiết + phương án cụ thể ở **mục 11**

## 3. Quyết định kỹ thuật (đã chốt / đang mở)

| Vấn đề | Trạng thái | Ghi chú |
|---|---|---|
| Auth | ✅ Chốt | Dùng **Supabase Auth** (tận dụng sẵn cho login/JWT). **Phân quyền (public/private, roles) xử lý ở tầng app (NestJS), không dùng Postgres RLS** — vì Prisma kết nối thẳng bằng connection string (service-role), RLS không tự áp dụng cho query kiểu này. Mọi query/RPC đều tự lọc `WHERE userId = ...` tường minh trong code (đã làm nhất quán từ đầu, xem RPC mục 8.C) — khi làm MVP phụ (roles/permissions) tiếp tục theo hướng này, không đổi kiến trúc giữa chừng. |
| NestJS xác thực JWT | ✅ Chốt | `AuthGuard` dùng `passport-jwt` verify chữ ký bằng **Supabase JWT secret** (symmetric, lấy ở Project Settings → API → JWT Secret) — đủ cho MVP, không cần JWKS/asymmetric. Giải mã lấy `sub` (user id) gắn vào `request.user`, mọi query Prisma sau đó lọc theo đúng user. |
| Object storage | ✅ Chốt (quay lại R2, 2026-08-14) | **Cloudflare R2**, truy cập bằng **API tương thích S3** (R2 API Token — Dashboard → R2 → Manage API tokens → Create API Token, scope theo bucket, quyền Object Read & Write). Giữ nguyên `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, chỉ đổi `endpoint` = `https://<account_id>.r2.cloudflarestorage.com`, `region` = `auto` (R2 không phân vùng theo region), và credential. Từng đổi sang Google Cloud Storage (2026-07-26) khi hosting API còn ở Cloud Run; nay hosting API là **Render** (không phải Google Cloud) nên lý do gốc hết hiệu lực ⇒ quay lại R2, khớp hệ sinh thái Cloudflare hơn (web cũng ở Cloudflare Workers). Đặc thù: **mục 5.F**. |
| File upload strategy | ✅ Chốt | **Multipart Chunked Upload**: NestJS mở phiên multipart trên R2, Angular chia file thành chunk **8MB** và gửi chunk **qua backend** (`POST /uploads/part`) thay vì PUT thẳng lên bucket, NestJS ra lệnh ghép khi xong (xem mục 5.A — lý do đi qua backend: né hoàn toàn CORS). |
| Vector store | ✅ Chốt | Supabase Postgres + **pgvector** (đã có sẵn trong Supabase, không cần thêm service ngoài) |
| AI pipeline execution | ✅ Chốt | Bất đồng bộ qua **BullMQ + Redis** trên NestJS — không chặn response upload (xem mục 5.B) |
| Thumbnail/preview generation | ✅ Chốt | Sinh nền (background worker), cập nhật `thumbnailUrl` qua Supabase Realtime (xem mục 7) |
| Dữ liệu cho AI vs file gốc | ✅ Chốt | Tách "AI Artifacts" (raw text nhẹ) ra khỏi file gốc — không embed trực tiếp file nặng (xem mục 4) |
| Embedding model / AI provider | ✅ Chốt (mở rộng thành hybrid 2026-08-18) | Nhánh chính **BazaarLink** (`openai/text-embedding-3-small`, 768d, OpenAI-compatible) với **fallback tự động sang Gemini** (`gemini-embedding-001`) khi BazaarLink hết credit (HTTP 402) — `AiEmbeddingService` tự chuyển, không cần restart. Từ 2026-08-18 thêm nhánh **BGE-M3** (`BAAI/bge-m3`, 1024d, qua HF Inference API) chạy song song cho hybrid search — xem **mục 8.E**. |
| Text extraction (pdf/docx/ocr) | ✅ Chốt (ảnh mở rộng 2026-08-18) | Xem chi tiết mục 8.D. Tóm tắt: `pdf-parse` (PDF), `mammoth` (DOCX), đọc thẳng cho text/code. **Ảnh**: Gemini vision auto-caption sinh cả OCR + mô tả + từ khoá (bao gồm tên dân dã) thay vì chỉ OCR thuần — xem mục 8.E. XLSX/PPTX là tính năng **phụ** dùng `officeparser`, không nằm trong MVP chính (xem mục 2.2 & 8.D). |
| Giới hạn dung lượng | ✅ Chốt | Storage app **không áp trần tổng dung lượng** (đi ngược bản chất sản phẩm). Chỉ áp: (1) trần kỹ thuật cho **1 file = 2GB** (env var `MAX_FILE_SIZE_MB`, xem lý do ở mục 5.D), (2) **rate limiting theo request** qua `@nestjs/throttler`, theo user id (xem bảng chi tiết mục 5.D) — đây mới là cơ chế bảo vệ thật sự cần thiết, không liên quan tới dung lượng. |
| ORM | ✅ Chốt | **Prisma**, kết nối trực tiếp Postgres connection string của Supabase — toàn bộ code mẫu trong plan đã dùng cú pháp Prisma |
| Object key strategy | ✅ Chốt | Key object = ID cố định (`userId/fileId`), **không** chứa path/tên người đọc được. Rename/move chỉ là update `name`/`folderId` trong Postgres — không cần copy+delete trên R2 (giải quyết vấn đề object storage nói chung không hỗ trợ rename nguyên tử). Cột DB tên `r2Key` — xem ghi chú mục 7.B |
| Bảo mật AI Search | ✅ Chốt | RPC tìm kiếm luôn có `WHERE user_id = ...`, top-K = 10, không áp ngưỡng similarity cứng (hiển thị % điểm cho người dùng tự đánh giá) — xem SQL cụ thể mục 8.C |
| Xoá file/folder (Thùng rác + Cascading delete) | ✅ Chốt | **2 giai đoạn**: (1) Xoá mềm — set `deletedAt`, khôi phục được, giữ **30 ngày** (`TRASH_RETENTION_DAYS`); (2) Xoá vĩnh viễn (bấm từ Thùng rác hoặc hết hạn) — đánh dấu `delete_pending` → job nền (BullMQ) dọn object trên R2 → xoá row Postgres (Prisma cascade tự xoá `DocumentChunk`/file con). Xem mục 7.E, 11.K |
| Download folder | ✅ Chốt | Nén zip bất đồng bộ qua BullMQ (không nén đồng bộ trong request, không zip phía client) — xem mục 5.E |
| Nén file gốc sau upload | ✅ Đã loại bỏ | Không nén file gốc thành zip/tar.gz sau khi upload (khác với đề xuất ban đầu ở mục 4.B cũ) — vì phá khả năng Range Requests preview và lợi ích gần như 0 với ảnh/video/PDF đã tự nén sẵn |
| Chia sẻ (Share) | ✅ Chốt | **2 kênh, dùng chung 1 bảng `Share`**: (A) mời theo **email** user đã có tài khoản → tạo `Notification` cho họ, file hiện ở view "Được chia sẻ với tôi"; (B) **link công khai** `/s/:token` (token random 128-bit, tuỳ chọn hết hạn/mật khẩu/chặn tải xuống) cho người ngoài app. Người nhận chỉ `viewer`; role `editor` để ngoài phạm vi (mục 12.A). Xem toàn bộ thiết kế ở **mục 12**. |
| Phạm vi ảnh hưởng của Share lên code cũ | ✅ Chốt | File được chia sẻ **không trộn** vào lăng kính sẵn có — chỉ hiện ở view mới "Được chia sẻ với tôi" ⇒ **không sửa dòng nào** trong query list/stats/search hiện tại. `assertOwned()` giữ nguyên cho mọi thao tác ghi; thêm hàm mới `assertGrantedAccess()` chỉ cho đường đọc (mục 12.A, 12.I). |
| Thông báo cho người được chia sẻ | ✅ Chốt | Thêm bảng **`Notification`** + đưa vào publication Realtime (kèm policy RLS lọc `auth.uid()`, lặp đúng khuôn mẫu đã dùng cho bảng `File`). Không dùng Realtime-only vì sẽ mất thông báo khi người nhận offline — điểm yếu đã ghi ở mục 11.F. Chưa gửi email (mục 12.J). |
| Bảo mật link chia sẻ | ✅ Chốt | Trang công khai **luôn** lấy nội dung qua backend bằng **presigned TTL 10 phút** (`SHARE_CONTENT_TTL_SECONDS`), không bao giờ trả URL public của bucket. Trên R2, điều kiện "không có URL public" phụ thuộc **không bật** Public Development URL trên bucket + để trống `R2_PUBLIC_BASE_URL` — kỷ luật thao tác + code, không phải đảm bảo cứng ở tầng hạ tầng (mục 12.B). |
| Public access của bucket | ⚠️ Kỷ luật thao tác (rủi ro tái mở một phần từ 2026-08-14) | Bucket R2 **không bật** Public Development URL (`pub-*.r2.dev`), `R2_PUBLIC_BASE_URL` để trống ⇒ `StorageService.publicUrl()` trả `null` và **mọi** đường đọc (thumbnail, preview, tải xuống, link chia sẻ) đều dùng presigned URL. Khác giai đoạn dùng GCS (Public access prevention là đảm bảo cứng ở tầng hạ tầng): trên R2 đây lại là **lựa chọn cấu hình** phải tự giữ kỷ luật không bật — mất đi tầng CDN cache miễn phí của R2 để đổi lấy an toàn (mục 5.C, 9.9, 12.B). |
| Cắt ảnh đại diện | ✅ Chốt | Component canvas **tự viết** (mask tròn + pan + zoom + xoay), không thêm `ngx-image-cropper` — nhất quán với các lần chọn "không thêm dependency" trước đó. Backend `me.controller.ts` KHÔNG đổi (mục 11.L). |
| Supabase free tier | ⚠️ Rủi ro đã biết | Đã verify: DB Postgres chỉ **500MB** (~150.000 vector 768-chiều trước khi đầy — ước tính, cần theo dõi thực tế), 1GB file storage (không dùng vì file nằm ở R2), 50k MAU auth (dư dùng), 200 Realtime connections (dư dùng). **Project tự động pause sau 1 tuần không hoạt động** — cần lưu ý cho 1 side project không dùng thường xuyên. Xem mục 10. |

## 4. Chiến lược tối ưu dung lượng lưu trữ (giảm chi phí lưu trữ)

Mục tiêu: giảm tối đa dung lượng lưu trên Cloudflare R2 mà vẫn đủ chất lượng cho người dùng xem và AI phân tích. (R2 free tier 10GB/tháng — mọi byte tiết kiệm được là quota tiết kiệm trực tiếp, tránh phải nâng gói trả phí.)

### 4.A. Nén dữ liệu ngay tại Client (Angular) trước khi upload
- **Ảnh / Video**: resize + giảm resolution + nén quality bằng `browser-image-compression` hoặc Canvas API. Ảnh gốc 10MB có thể giảm còn ~300KB mà không ảnh hưởng hiển thị hay khả năng đọc của AI.
- **Tài liệu (PDF, Office, Text)**: nén bằng `JSZip` hoặc `pako` (Gzip/Zlib) trước khi gửi đi.

### 4.B. Kiến trúc lưu trữ phân tầng (Tiered Storage)
Tách rõ 2 mục đích lưu trữ, không dùng chung 1 bản:
- **Original File (file gốc)**: giữ nguyên như lúc upload, **không nén thêm** sau khi lưu (xem lý do ở mục 3, hàng "Nén file gốc sau upload"). Ảnh/video/PDF đã tự nén sẵn ở định dạng gốc; nén thêm 1 lớp zip tốn CPU mà lợi ích gần 0, đồng thời phá khả năng Range Requests preview (mục 5.C) vì không thể range vào giữa 1 file zip. Việc tối ưu dung lượng thật sự nằm ở bước nén client-side (mục 4.A) trước khi upload.
- **AI Artifacts (dữ liệu cho AI)**: AI chỉ cần text thô, không cần định dạng/font/hình ảnh trang trí. Ngay sau upload, trích xuất raw text và lưu thành text file riêng trên R2 (key `{userId}/{fileId}.txt`), cực nhẹ (PDF 50MB → text thô chỉ ~50KB, giảm ~1000 lần). Chunk + embed từ file text này, **không** embed trực tiếp file gốc.
  - *Vì sao lưu lên R2 thay vì chỉ xử lý trong bộ nhớ rồi bỏ*: nếu sau này đổi embedding model cần re-embed toàn bộ, có sẵn bản text cache thì không phải parse/OCR lại file gốc lần nữa (tốn quota + thời gian). Text thô nhẹ tới mức chi phí lưu gần như bằng 0 nên đáng đánh đổi.

## 5. Chiến lược tăng tốc upload/download

### 5.A. Multipart Chunked Upload (tải lên)
- Angular chia file thành chunk **8MB** (xem lý do chọn con số này ở mục 5.D).
- **Parallel upload**: đẩy song song 3–5 chunk cùng lúc để tận dụng băng thông.
- **Resumable upload**: đứt mạng ở chunk 90/100 thì chỉ upload tiếp từ chunk 91, không tải lại từ đầu.
  - **Cơ chế cụ thể**: API S3-compatible của R2 hỗ trợ đầy đủ multipart kiểu S3, gồm `ListParts(uploadId)` — trả về danh sách part đã nhận kèm ETag. Khi Angular resume (mở lại tab, hoặc network rớt giữa chừng), chỉ cần gọi `ListParts` qua NestJS để biết đã có chunk nào, rồi tiếp tục upload phần còn thiếu. **Không cần tự dựng bảng DB riêng để track từng chunk** — R2 đã lưu sẵn state này theo `uploadId`.
  - Điều kiện: Angular phải lưu lại `uploadId` + `fileId` (VD vào `localStorage`) trước khi bắt đầu upload, để còn dùng lại khi resume sau khi đóng tab/tắt trình duyệt.
- **Luồng multipart**: NestJS gọi `CreateMultipartUpload` mở phiên trên R2 → Angular gửi từng chunk tới **`POST /uploads/part`** → NestJS `UploadPart` lên R2 rồi trả ETag về → khi đủ part, NestJS gọi `CompleteMultipartUpload` để ghép.
- **Chunk đi QUA backend, không PUT thẳng lên bucket** — khác bản plan đầu tiên, và là cách code đang chạy (`apps/web/src/app/core/upload.service.ts`, `POST /uploads/part`):
  - Không phải cấu hình CORS cho bucket, cũng không phụ thuộc việc CORS đó có đúng hay không.
  - `StorageService.presignUploadPart()` vẫn giữ lại làm phương án dự phòng nếu sau này muốn cho trình duyệt PUT thẳng — lúc đó **mới** cần bật CORS cho bucket R2 (Dashboard → R2 → bucket → Settings → CORS Policy, hoặc `wrangler r2 bucket cors put <BUCKET> --rules cors.json`) với `"ExposeHeaders": ["ETag"]`.
  - Đánh đổi đã chấp nhận: byte upload đi qua Cloud Run nên tốn CPU/băng thông của instance API và chịu giới hạn thời gian mỗi request — chunk 8MB đủ nhỏ để mỗi request ngắn, và đây chính là lý do **không** tăng chunk size lên vài chục MB.
- **Object key strategy**: key trên R2 = ID cố định, VD `{userId}/{fileId}`, **không** chứa tên file hay path thư mục người đọc được. Tên hiển thị + vị trí trong cây thư mục chỉ là dữ liệu (`name`, `folderId`) trong Postgres. Nhờ vậy rename/move file hay folder chỉ là 1 câu UPDATE trong DB, **không cần copy+delete trên R2** — giải quyết gọn việc object storage không hỗ trợ rename nguyên tử ("thư mục" trên R2 chỉ là tiền tố tên object, không phải thư mục thật).

### 5.B. Luồng xử lý bất đồng bộ (Asynchronous AI Pipeline)
Nguyên tắc UX: **không bắt người dùng chờ AI xử lý xong mới báo thành công**.
1. File ghép xong trên R2 → trả về "Đã tải lên" ngay cho Angular.
2. Đẩy tác vụ trích xuất text + tạo embedding vào **hàng đợi nền** (BullMQ trên NestJS).
3. Worker xử lý ngầm, cập nhật kết quả vào DB khi xong (Angular nhận qua Supabase Realtime).

> **Concurrency control cho các job gọi AI (embedding/OCR)**: giới hạn số job chạy song song trong BullMQ (VD: concurrency = 2-3) + retry có backoff khi Gemini trả lỗi 429 (rate limit), **tối đa 3 lần retry** (BullMQ `attempts: 3` + `backoff: exponential`). Hết 3 lần vẫn lỗi → chuyển `File.status = 'failed'` (xem mục 7.B), không tự thử lại vô hạn. Việc này đã đủ để hấp thụ mọi burst upload dù có 1 hay vài người dùng cùng lúc thao tác — không cần lo lắng về số lượng người dùng nhỏ (3-4 người), vì hàng đợi tự nhiên tuần tự hoá các lệnh gọi AI thay vì gọi trực tiếp, ồ ạt.

### 5.C. Tải xuống / truy vấn siêu tốc (get nhanh)
| Giải pháp | Cách hoạt động | Hiệu quả |
|---|---|---|
| Presigned URL trực tiếp từ R2 | Trình duyệt tải thẳng từ R2, không đi qua backend | Không tốn băng thông/CPU của API instance |
| CDN Cloudflare miễn phí đi kèm R2 | Cache tại edge Cloudflare | R2 tích hợp sẵn CDN, không cần dịch vụ riêng như Cloud CDN của GCS. **Lưu ý**: presigned URL đổi chữ ký mỗi lần ký nên cache hit thấp trừ khi dùng bucket public + custom domain (đánh đổi với rủi ro mục 12.B) |
| Range Requests (`Range: bytes=0-1024`) | Chỉ lấy phần đầu/một đoạn của file | Preview tài liệu mà không cần tải cả file 1GB |
| Redis cache cho metadata & tóm tắt | Cache tên file, size, chủ sở hữu, đoạn text tóm tắt | Tránh query liên tục vào Vector DB/Storage khi chỉ duyệt danh sách |

**Cache invalidation**: kết hợp cả 2 — (1) invalidate chủ động: mọi thao tác rename/move/delete/update đều xoá key Redis liên quan ngay trong cùng service method; (2) TTL ngắn (VD 60s) làm lưới an toàn phòng khi lỡ quên 1 đường invalidate nào đó, tránh cache kẹt vĩnh viễn.

### 5.D. Giới hạn dung lượng file & Rate Limiting

**Trần dung lượng 1 file: 2GB** (env var `MAX_FILE_SIZE_MB`, không hardcode). Lý do tính theo R2:
- Giới hạn kỹ thuật multipart của R2 giống S3: **10,000 part/object**, mỗi part 5MiB-5GiB, object tối đa 5TiB — không phải điểm nghẽn.
- **Chi phí R2**: free tier **10GB storage/tháng + 1M Class A + 10M Class B ops miễn phí**, **không tính phí egress** (khác GCS/S3 — đây là lợi thế lớn của R2). 1 file khổng lồ chủ yếu ăn vào quota **storage** tháng, không phát sinh phí băng thông ra. Trần 2GB vừa bảo vệ quota storage vừa chống tai nạn (lỡ kéo nhầm file rất lớn, giữ instance backend bận lâu vì chunk đi qua backend — mục 5.A).
- 2GB vẫn đủ cho hầu hết nhu cầu thực tế (ảnh, tài liệu, zip, video đã nén); muốn tăng chỉ sửa env var, không sửa code — nhưng nhớ free tier chỉ 10GB/tháng, vượt quá thì trả phí (\$0.015/GB-tháng vượt, không tính egress).
- Với chunk size **8MB** (mục 5.A): 2GB ÷ 8MB ≈ 256 parts — an toàn, và vẫn ổn nếu sau này tăng trần lên tới hàng chục GB.

**Rate limiting** qua `@nestjs/throttler`, khoá theo **user id** (lấy từ JWT Supabase), không theo IP — vì app bắt buộc đăng nhập, throttle theo IP sẽ phạt oan người dùng chung mạng (VD wifi công ty) trong khi theo user id thì công bằng và đúng mục tiêu chặn abuse.

| Nhóm endpoint | Giới hạn | Lý do |
|---|---|---|
| Upload session (init multipart, complete/assemble, abort, list-parts) | 30 request/phút/user | Chỉ tính các request **quản lý phiên**. Request `POST /uploads/part` chở dữ liệu chunk **không** áp hạn mức này (1 file 2GB = 256 chunk sẽ vượt ngay) — nó được kiểm soát bằng trần kích thước file + số phiên upload song song ở client |
| Duyệt file/folder (list, metadata, rename, move, delete) | 100 request/phút/user | Thao tác UI thông thường |
| AI Search (gọi Gemini) | 20 request/phút/user | Bảo vệ quota free tier Gemini, chặn spam search |
| Download / lấy presigned GET URL | 200 request/phút/user | Duyệt grid nhiều file/thumbnail có thể gọi dồn dập |

### 5.E. Download cả folder (zip bất đồng bộ)

Object storage (R2 cũng như S3/GCS) không hỗ trợ tải nguyên 1 thư mục — cần tự đóng gói. Nhất quán với triết lý "không đồng bộ" của toàn app (mục 5.B, 7.A):
1. Angular gửi yêu cầu "tải folder X" → NestJS trả về ngay trạng thái "Đang chuẩn bị..." (không treo request).
2. Đẩy job vào BullMQ: worker duyệt cây, tải toàn bộ file con từ R2 (`getObjectStream`), nén bằng `archiver` (streaming, không load hết vào RAM cùng lúc), stream thẳng file `.zip` kết quả lên R2 ở tiền tố tạm `_zips/` bằng `@aws-sdk/lib-storage` (`Upload`) — không cần biết trước dung lượng.
3. Đặt **lifecycle rule của bucket** tự xoá tiền tố `_zips/` sau 1 ngày để không đội thêm chi phí lưu trữ — qua Dashboard (R2 → bucket → Settings → Object Lifecycle Rules → Delete objects với prefix `_zips/`, age 1 ngày) hoặc `wrangler r2 bucket lifecycle`.
4. Supabase Realtime báo cho Angular khi zip sẵn sàng → hiện nút "Tải xuống" trỏ tới presigned URL của file zip.

### 5.F. Đặc thù Cloudflare R2 (bản hiện hành — quay lại từ 2026-08-14)

> ⚠️ Đã đổi provider **2 lần**: R2 (ban đầu) → GCS (2026-07-26) → **R2 lần nữa** (2026-08-14, sau khi hosting API rời Google Cloud sang Render). Mục này mô tả **trạng thái hiện tại** (R2). Đặc thù GCS dùng ở giai đoạn giữa được tóm tắt trong bảng so sánh cuối mục, chi tiết đầy đủ nằm ở changelog mục 13 nếu cần tham khảo lại.

#### Cách kết nối
- Dùng **API tương thích S3** của R2, giữ nguyên `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` — không thêm SDK riêng của Cloudflare. Toàn bộ luồng multipart/presign/ListParts/stream/delete không đổi giữa các lần chuyển provider, chỉ đổi cấu hình client.
- Credential = **R2 API Token**: Dashboard Cloudflare → R2 → *Manage API tokens* → *Create API token*, scope đúng bucket, quyền **Object Read & Write**. Cặp token nhận được dùng thẳng làm `accessKeyId`/`secretAccessKey`.
- `endpoint = https://<account_id>.r2.cloudflarestorage.com` (account ID lấy ở Dashboard → R2 → góc phải, hoặc `wrangler whoami`). `region = 'auto'` — R2 **không** phân vùng theo region như GCS/S3.
- Env tương ứng (`apps/api/.env.example`): `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_REGION=auto`, `R2_ENDPOINT` (tự dựng từ `R2_ACCOUNT_ID` nếu để trống), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE_URL` (để trống — mục 12.B).

#### Việc phải làm phía Cloudflare (checklist)
1. **CORS — không cần cấu hình.** Chunk upload đi qua `POST /uploads/part`, blob preview đi qua `/downloads/file/:id/blob` (mục 5.A/11.I) — bucket không nhận request trực tiếp từ trình duyệt. Chỉ cần khi đổi sang cho trình duyệt PUT thẳng: `wrangler r2 bucket cors put <BUCKET> --rules cors.json`.
2. **Lifecycle rule** tự xoá tiền tố `_zips/` sau 1 ngày (mục 5.E) — Dashboard → R2 → bucket → Settings → Object Lifecycle Rules, hoặc `wrangler r2 bucket lifecycle`.
3. **Public access — KHÔNG bật.** Không bật "Public Development URL" (`pub-*.r2.dev`), không gắn custom domain public; để trống `R2_PUBLIC_BASE_URL` ⇒ backend luôn cấp presigned URL (mục 12.B). Khác GCS trước đây: đây là **kỷ luật cấu hình**, không phải khoá cứng ở tầng hạ tầng.

#### So với GCS (đã dùng 2026-07-26 → 2026-08-14)
| Khía cạnh | GCS (giai đoạn giữa) | R2 (hiện tại) |
|---|---|---|
| Checksum CRC32 (AWS SDK ≥ 3.729) | Bị từ chối, phải set `requestChecksumCalculation: 'WHEN_REQUIRED'` | **Chấp nhận bình thường** — vẫn giữ cấu hình đó cho an toàn, không bắt buộc gỡ |
| CDN | Dịch vụ riêng (Cloud CDN), không kèm sẵn | **Kèm sẵn miễn phí** ở edge Cloudflare |
| Free tier | Không có — tính theo GB-tháng + egress + thao tác thật | **10GB storage/tháng + 1M Class A + 10M Class B ops + KHÔNG tính egress** |
| Public access | *Public access prevention* — khoá cứng ở tầng hạ tầng | Không có toggle tương đương — phải tự giữ kỷ luật không bật |
| Vì sao đổi lại | — | Hosting API chuyển từ Cloud Run sang **Render** (không phải Google Cloud) ⇒ lý do gốc "gom về cùng nhà cung cấp" hết hiệu lực; R2 khớp hệ sinh thái Cloudflare hơn vì web đã ở Cloudflare Workers |

## 6. Kiến trúc tổng thể

```
Angular (SPA)
   │  REST + chunk upload qua backend; download/preview bằng presigned URL
   ▼
NestJS API ─────────────────► Supabase (Postgres: metadata, roles, pgvector)
   │        ▲                        ▲
   │        │ BullMQ/Redis           │ Supabase Auth (JWT verify) + Realtime
   │        │ (AI pipeline,          │ (cập nhật thumbnailUrl live)
   │        │  thumbnail, zip job)   │
   ▼        │                        │
Cloudflare R2 (file gốc, AI artifacts, thumbnail, zip tạm)
   ▲                                          │
   └──── trình duyệt tải thẳng bằng presigned URL (GET, hỗ trợ Range)
```

- NestJS là lớp trung gian: mở/ghép phiên multipart trên R2, **nhận từng chunk upload** rồi đẩy lên R2, sinh presigned URL cho download/preview, quản lý hàng đợi nền (BullMQ), gọi embedding API, quản lý roles/permissions.
- Angular gọi thẳng Supabase Auth cho login và Supabase Realtime để nhận cập nhật live (VD: thumbnail xong), còn lại gọi qua NestJS API.
- File thật + AI artifacts + thumbnail + zip tạm đều nằm ở R2; Supabase chỉ lưu metadata + vector. Chiều **lên** đi qua backend, chiều **xuống** đi thẳng từ R2 bằng presigned URL (mục 5.A/5.C).

## 7. Tính năng Preview / Thumbnail (UI dạng Grid Card, giống Google Drive)

### 7.A. Luồng xử lý (không chặn upload)
1. **Angular**: hoàn tất upload file gốc lên R2 (chunk qua `POST /uploads/part`, mục 5.A), gửi yêu cầu ghép/đăng ký file về NestJS.
2. **NestJS**: lưu metadata vào Supabase ngay lập tức với `thumbnailUrl = null`, trả về thành công → file xuất hiện ngay trong danh sách (dạng card trống/icon).
3. **Background Queue (BullMQ)**: tải file từ R2 → tạo thumbnail → lưu ngược lên R2 (key `{userId}/{fileId}.thumb.webp`) → cập nhật `thumbnailUrl` trong DB.
4. **Supabase Realtime**: Angular lắng nghe thay đổi bảng `files`, tự cập nhật ảnh thumbnail khi có, không cần reload trang.

### 7.B. Database schema (Prisma) — đã hoàn chỉnh với Folder + DocumentChunk

```prisma
model Folder {
  id        String    @id @default(uuid())
  name      String
  parentId  String?                                    // null = thư mục gốc
  userId    String
  isStarred Boolean   @default(false)                   // gắn dấu sao — mục 11.B
  deletedAt DateTime?                                   // null = đang active; có giá trị = nằm trong Thùng rác (mục 7.E, 11.K)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  parent    Folder?  @relation("FolderTree", fields: [parentId], references: [id], onDelete: Cascade)
  children  Folder[] @relation("FolderTree")
  files     File[]
  shares    Share[]                                    // link chia sẻ công khai — mục 12.C
}

model File {
  id           String    @id @default(uuid())
  name         String                                  // "DS_diem_danh.xlsx" — chỉ để hiển thị
  extension    String                                  // "xlsx", "pdf", "zip", "png"
  r2Key        String    @unique                        // key object trên R2 = "{userId}/{id}" — ID cố định, KHÔNG chứa path (mục 5.A)
  thumbnailUrl String?                                  // null nếu thumbnail chưa xử lý xong
  size         BigInt                                   // bytes — Int (32-bit) tràn số ngay ở trần 2GB (mục 5.D), bắt buộc BigInt
  userId       String                                   // chủ sở hữu
  folderId     String?                                  // null = nằm ở thư mục gốc
  status       String    @default("uploading")          // uploading | processing | ready | failed | delete_pending
  errorMessage String?                                  // lý do lỗi khi status = 'failed', hiện cho người dùng + nút "Thử lại"
  isStarred    Boolean   @default(false)                // gắn dấu sao — mục 11.B
  deletedAt    DateTime?                                // null = đang active; có giá trị = nằm trong Thùng rác (mục 7.E, 11.K)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  folder       Folder?         @relation(fields: [folderId], references: [id], onDelete: Cascade)
  chunks       DocumentChunk[]
  shares       Share[]                                 // link chia sẻ công khai — mục 12.C
}

model DocumentChunk {
  id         String                        @id @default(uuid())
  fileId     String
  content    String                                      // đoạn text đã chunk từ AI Artifact, ~1000 ký tự/chunk (mục 4.B, quy tắc chunking ở mục 8.C)
  chunkIndex Int
  embedding  Unsupported("vector(768)")                  // khớp gemini-embedding-001 (mục 8.A)

  file       File @relation(fields: [fileId], references: [id], onDelete: Cascade)

  @@index([fileId])
}

// Cấp quyền đọc vào 1 target — dùng chung cho CẢ 2 kênh chia sẻ (mục 12.A):
//   kênh A (trực tiếp): sharedWithUserId có giá trị, token = null
//   kênh B (link):      token có giá trị, sharedWithUserId = null
// Lý do từng field ở mục 12.C.
model Share {
  id            String    @id @default(uuid())
  userId        String                                 // CHỦ SỞ HỮU (người chia sẻ)
  fileId        String?                                // ĐÚNG 1 trong 2 có giá trị (ràng buộc ở tầng app)
  folderId      String?

  // --- Kênh B: link công khai ---
  token         String?   @unique                      // slug trong URL /s/{token}
  passwordHash  String?                                // null = không đặt mật khẩu (scrypt, mục 12.C)

  // --- Kênh A: chia sẻ trực tiếp cho 1 user ---
  sharedWithUserId String?                             // id user nhận (từ auth.users)
  sharedWithEmail  String?                             // email lúc mời — để hiển thị lại trong dialog

  allowDownload Boolean   @default(true)               // false = chỉ xem trực tuyến
  expiresAt     DateTime?                              // null = không hết hạn
  viewCount     Int       @default(0)
  downloadCount Int       @default(0)
  lastAccessAt  DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  file          File?          @relation(fields: [fileId], references: [id], onDelete: Cascade)
  folder        Folder?        @relation(fields: [folderId], references: [id], onDelete: Cascade)
  notifications Notification[]

  // Không mời trùng 1 người 2 lần cho cùng 1 target. Postgres coi các NULL là
  // KHÁC nhau nên nhiều link share (sharedWithUserId = null) vẫn cùng tồn tại.
  @@unique([fileId, sharedWithUserId])
  @@unique([folderId, sharedWithUserId])
  @@index([userId])
  @@index([sharedWithUserId])
  @@index([fileId])
  @@index([folderId])
}

// Thông báo trong app (mục 12.J) — cần bảng thật vì Realtime-only sẽ mất
// thông báo khi người nhận đang offline (điểm yếu đã ghi ở mục 11.F).
model Notification {
  id        String    @id @default(uuid())
  userId    String                                     // người NHẬN thông báo
  type      String                                     // 'share_received' | 'share_revoked' | ...
  title     String
  body      String?
  linkPath  String?                                    // VD '/shared' — bấm vào là điều hướng tới
  shareId   String?
  readAt    DateTime?                                  // null = chưa đọc
  createdAt DateTime  @default(now())

  // SetNull (không Cascade): thu hồi chia sẻ vẫn giữ lại lịch sử thông báo.
  share Share? @relation(fields: [shareId], references: [id], onDelete: SetNull)

  @@index([userId, readAt])
  @@index([userId, createdAt])
}
```

- `folderId: null` = file nằm ở thư mục gốc; `Folder.parentId: null` = thư mục gốc cấp cao nhất — đủ để dựng cây thư mục cho UI duyệt file (mục 2.1).
- **Tên cột `r2Key`** — di sản đặt tên từ lần đầu dùng Cloudflare R2; giữa chừng có giai đoạn dùng GCS (2026-07-26 → 2026-08-14) tên cột KHÔNG đổi (đổi tên kéo theo migration + sửa hàng chục chỗ mà không thêm giá trị), nay quay lại R2 nên tên cột **lại đúng nghĩa đen** một cách tình cờ. Payload job dọn rác vẫn dùng field `r2Keys`.
- `onDelete: Cascade` ở cả 2 quan hệ (`Folder → File`, `File → DocumentChunk`) nghĩa là xoá 1 folder sẽ tự động xoá toàn bộ file/folder con và chunk liên quan ở tầng DB — nhưng **phải lấy danh sách object key trước khi trigger xoá DB** vì sau đó sẽ không tra được nữa (xem mục 7.E).
- `status` dùng để theo dõi vòng đời file (đang tải → đang xử lý AI/thumbnail → sẵn sàng/lỗi → đang xoá vĩnh viễn), đồng thời là điều kiện lọc trong RPC search (chỉ trả kết quả file đã `ready`, xem mục 8.C).
- **`deletedAt`**: cột riêng cho Thùng rác (mục 7.E, 11.K) — tách bạch với `status`. `deletedAt` = xoá mềm, **khôi phục được**, dữ liệu trên R2 chưa hề bị động tới, chỉ ẩn khỏi mọi view bình thường (`WHERE deletedAt IS NULL`). `status = 'delete_pending'` = giai đoạn sau, **không khôi phục được**, đang dọn object trên R2 thật sự. Hai field không loại trừ nhau về mặt thời gian: 1 file luôn có `deletedAt` được set trước, rồi mới chuyển `status = 'delete_pending'` khi người dùng (hoặc job hết hạn giữ) xác nhận xoá vĩnh viễn.
- **`status = 'failed'`**: BullMQ đã retry hết số lần cấu hình (mục 5.B) mà job trích text/OCR/embedding vẫn lỗi (VD file corrupt, PDF mã hoá mật khẩu, vượt quota Gemini vĩnh viễn cho file đó) → set `failed` + ghi `errorMessage`, dừng hẳn không thử nữa. UI hiện chip lỗi kèm nút "Thử lại" (bấm lại → set về `processing`, đẩy job mới vào queue). Tránh trường hợp file kẹt vô thời hạn ở `processing` mà không ai biết.
- File trích text ra **rỗng** nhưng không lỗi (ảnh trắng, PDF scan chất lượng kém, file rỗng...) vẫn set `ready` bình thường, chỉ đơn giản là không có `DocumentChunk` nào — vẫn tìm được theo tên file, chỉ không ra kết quả khi AI semantic search.
- **`Share` + `Notification`**: 2 bảng phát sinh thêm cho tính năng chia sẻ — `File`/`Folder` **không** thêm cột nào (không có `isPublic`, không có `shareToken` nhúng sẵn). Lý do dùng bảng riêng thay vì 1 cột trên `File`: 1 item có thể được cấp quyền nhiều lần với điều kiện khác nhau (mời 3 người + 1 link hết hạn 7 ngày), và thu hồi phải độc lập với vòng đời file. Chi tiết từng field + các bẫy giao cắt (Thùng rác, verify hậu duệ, throttle IP, quyền đọc-không-sở-hữu) ở **mục 12**.
- Khi triển khai phần còn lại của MVP phụ (roles editor/viewer, mời theo email) sẽ bổ sung thêm bảng liên quan (VD `ShareMember`) — mục 12.A đã chừa sẵn đường nối, xem mục 2.2 & câu hỏi mở.

### 7.C. Logic tạo thumbnail theo loại file (NestJS worker)
| Loại file | Thư viện/giải pháp | Mô tả |
|---|---|---|
| Ảnh (PNG/JPG/WEBP) | `sharp` | Resize còn ~300x200px, nén quality 75% → ảnh chỉ ~15-20KB |
| PDF | `pdf-to-img` hoặc `pdf2pic` | Chụp lại trang đầu tiên, xuất PNG |
| Video (MP4/MOV/WEBM...) | MVP: chỉ icon. Production: `fluent-ffmpeg`/`ffmpeg-static` chụp frame ở giây thứ 1 → dùng lại pipeline resize/nén của `sharp` (như ảnh) | Giai đoạn MVP tránh thêm dependency ffmpeg (binary nặng, cần cài trên server) |
| Nén/cài đặt (ZIP, RAR, EXE...) | Không xử lý | Angular tự hiển thị icon theo `extension` |
| Office (Word/Excel/PPT) | MVP: chỉ icon. Production: LibreOffice CLI → convert sang PDF → dùng lại pipeline PDF | Giai đoạn MVP ưu tiên tiết kiệm tài nguyên |

### 7.D. UI phía Angular
- Layout: CSS Grid `repeat(auto-fill, minmax(180px, 1fr))`, mỗi file là 1 card (preview area cố định 120px cao + phần meta tên/ngày).
- Card hiển thị `thumbnailUrl` nếu có, fallback icon theo `extension` nếu chưa có/không hỗ trợ preview.
- Component mẫu và CSS đã có sẵn, tham khảo file gốc `document_preview_plan.pdf` khi implement.
- Prototype trực quan (dạng khác, giàu tương tác hơn) đã dựng ở dạng Artifact riêng — xem nhật ký thay đổi ngày 2026-07-15.

### 7.E. Xoá mềm (Thùng rác) → Xoá vĩnh viễn (Cascading Delete)

**Bản cũ** (đã bỏ): bấm "Xoá" là xoá vĩnh viễn gần như ngay lập tức (chỉ trễ vài giây do job nền dọn object storage), **không có đường khôi phục**. Rủi ro thật cho 1 app lưu trữ cá nhân — lỡ tay là mất hẳn. Nâng cấp thành **2 giai đoạn**, phần UI/endpoint chi tiết ở mục 11.K.

#### Giai đoạn 1 — Xoá mềm (vào Thùng rác, khôi phục được)
1. Bấm "Xoá" trên 1 file/folder (từ Folder lens hoặc Type lens, mục 11.H) → NestJS set `deletedAt = now()` cho chính item đó.
2. Nếu là **folder**: đệ quy set `deletedAt = now()` cho **toàn bộ file/folder con** cùng thời điểm (dùng lại đúng cơ chế duyệt cây từng dùng để gom object key ở bản cũ). Nhờ vậy mọi truy vấn danh sách bình thường (Folder lens, Type lens, `GET /files/stats`, RPC AI search mục 8.C) chỉ cần thêm `WHERE deletedAt IS NULL` — không cần kiểm tra đệ quy tổ tiên mỗi lần list.
3. Trả kết quả ngay, ẩn khỏi UI đang duyệt ngay lập tức (đúng triết lý bất đồng bộ toàn app) — nhưng khác bản cũ, **không** đẩy job dọn storage nào ở bước này. Dữ liệu vẫn nguyên vẹn trên R2, chỉ đổi 1 cột timestamp trong Postgres.
4. Item xuất hiện trong "🗑 Thùng rác" (mục 11.K) — nhưng **chỉ hiện trash root** (item bị xoá trực tiếp), không rã cây hiện từng file/folder con bị cascade theo (giống Google Drive).

#### Giai đoạn 2 — Xoá vĩnh viễn (không khôi phục được, dùng lại đúng cơ chế cũ)
Xảy ra khi (a) người dùng bấm "Xoá vĩnh viễn" từ Thùng rác, hoặc (b) hết hạn giữ mặc định **`TRASH_RETENTION_DAYS` = 30 ngày** (env var, cùng pattern với `MAX_FILE_SIZE_MB` — không hardcode) do job định kỳ quét dọn.

**Xoá vĩnh viễn 1 file:**
1. NestJS set `status = 'delete_pending'` → trả kết quả ngay cho Angular.
2. Đẩy job vào BullMQ: xoá trên R2 3 object của file (gốc theo `r2Key`, thumbnail `.thumb.webp`, AI artifact `.txt`) → sau khi xoá thành công, hard-delete row `File` trong Postgres (Prisma tự cascade xoá `DocumentChunk` con).

**Xoá vĩnh viễn 1 folder:**
1. NestJS đánh dấu bắt đầu xoá vĩnh viễn cho folder + duyệt đệ quy toàn bộ file/folder con.
2. Đẩy job vào BullMQ: **truy hết danh sách object key của mọi file con** (kể cả trong folder con lồng nhau) trước → xoá toàn bộ object liên quan trên R2 → sau đó mới hard-delete `Folder` gốc trong Postgres (Prisma cascade tự xoá toàn bộ folder/file/chunk con theo quan hệ `onDelete: Cascade`).

> Thứ tự luôn là **xoá trên R2 trước, xoá DB sau** — vì R2 và Postgres là 2 hệ thống khác nhau, không thể gói trong 1 transaction. Nếu xoá DB trước mà job xoá object thất bại giữa chừng, sẽ mất luôn đầu mối để dọn rác trên R2 (orphaned object).

3. Angular xử lý optimistic: bấm "Xoá vĩnh viễn" từ Thùng rác thì xoá luôn item khỏi danh sách phía client ngay khi nhận response thành công — không cần chờ Supabase Realtime báo lại, vì đây là hành động chờ-biến-mất, không có trạng thái gì để đồng bộ ngược (khác trường hợp thumbnail xong cần cập nhật ảnh).

**Job định kỳ dọn Thùng rác quá hạn** (mới — BullMQ repeatable job, VD chạy 1 lần/ngày): query mọi trash root có `deletedAt <= now() - TRASH_RETENTION_DAYS ngày` (file/folder mà bản thân bị trash trực tiếp, không phải con bị cascade — xem điều kiện lọc trash root ở mục 11.K) → chạy đúng luồng "Xoá vĩnh viễn" ở trên cho từng root.

#### Khôi phục (Restore) — chỉ áp dụng cho trash root
1. Set `deletedAt = null` cho chính item.
2. Nếu là folder: đệ quy set `deletedAt = null` cho toàn bộ con (đối xứng với bước cascade lúc xoá mềm).
3. Áp lại đúng quy tắc trùng tên kiểu Windows Explorer đã chốt ở mục 2.1: nếu vị trí gốc (`folderId` cũ — không đổi vì xoá mềm không dời file) đã có sẵn file/folder khác trùng tên (tạo mới sau khi xoá) → tự thêm hậu tố `(1)(2)...`. Chỉ so trùng tên với các item **đang active** (`deletedAt IS NULL`), bỏ qua các item khác cũng đang nằm trong Thùng rác.
4. Vì xoá mềm không đổi `folderId`, **không cần thêm cột `originalFolderId`** hay dời file sang 1 vị trí ảo nào — khôi phục tự nhiên trả file về đúng chỗ cũ, không phát sinh field mới ngoài `deletedAt`.

> **Trường hợp không xảy ra**: khôi phục 1 file khi folder cha *cũng* đang bị xoá mềm — không xảy ra vì Thùng rác chỉ hiện trash root, không hiện file con của 1 folder đã bị xoá riêng lẻ để bấm restore. Muốn lấy lại file đó, người dùng khôi phục cả folder cha (tự kéo theo toàn bộ con, đúng bước 2 ở trên).

## 8. Tích hợp AI Embedding (Google Gemini)

### 8.A. Vì sao chọn Gemini Embedding API
Đáp ứng 3 tiêu chí của MVP cá nhân: **không tốn chi phí + không cần host local + tích hợp mượt với NestJS**.
- Model: **`gemini-embedding-001`** — output 768 dimensions (dùng `output_dimensionality: 768` để khớp cột `vector(768)` trong Supabase pgvector).
- Lấy API key miễn phí tại `aistudio.google.com` bằng tài khoản Google, không cần thẻ VISA.
- SDK: `npm install @google/genai` (package chính thức, đã verify tồn tại và đúng cách khởi tạo).
- Backup nếu Gemini đổi chính sách free tier: **Jina AI Embeddings v4** (free 1M tokens/tháng, mạnh long-context ~32k token + multimodal).

> ⚠️ **Lưu ý rủi ro**: chưa xác thực được con số rate-limit chính xác của free tier (cần tự kiểm tra tại `aistudio.google.com/rate-limit` sau khi có tài khoản — đừng giả định số liệu cụ thể khi lên kế hoạch scale). Free tier của các nhà cung cấp AI có thể thay đổi chính sách bất kỳ lúc nào — đây là lý do bọc embedding call trong 1 service riêng (`AiEmbeddingService`) để dễ swap provider mà không sửa code nơi gọi.
> ⚠️ Tránh dùng model cũ `text-embedding-004` — không còn xuất hiện trong docs hiện tại của Google, đã được thay bằng `gemini-embedding-001` (text-only) / `gemini-embedding-2` (đa phương thức, mới hơn, hỗ trợ cả ảnh/video/audio/PDF nếu sau này muốn nâng cấp).

### 8.B. Luồng tích hợp trong NestJS
```typescript
import { Injectable } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';

@Injectable()
export class AiEmbeddingService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.ai.models.embedContent({
      model: 'gemini-embedding-001',
      contents: text,
      config: { outputDimensionality: 768 },
    });
    return response.embeddings[0].values;
  }
}
```

### 8.C. Luồng AI Search hoàn chỉnh
1. **Khi upload**: Angular đẩy file lên R2 (qua backend, mục 5.A) → NestJS trích text (mục 4.B) → cắt nhỏ (chunk, xem quy tắc bên dưới) → gọi `generateEmbedding(chunkText)` cho từng chunk (chạy nền qua BullMQ, xem mục 5.B) → lưu vào bảng `DocumentChunk` (mục 7.B), set `File.status = 'ready'` khi xong. **Với ảnh**: từ 2026-08-18 còn thêm nhánh Gemini vision auto-caption + BGE-M3 — xem mục 8.E.

> **Quy tắc chunking (chốt phương án đơn giản nhất)**: cắt text thô theo **độ dài cố định 1000 ký tự, overlap 100 ký tự** (10%) — cắt thẳng bằng vòng lặp string, **không dùng thư viện ngoài** (VD LangChain text splitter) để tránh thêm dependency cho MVP. Overlap giúp không mất ngữ cảnh câu bị cắt ngang giữa 2 chunk. Không cắt theo câu/đoạn (semantic chunking) ở giai đoạn này vì phức tạp hơn nhiều mà lợi ích chưa rõ ràng cho quy mô cá nhân — có thể nâng cấp sau nếu chất lượng search chưa tốt.
2. **Khi tìm kiếm**: Angular gửi câu hỏi → NestJS gọi `generateEmbedding(cauHoi)` lấy query vector → gọi RPC `match_document_chunks` bên dưới (**luôn truyền `user_id` của người đang đăng nhập** — bắt buộc, tránh lộ nội dung file của user khác) → trả về Angular.

> **Trigger tìm kiếm**: chỉ gọi API khi người dùng nhấn Enter (hoặc bấm nút search), **không** debounce gọi theo từng ký tự gõ — tránh tốn quota Gemini free tier vô ích, khớp với rate limit 20 request/phút/user đã chốt ở mục 5.D.

**RPC search (Supabase SQL function)** — top-K = 10, không áp ngưỡng similarity cứng (hiển thị % điểm cho người dùng tự đánh giá thay vì cắt cứng khi chưa có dữ liệu thực tế để tune ngưỡng hợp lý):
```sql
create or replace function match_document_chunks(
  query_embedding vector(768),
  match_user_id uuid,
  match_count int default 10
)
returns table (
  file_id uuid,
  file_name text,
  content text,
  similarity float
)
language sql stable
as $$
  select
    f.id as file_id,
    f.name as file_name,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity
  from "DocumentChunk" dc
  join "File" f on f.id = dc."fileId"
  where f."userId" = match_user_id
    and f.status = 'ready'
    and f."deletedAt" is null
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;
```
> `f."deletedAt" is null` chặn file đang nằm trong Thùng rác (mục 7.E, 11.K) khỏi kết quả AI search — file đã xoá mềm không nên xuất hiện khi search dù `status` vẫn là `ready`.
> Với quy mô cá nhân (dự kiến vài nghìn-chục nghìn chunk), sequential scan của Postgres đủ nhanh — **chưa cần** tạo index chuyên dụng (ivfflat/hnsw) cho pgvector ở giai đoạn MVP. Cân nhắc thêm khi search bắt đầu chậm rõ rệt.

### 8.D. Text Extraction (bước tiền xử lý trước khi embed — quan trọng nhất trong RAG pipeline)

Nếu bước này trích thiếu/sai chữ thì embedding sẽ sai lệch hoàn toàn dù model embedding có tốt đến đâu. Chia theo loại file, ưu tiên thư viện thuần Node.js (không cần cài Python/Java lên server):

| Loại file | Thư viện | Ghi chú |
|---|---|---|
| PDF (có text layer) | **`pdf-parse`** | Đã verify: bản 2.4.5, đang active maintain, ~5.6M download/tuần, không có lỗ hổng bảo mật đã biết. Ném Buffer vào, nhận text thô ngay. |
| PDF (cần kiểm soát sâu hơn, VD lấy text theo từng trang) | `pdfjs-dist` (Mozilla) | Mạnh hơn nhưng setup phức tạp hơn cho server-side (cần build "legacy" không phụ thuộc DOM trình duyệt). Dùng khi `pdf-parse` không đủ. |
| DOCX | **`mammoth`** | Convert sang Markdown/HTML sạch, giữ heading/bullet — tốt cho việc chunking theo cấu trúc. |
| TXT, code, md, json | Đọc trực tiếp bằng `fs` | Không cần thư viện |
| XLSX (**tính năng phụ**, không thuộc MVP chính) | `xlsx` (SheetJS), convert sheet sang CSV bằng `sheet_to_csv()` | Không lấy text thô — bảng dữ liệu chuyển sang CSV để giữ cấu trúc hàng/cột, AI đọc CSV tốt hơn nhiều so với text dính chữ. |
| PPTX (**tính năng phụ**, không thuộc MVP chính) | `officeparser` | Trích text theo từng Slide riêng biệt; nên embed mỗi Slide thành 1 chunk để tránh AI lẫn ngữ cảnh giữa các slide. |
| Ảnh (PNG/JPG) & PDF scan (không có text layer) | **Gemini OCR** (không dùng `tesseract.js` cho MVP) | Xem code mẫu bên dưới. Tránh cài OCR local vì ngốn CPU/RAM server; ủy thác cho Gemini — cùng API key đã có, đọc tiếng Việt tốt hơn Tesseract. |

> **Về "all-in-one" library**: có 2 gói được đề xuất — `office-text-extractor` và `officeparser`. Đã verify: `office-text-extractor` dùng đúng phải qua `getTextExtractor().extractText({ input, type: 'buffer' })` (không phải default-export function như một số ví dụ hay ghi sai) và là **pure ESM từ v2.0.0** (cần cấu hình project cho phù hợp). `officeparser` được ưu tiên hơn cho tính năng phụ XLSX/PPTX vì có sẵn chế độ xuất "RAG Chunks" (tự chia đoạn kèm metadata trang/heading/sheet) — nhưng cú pháp chi tiết cần test lại khi thực sự cài đặt vì có thể khác giữa các version.

### Module `DocumentParserService` (NestJS)
```typescript
import { Injectable } from '@nestjs/common';
import * as pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';
import { GoogleGenAI } from '@google/genai';

@Injectable()
export class DocumentParserService {
  private ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  async extractText(fileBuffer: Buffer, extension: string, mimeType: string): Promise<string> {
    switch (extension.toLowerCase()) {
      case 'pdf': {
        const pdfData = await pdfParse(fileBuffer);
        return pdfData.text;
      }
      case 'docx': {
        const docxData = await mammoth.extractRawText({ buffer: fileBuffer });
        return docxData.value;
      }
      case 'png':
      case 'jpg':
      case 'jpeg':
        return this.runGeminiOcr(fileBuffer, mimeType);
      default:
        throw new Error(`Định dạng ${extension} chưa được hỗ trợ để trích xuất text`);
    }
  }

  // Lưu ý: model OCR ('gemini-3.5-flash') KHÁC với model embedding ('gemini-embedding-001')
  // dùng trong AiEmbeddingService — hai lệnh gọi khác nhau, cùng chung 1 API key.
  private async runGeminiOcr(fileBuffer: Buffer, mimeType: string): Promise<string> {
    const uploadedFile = await this.ai.files.upload({
      file: fileBuffer,
      config: { mimeType },
    });

    const interaction = await this.ai.interactions.create({
      model: 'gemini-3.5-flash',
      input: [
        { type: 'text', text: 'Trích xuất toàn bộ chữ trong ảnh này, giữ nguyên thứ tự dòng, không thêm bớt.' },
        { type: 'image', uri: uploadedFile.uri, mime_type: uploadedFile.mimeType },
      ],
    });

    return interaction.output_text;
  }
}
```

> ⚠️ **Mục 8.A-8.D mô tả bản thiết kế gốc (chỉ Gemini)** — code thật đã tiến hoá xa hơn: nhánh embedding chính hiện là **BazaarLink** (OpenAI-compatible) với fallback tự động sang Gemini khi hết credit (`AiEmbeddingService`), và OCR ảnh dùng chung cơ chế fallback đó (`DocumentParserService`). Từ **2026-08-18**, tìm kiếm không còn chỉ dựa 1 embedding — xem **mục 8.E** để biết hành vi hiện tại.

### 8.E. Hybrid Search (text + image) — bổ sung 2026-08-18

**Vấn đề phát hiện khi dùng thật**: semantic search 1 model (mục 8.A-8.C) bỏ sót 2 kiểu truy vấn phổ biến — (1) **từ khoá chính xác** (mã số, tên riêng) đôi khi thua embedding vì cosine similarity không ưu tiên khớp đúng chữ; (2) **ảnh** hoàn toàn không tìm được bằng mô tả ngôn ngữ tự nhiên vì trước đó chỉ OCR chữ hiện trong ảnh, không hiểu nội dung ảnh (vật thể, màu, số áo...).

#### Kiến trúc: 4 nhánh song song, fuse bằng RRF

| Nhánh | Model | Bắt được |
|---|---|---|
| `dense` | BazaarLink / Gemini fallback (768d) | Semantic tổng quát |
| `bge` | BAAI/bge-m3 qua HF Inference API (1024d) | Semantic đa ngôn ngữ, tiếng Việt tốt |
| `fts` | Postgres `tsvector` + GIN + `unaccent` | Từ khoá chính xác, accent-insensitive |
| *(ảnh)* | Gemini vision auto-caption → text như trên | Vật thể/màu/số áo/bối cảnh trong ảnh |

**Vì sao KHÔNG dùng CLIP/SigLIP cho ảnh** (dù đây là lựa chọn "đúng sách vở" cho text↔image search): đã thử `google/siglip-base-patch16-224`, `openai/clip-vit-base-patch32`, `sentence-transformers/clip-ViT-B-32`/`L-14` — **HF Inference Providers 2025 không host serverless model nào trong nhóm này** (`"Model not supported by provider hf-inference"`). Pivot sang **Gemini vision auto-captioning**: ảnh được mô tả bằng text (OCR + mô tả cảnh + từ khoá, xem dưới), text này chunk/embed như tài liệu thường ⇒ tự động lọt vào cả 3 nhánh `dense`/`bge`/`fts` mà không cần code/schema riêng cho "nhánh ảnh". Bảng `ImageEmbedding` (vector SigLIP) vẫn giữ trong schema, tắt qua `HF_ENABLE_SIGLIP=false`, để bật lại nếu sau này tự host hoặc HF phục vụ lại.

**Prompt vision** ép Gemini trả 3 khối: `OCR` (chữ hiện trong ảnh), `MÔ TẢ` (2-4 câu tự nhiên: vật thể chính, màu, số hiệu, bối cảnh), `TỪ KHOÁ` (5-15 từ, **bắt buộc gồm tên gọi dân dã** nếu là động/thực vật/món ăn — ví dụ ảnh hoa xuyến chi phải có thêm "cứt lợn, cỏ hôi, đơn kim" — để query bằng tên thông tục vẫn tìm ra).

**Fusion — Reciprocal Rank Fusion** (k=60) trên top-20 mỗi nhánh, sau đó **lọc theo ngưỡng cosine** (không phải chỉ dựa rank): dense ≥ 0.6 hoặc bge ≥ 0.65 (1 nhánh rất tự tin), HOẶC dense ≥ 0.45 **và** bge ≥ 0.55 (2 nhánh đồng thuận), HOẶC có FTS hit — loại các match yếu mà RRF vẫn xếp vào top-K. % hiển thị lấy trực tiếp từ cosine thật (không normalize theo top của batch) để có ý nghĩa tuyệt đối.

**Rerank cuối** bằng cross-encoder `BAAI/bge-reranker-v2-m3` (HF) — chấm điểm cặp (query, doc) chính xác hơn nhiều so với bi-encoder khi 2 kết quả gần giống nhau (VD "cầu thủ số 49" giữa 2 ảnh cầu thủ khác số áo): score ~0.98 cho khớp đúng, ~0.01 cho sai — phân biệt rõ ràng hơn RRF thuần. Item bị reranker chấm < 0.05 bị loại (rác chắc chắn). Best-effort: HF lỗi thì giữ nguyên thứ tự RRF.

**Query robustness**: query < 2 ký tự trả rỗng thẳng (tránh match rác kiểu 1 chữ cái trùng ngẫu nhiên trong caption); leet-speak (`0→o,1→i,3→e,4→a,5→s,7→t,@→a`) tự sinh thêm 1 biến thể embed song song nếu khác bản gốc (VD `h0a`→`hoa`, `g4rn4cho`→`garnacho`); FTS match cả bản có dấu lẫn bản `unaccent` (Postgres extension) nên "cau thu" vẫn ra "cầu thủ".

#### Vấn đề vận hành gặp phải (đáng nhớ để không lặp lại)

| Vấn đề | Nguyên nhân | Cách xử lý |
|---|---|---|
| HF Inference API cũ chết DNS | `api-inference.huggingface.co` ngừng phục vụ, gộp vào Inference Providers | Đổi `HF_BASE_URL=https://router.huggingface.co`, path đổi thành `/hf-inference/models/{id}/pipeline/{task}` |
| SigLIP/CLIP không host được | HF router 2025 không có provider nào serve nhóm model này serverless | Pivot toàn bộ nhánh ảnh sang Gemini vision auto-caption (xem trên) |
| BazaarLink hết credit (HTTP 402) | Free/trial credit dùng hết giữa lúc test | `AiEmbeddingService` + `DocumentParserService` tự phát hiện 402, chuyển sang Gemini direct cho phần còn lại của session (đánh dấu `bazaarDisabled`, không thử lại BazaarLink cho tới khi restart) |
| Gemini free tier 20 request/ngày/model | Quota rất thấp, dễ hết khi test dồn dập | Đổi `GEMINI_OCR_MODEL` sang model khác (mỗi model có bucket quota riêng, VD `gemini-3.5-flash` → `gemini-3.5-flash-lite`) |
| Reranker response shape không cố định | HF trả `[[obj0,...,objN]]` (1 outer, N inner) HOẶC `[obj0,...,objN]` (flat) tuỳ lúc | `rerankPairs()` tự nhận diện + chuẩn hoá cả 2 shape trước khi đọc `.score` |

Chi tiết đầy đủ (kiến trúc, code, log test thật với ảnh cầu thủ Garnacho/Cantona) nằm ở \`HYBRID_SEARCH.md\` (gốc repo, ngoài phạm vi Git của \`apps/\`).

## 9. Câu hỏi mở / cần quyết định tiếp

1. **Versioning file thật sự** (giữ lại các bản cũ khi người dùng chủ động upload đè lên 1 file đã có, khác với việc tự thêm hậu tố `(1)(2)` khi trùng tên mục 2.1) — có cần giữ lịch sử phiên bản không, hay chỉ cho phép 1 bản mới nhất?
2. Ngưỡng kích thước để bật chunked multipart upload là bao nhiêu (mọi file hay chỉ file > X MB, hay luôn bật multipart cho mọi file để đồng nhất logic)?
3. Cần tự kiểm tra rate limit thực tế của Gemini free tier tại `aistudio.google.com/rate-limit` trước khi launch.
4. **Đăng nhập Google (OAuth)** — có nằm trong MVP không? Nếu có cần cấu hình OAuth provider trong Supabase dashboard + route callback bên Angular. Chưa quyết, để **phụ**, thêm sau nếu cần (Supabase Auth hỗ trợ sẵn, không tốn nhiều công khi cần bật).
5. **Thiết kế UI chi tiết cho tiến trình upload** (progress bar theo % chunk, nút tạm dừng/hủy...) — cố tình **để phụ**, chưa thiết kế sâu vì cần xem lại có khớp với luồng MVP + các phương pháp kỹ thuật đã chốt (mục 5.A resumable qua `ListParts`) hay không; sẽ tính cụ thể khi bắt tay implement, có thể đổi cách làm giữa chừng nếu phát sinh vấn đề.
6. **Phân trang/infinite scroll** cho danh sách file khi số lượng file tăng lên — chưa thiết kế, cần trước khi launch thật (số file nhiều) nhưng không chặn MVP ban đầu (ít file).
7. Tính năng "gợi ý file/folder" trên Dashboard (xuất hiện trong 1 kịch bản mô tả UI được chia sẻ) — **chưa nằm trong scope MVP chính lẫn phụ**, chỉ là ý tưởng minh hoạ, không thiết kế trừ khi được xác nhận là tính năng thật.
8. **Web Push thật (Phương án 2, mục 11.F)** — chỉ làm nếu sau khi dùng thử Browser Notification API (Phương án 1) thấy thật sự cần thông báo lúc đã tắt tab/trình duyệt. Chưa quyết, để mở.
9. ~~Có tắt public access của bucket không?~~ — **đã đóng khi ở GCS (2026-07-26 → 2026-08-14)**, **tái mở một phần khi quay lại R2 (2026-08-14)**: `R2_PUBLIC_BASE_URL` để trống + không bật Public Development URL nên mọi đường đọc đều là presigned, nhưng đây lại là **kỷ luật cấu hình** thay vì khoá cứng hạ tầng như GCS (mục 12.B). Câu hỏi còn lại: có cần dùng **CDN Cloudflare** (đã kèm sẵn với R2, khác Cloud CDN của GCS phải bật riêng) trước bucket không? Chỉ cân nhắc nếu đo thấy grid thumbnail chậm — và phải giải quyết việc presigned URL đổi chữ ký mỗi lần ký làm cache hit thấp (mục 5.C).
10. **Mời email chưa có tài khoản** (pending invite — cấp quyền tự động khi người đó đăng ký sau) — mục 12.I cố tình không làm ở lượt đầu. Xem lại nếu thực tế hay gặp cảnh "gửi cho người chưa dùng app".

## 10. Khoảng trống & rủi ro cần xử lý (gap analysis)

Rà lại toàn bộ plan, đây là những chỗ **chưa được thiết kế** dù đã có nhiều quyết định kỹ thuật khác — xếp theo mức độ ưu tiên.

### 10.A. Đã giải quyết (trước đó là "nghiêm trọng", nay đã có thiết kế cụ thể)
| Gap | Đã giải quyết ở đâu |
|---|---|
| Cấu trúc folder trong DB | ✅ Model `Folder` (cây qua `parentId`) + `File.folderId` — mục 7.B |
| Schema chunk + vector (phát hiện thêm, còn nghiêm trọng hơn cả folder) | ✅ Model `DocumentChunk` — mục 7.B |
| CORS cho bucket | ✅ Không cần nữa: chunk upload + blob preview đều đi qua backend — mục 5.A/5.F |
| Move/Rename trên object storage | ✅ Object key = ID cố định, rename/move chỉ là update DB — mục 5.A |
| Cascading delete | ✅ Luồng xoá R2 trước → DB sau, cho cả file và folder — mục 7.E |
| Download cả folder (phát hiện thêm) | ✅ Nén zip bất đồng bộ qua BullMQ — mục 5.E |
| Bảo mật AI Search theo user (phát hiện thêm) | ✅ RPC luôn filter `user_id` — mục 8.C |
| Drag & drop upload (phát hiện qua rà kịch bản UI) | ✅ Chốt kéo thả là tương tác chính + picker dự phòng — mục 2.1 |
| Trùng tên khi upload/tạo mới | ✅ Tự thêm hậu tố kiểu Windows Explorer `(1)(2)` — mục 2.1 |
| Resume upload khi mất phiên giữa chừng | ✅ Dùng `ListParts` của API S3-compatible (R2), không cần bảng track riêng — mục 5.A |
| Cloudflare R2 không chạy ổn khi deploy/kiểm thử trên Google Cloud (2026-07-26) | ✅ *(lịch sử)* Bỏ R2, chuyển sang GCS; **đã đảo ngược 2026-08-14** — hosting API rời Cloud Run sang Render nên lý do gốc hết hiệu lực, quay lại R2 — mục 5.F |
| Bucket cho đọc ẩn danh (`pub-*.r2.dev`) | ⚠️ Tái mở một phần từ 2026-08-14: không bật Public Development URL + để trống `R2_PUBLIC_BASE_URL` là **kỷ luật cấu hình** (GCS trước đây khoá cứng ở hạ tầng) — mục 5.F, 12.B |
| File xử lý AI lỗi vĩnh viễn, kẹt ở `processing` | ✅ Thêm `status: 'failed'` + `errorMessage` + nút thử lại — mục 7.B |
| NestJS xác thực JWT bằng cách nào | ✅ `passport-jwt` + Supabase JWT secret — mục 3 |
| Xoá vĩnh viễn gần như ngay lập tức, không có Thùng rác/khôi phục | ✅ Thêm cột `deletedAt` (File + Folder) — xoá mềm giữ 30 ngày trước khi xoá vĩnh viễn thật — mục 7.E, 11.K |

**Còn là rủi ro cần theo dõi (không phải thiếu thiết kế, mà là giới hạn nhà cung cấp không thể "giải quyết" bằng code):**
| Rủi ro | Ghi chú |
|---|---|
| Supabase DB 500MB cap | Free tier chỉ 500MB Postgres — ước tính chứa ~150.000 vector 768-chiều trước khi đầy (dựa trên ~3KB/vector). Theo dõi thực tế; khi gần đầy thì nâng lên gói Pro ($25/tháng) hoặc dọn bớt chunk cũ. |
| Supabase auto-pause | Project free tier tự pause sau 1 tuần không hoạt động. Chấp nhận rủi ro này cho side project cá nhân (không đáng để tự động hoá ping/cron giữ project sống) — chỉ cần nhớ vào Supabase dashboard bấm resume nếu app "chết" sau thời gian dài không dùng. |

### 10.B. Cần biết trước khi launch (không chặn thiết kế, nhưng sẽ cần sớm)
| Gap | Vấn đề |
|---|---|
| Local dev setup | Cần Redis chạy local cho BullMQ, quản lý `.env`, phân biệt Supabase project dev vs prod. |
| Duplicate/dedup detection | Liên quan mục tiêu tối ưu dung lượng (mục 4) nhưng chưa tính: 2 file giống hệt (theo hash) có nên lưu chung 1 bản không? |
| Phân trang/infinite scroll danh sách file | Chưa thiết kế — xem mục 9.6, không chặn MVP vì lúc đầu ít file |
| ~~Bucket đang public~~ (`pub-*.r2.dev` cho đọc ẩn danh) | ⚠️ Tái mở một phần (2026-08-14, quay lại R2): không bật Public Development URL + để trống `R2_PUBLIC_BASE_URL` — cần tự kiểm tra định kỳ trên Dashboard Cloudflare rằng toggle này vẫn tắt, vì không còn khoá cứng như GCS *Public access prevention* — mục 5.F, 12.B. |
| **Free tier R2 giới hạn 10GB/tháng** (trở lại từ 2026-08-14, sau giai đoạn GCS không có free tier cố định) | R2 free: 10GB storage + 1M Class A + 10M Class B ops/tháng, **egress miễn phí**. Theo dõi dung lượng tổng qua Dashboard R2; vượt ngưỡng thì trả phí theo GB-tháng (không tính egress) — rẻ hơn GCS đáng kể nhờ egress-free. |

### 10.C. Có thể để sau (không khẩn với MVP cá nhân)
- Observability/error monitoring (Sentry hoặc tương tự)
- Chiến lược test (unit/e2e)
- Xem file trực tiếp trong app (PDF viewer, video player) hay chỉ tải về?
- Chi tiết cách kết hợp semantic search + full-text search (weighting) khi cả 2 cùng chạy

## 11. Cá nhân hoá & Điều hướng nâng cao ("râu ria" — dựa trên tham khảo UI Google Drive)

Nhóm các tính năng làm app "có hồn" hơn ngoài core lưu trữ + AI search. Phân loại rõ cái nào rẻ (làm luôn ở MVP chính vì gần như free) và cái nào nên để MVP phụ.

### 11.A. Sắp xếp (Sort) & Lọc (Filter) — MVP chính, vì gần như miễn phí để làm
- **Sort**: theo tên (A-Z/Z-A), theo ngày sửa đổi (mới nhất/cũ nhất), theo dung lượng (lớn/nhỏ) — chỉ là tham số `orderBy` thêm vào `GET /files` (`prisma.file.findMany({ orderBy: {...} })`), mặc định `updatedAt desc`. Không tốn thêm schema.
- **Filter theo loại file**: nhóm `extension` thành nhóm hiển thị — mapping tĩnh ở Angular (VD `{pdf: 'Tài liệu', xlsx: 'Tài liệu', png: 'Ảnh', ...}`), không cần lưu thêm cột "category" trong DB vì suy ra trực tiếp từ `extension` sẵn có.
  - **Nâng cấp**: cơ chế filter theo loại này được phát triển thành hẳn 1 **lăng kính điều hướng riêng** (sidebar "Theo loại" với 7 nhóm + số đếm + breadcrumb folder cha) ở **mục 11.H** — đây là nơi mô tả đầy đủ. Phần "Filter" ở đây là nền tảng backend (query param `extension IN (...)`), 11.H là lớp IA/UI dựng trên nó.
- Cả 2 (sort & filter) đều là query param thêm vào endpoint list đã có — không phát sinh model mới. **Sort** áp dụng trong CẢ 2 lăng kính (là control trên toolbar, không phụ thuộc đang duyệt theo Thư mục hay theo Loại).

### 11.B. Gắn dấu sao (Favorite) — MVP phụ
- Thêm `isStarred: Boolean` vào cả `File` và `Folder` (đã cập nhật ở mục 7.B).
- 1 view riêng "Có gắn dấu sao" (giống sidebar Google Drive) = `WHERE isStarred = true AND userId = ...`, tái dùng thẳng RPC/query list hiện có, chỉ thêm điều kiện lọc.
- Toggle qua 1 PATCH endpoint đơn giản (`PATCH /files/:id { isStarred: true }`).

### 11.C. Cây thư mục (sidebar) & Breadcrumb — MVP chính (thuộc nhóm "duyệt file" cốt lõi)
- **Sidebar dạng cây**: expand/collapse từng node, nhưng **lazy load** — chỉ gọi API lấy `children` của 1 folder khi người dùng bấm mở rộng node đó (`GET /folders/:id/children`), **không load toàn bộ cây 1 lần** ngay từ đầu. Quan trọng vì nếu cây sâu/nhiều folder, load hết 1 lần sẽ chậm và phí băng thông không cần thiết.
- **Breadcrumb** phía trên Grid Card (VD `Gốc > Dự án > Ảnh`): tính bằng cách lần theo `parentId` ngược lên gốc — cache lại ở Angular mỗi khi đã duyệt qua 1 folder để tránh gọi lại API khi quay lui.
- Tạo thư mục con: xem mục 2.1 — dùng thẳng `Folder.parentId`, không cần thiết kế thêm.
- Đây thuần là lớp UI dùng lại đúng model `Folder` đã có sẵn từ đầu (mục 7.B) — không đổi schema, không đổi luồng backend.

### 11.D. Cài đặt (Settings) — MVP phụ, chốt phương án đơn giản nhất
Tham khảo từ Google Drive: giao diện Sáng/Đậm, mật độ hiển thị, trang bắt đầu, cách mở PDF...
- **Quyết định**: toàn bộ lưu ở **`localStorage` phía Angular, không tạo bảng DB riêng** (VD không có `UserSettings` table). Lý do: đây là tuỳ chọn hiển thị thuần cá nhân, không cần đồng bộ giữa nhiều thiết bị ở quy mô 1 người dùng — thêm bảng DB cho việc này là over-engineering so với lợi ích.
- Phạm vi tối thiểu: Giao diện (Sáng/Đậm/Theo thiết bị — đã có sẵn design token light/dark từ prototype), Mật độ Grid Card (đổi `minmax()` trong CSS Grid, mục 7.D), Trang bắt đầu mặc định.
- Nếu sau này thật sự cần đồng bộ đa thiết bị mới cân nhắc thêm bảng — chưa cần cho MVP.

### 11.E. Trang Profile — MVP phụ, chốt phương án đơn giản nhất
- **Không tạo bảng `User` riêng** — dùng thẳng Supabase Auth user metadata (email, display name, avatar URL nếu đăng nhập Google) qua `supabase.auth.getUser()` / `updateUser()`.
- Nội dung tối thiểu: hiển thị email, đổi display name, nút đăng xuất, tổng dung lượng đã dùng (tính từ `SUM(size)` các file của user — có thể cache qua Redis, mục 5.C).
- **Ảnh đại diện**: lưu ở R2 dưới key cố định `avatars/{userId}.webp` (`StorageService.avatarKey`), không thêm cột DB — "đã có avatar hay chưa" suy từ việc `<img>` tải URL presigned lỗi hay không. Phần **cắt ảnh trước khi tải lên** (cropper) thiết kế riêng ở **mục 11.L**.

### 11.F. Thông báo (Notification) — MVP phụ, 2 phương án, đánh giá để chọn

**Phương án 1 — Browser Notification API (khuyến nghị làm trước)**
- Cách làm: khi Angular nhận event qua Supabase Realtime đã có sẵn (mục 7.A — VD "thumbnail xong", "AI search sẵn sàng", "zip folder xong"), gọi thẳng `new Notification(...)` ngay tại client.
- Ưu điểm: **gần như miễn phí** — không cần Service Worker, không cần VAPID key, không cần bảng DB lưu subscription, tái dùng 100% hạ tầng Realtime đã chốt từ đầu. Chỉ cần xin quyền trình duyệt 1 lần (`Notification.requestPermission()`).
- Nhược điểm: chỉ hoạt động khi **tab đang mở** — đóng tab/trình duyệt thì mất thông báo.

**Phương án 2 — Web Push thật (hoạt động cả khi đóng tab/trình duyệt)**
- Cách làm: Service Worker đăng ký trong Angular, cặp khoá VAPID, thư viện `web-push` ở NestJS, thêm bảng `PushSubscription` (`endpoint`, `keys.p256dh`, `keys.auth`, `userId`) lưu subscription theo từng thiết bị, mọi job BullMQ hoàn tất phải gọi thêm bước gửi push (ngoài việc update Realtime như hiện tại).
- Ưu điểm: thông báo thật kể cả khi tắt tab — đúng nghĩa "thông báo đẩy".
- Nhược điểm: effort cao hơn hẳn — thêm schema, thêm service, thêm điểm có thể lỗi (subscription hết hạn, trình duyệt không hỗ trợ...).

**Quyết định**: làm **Phương án 1** trước cho MVP phụ — đủ dùng cho use case cá nhân (đa số thời gian app đang mở khi chờ xử lý AI/upload). Phương án 2 để ngỏ, chỉ làm nếu thực sự thấy cần "thông báo khi tắt tab" sau khi dùng thử Phương án 1 (thêm câu hỏi mở ở mục 9).

### 11.G. Chế độ hiển thị: Lưới (Grid) & Danh sách (List) — MVP chính, tận dụng lại UI đã có
- Nút toggle Lưới/Danh sách ở góc thanh công cụ (giống Google Drive) — chỉ đổi **cách render**, không đổi nguồn dữ liệu (vẫn cùng API list ở mục 11.A).
- **Lưới (Grid)**: dùng đúng layout Card đã chốt ở mục 7.D (`repeat(auto-fill, minmax(180px, 1fr))`).
- **Danh sách (List)**: bảng dòng ngang — icon/thumbnail nhỏ + Tên, Lần sửa đổi cuối, Dung lượng (cột "Người"/"Chủ sở hữu" kiểu Drive không cần vì MVP chưa có chia sẻ nhiều người dùng — bỏ qua, thêm sau nếu có tính năng share).
- Lựa chọn Lưới/Danh sách lưu vào `localStorage` (tái dùng cơ chế Settings ở mục 11.D) để nhớ lần mở app kế tiếp — không thêm cột DB.
- Không phát sinh model/schema mới, không thêm API — thuần là 2 component/template khác nhau ở Angular cho cùng 1 danh sách file.

### 11.H. Kiến trúc điều hướng: 2 lăng kính (Thư mục ↔ Loại) + Dashboard — MVP chính (giải quyết "rối như Google Drive")

> ⚠️ **Cập nhật 2026-08-20**: phần "Trang chủ = Dashboard tóm tắt" bên dưới (và bản thiết kế lại ở mục 11.N) **không còn áp dụng** — trang Dashboard đã bị xoá hẳn, trang chủ mặc định giờ là "My Storage" (Files). Lý do + chi tiết ở **mục 11.P**. 2 lăng kính Thư mục/Loại và sidebar mô tả dưới đây **vẫn đúng nguyên vẹn**, chỉ riêng phần Dashboard là lịch sử.

**Bài toán gốc** (theo phản hồi người dùng): Google Drive trộn lẫn "duyệt theo thư mục" với "feed Recent/gợi ý" ngay màn hình đầu → người mới bị choáng, không biết bắt đầu từ đâu. Đồng thời khi upload nguyên 1 thư mục nhiều loại file (mp3, mp4, pdf, docx, folder con...), người dùng muốn **vừa giữ được cấu trúc thư mục gốc, vừa slice nhanh theo loại file** mà không phải đào từng folder con.

**Nguyên tắc thiết kế cốt lõi — 2 lăng kính (lens) tách bạch, KHÔNG bao giờ trộn:**

| Lăng kính | Trả lời câu hỏi | Dữ liệu hiển thị | Dựa trên |
|---|---|---|---|
| **A. Thư mục** (Folder lens) | "File của tôi được TỔ CHỨC thế nào?" | Con trực tiếp của folder đang đứng (`WHERE folderId = X`) | Cấu trúc `Folder.parentId` — giữ nguyên đúng cây lúc upload (mục 2.1, 11.C) |
| **B. Loại** (Type lens) | "Tôi có những GÌ, bất kể nằm đâu?" | TẤT CẢ file 1 loại, cắt ngang mọi folder (`WHERE extension IN (...)`, KHÔNG ràng buộc `folderId`) | Mapping `extension → nhóm` tĩnh ở Angular |

Chính vì Drive nhập nhằng 2 thứ này nên rối. Ở app này chúng là 2 vùng riêng trong sidebar, người dùng luôn biết mình đang ở lăng kính nào.

#### Bố cục sidebar (cố định bên trái)

```
┌─────────────────────────────┐
│ 🏠 Trang chủ (Dashboard)    │  ← landing mặc định
│─────────────────────────────│
│ DUYỆT  (lăng kính Thư mục)  │
│  📁 My Files   ← cây lazy   │
│  ⭐ Có gắn dấu sao          │
│  🕐 Gần đây                 │
│  🗑 Thùng rác                │
│─────────────────────────────│
│ THEO LOẠI (lăng kính Loại)  │
│  ▾ 📄 Tài liệu      (42)    │
│      pdf (18)  docx (12)    │
│      txt (7)   xlsx (3) ... │
│  ▸ 🖼 Ảnh           (128)   │
│  ▸ 🎬 Video          (15)   │
│  ▸ 🎵 Âm thanh       (60)   │
│  ▸ 💻 Code           (30)   │
│  ▸ 📦 Nén             (8)   │
│  ▸ 📎 Khác            (5)   │
└─────────────────────────────┘
```

- Mỗi nhóm cấp cao là 1 **dropdown collapse/expand**. Bấm nhãn nhóm ("Tài liệu") → lọc mọi file thuộc nhóm; bung ra bấm 1 đuôi cụ thể ("pdf (18)") → lọc đúng đuôi đó. **Số đếm** nằm cạnh cả nhóm lẫn từng đuôi.
- Vùng "DUYỆT" và "THEO LOẠI" **dùng chung khung nội dung** (Grid/List ở mục 11.G) — chỉ khác nguồn lọc. Chọn mục nào thì đổi tiêu đề + đường điều hướng phía trên cho rõ ngữ cảnh.

#### 7 nhóm cấp cao & mapping extension (tĩnh ở Angular, dễ mở rộng)

Bảng mapping là 1 object hằng ở frontend (VD `const EXT_GROUP: Record<string, GroupId>`), **không lưu trong DB** — suy trực tiếp từ `File.extension` sẵn có. Danh sách đuôi dưới đây là đại diện, bổ sung dần khi gặp đuôi mới; mọi đuôi không khớp rơi vào "Khác".

| Nhóm | Icon | Đuôi file (đại diện, mở rộng được) |
|---|---|---|
| Tài liệu | 📄 | pdf, doc, docx, txt, md, rtf, odt, epub, xls, xlsx, csv, ods, ppt, pptx, odp (gộp cả bảng tính + trình chiếu — theo lựa chọn "7 nhóm cân bằng") |
| Ảnh | 🖼 | png, jpg, jpeg, gif, webp, svg, bmp, tiff, heic, ico, avif |
| Video | 🎬 | mp4, mov, webm, mkv, avi, wmv, flv, m4v, mpeg, 3gp |
| Âm thanh | 🎵 | mp3, wav, flac, aac, ogg, m4a, wma, opus |
| Code | 💻 | js, ts, jsx, tsx, py, java, c, cpp, h, cs, go, rs, rb, php, html, css, scss, json, xml, yaml, yml, sh, sql, vue, kt, swift |
| Nén | 📦 | zip, rar, 7z, tar, gz, bz2, xz, iso |
| Khác | 📎 | mọi đuôi còn lại (exe, dmg, apk, bin...) — bucket fallback |

> Vì sao gộp bảng tính/trình chiếu vào "Tài liệu" thay vì tách riêng: theo lựa chọn đã chốt (7 nhóm cân bằng) — đủ gọn để không choáng, đủ rõ để phân biệt. Nếu sau này tài liệu công việc nhiều lên, chỉ cần tách thêm nhóm trong object mapping ở Angular, **không đụng backend/schema**.

#### Backend cần thêm (đều additive, KHÔNG đổi schema)

1. **`GET /files/stats`** — số đếm cho sidebar + tile Dashboard.
   - Prisma: `prisma.file.groupBy({ by: ['extension'], where: { userId, deletedAt: null, status: { not: 'delete_pending' } }, _count: { _all: true } })` → trả `[{ extension, count }]`. `deletedAt: null` loại file đang nằm trong Thùng rác (mục 7.E, 11.K) khỏi số đếm sidebar/Dashboard.
   - Angular tự gộp theo 7 nhóm bằng object mapping ở trên (giữ đúng triết lý "category suy ở client" của mục 11.A).
   - **Cache Redis** (mục 5.C): key `stats:{userId}`, invalidate chủ động mỗi khi upload/xoá/move file (cùng service method), + TTL 60s làm lưới an toàn. Đây là dữ liệu hiển thị thường trực nên cache là đáng.

2. **Type lens dùng lại `GET /files` sẵn có** — thêm query param cross-folder:
   - `GET /files?extensions=pdf,docx,txt&sort=updatedAt_desc` → backend chỉ thêm `WHERE extension IN (...)`, **không** kèm `folderId` (đó chính là điểm "cắt ngang mọi folder"). Angular tự bung nhóm/đuôi đã chọn thành danh sách `extensions`.
   - Đối lập: Folder lens vẫn là `GET /files?folderId=X` (con trực tiếp của 1 folder).

3. **`folderPath` cho từng file trong Type lens** — để hiện breadcrumb đầy đủ mỗi dòng (lựa chọn đã chốt).
   - Khi list ở chế độ cross-folder, mỗi file kèm `folderPath: [{ id, name }, ...]` từ gốc tới folder cha trực tiếp. File nằm ở gốc (`folderId = null`) → `folderPath = []`, UI không hiện gì.
   - **Cách tính (MVP đơn giản)**: nạp toàn bộ folder của user 1 lần (`SELECT id, name, parentId WHERE userId`), dựng map `id → {name, parentId}` trong bộ nhớ NestJS rồi lần `parentId` ngược lên cho từng file — ở quy mô cá nhân, số folder nhỏ nên rẻ. Cache map này ở Redis, invalidate khi tạo/xoá/rename/move folder.
   - **Nâng cấp nếu cây rất lớn**: đổi sang recursive CTE (`WITH RECURSIVE ... $queryRaw`) trả path trong 1 query. Chưa cần cho MVP.
   - Click 1 crumb (`Gốc › Dự án › Ảnh`) → chuyển sang **Folder lens** tại đúng folder đó (tái dùng breadcrumb + điều hướng của mục 11.C).

#### Trang chủ = Dashboard tóm tắt (chốt: KHÔNG đổ Recent ra màn hình)

Landing mặc định khi mở app, cố tình "tĩnh và gọn" để chống đúng nỗi choáng của Drive:

```
┌────────────────────────────────────────┐
│  Dung lượng: 3.2 GB ▓▓▓░░░ 32%          │  ← SUM(size), tái dùng mục 11.E
│────────────────────────────────────────│
│  Truy cập nhanh theo loại               │  ← tile = 7 nhóm, count từ /files/stats
│  [📄 42] [🖼 128] [🎬 15] [🎵 60] ...   │     bấm tile → nhảy vào Type lens
│────────────────────────────────────────│
│  Gần đây (tối đa 6-8 file)              │  ← strip NHỎ, có giới hạn cứng
│  • CV.pdf   • demo.mp4   • note.md ...  │     KHÔNG phải feed vô tận
└────────────────────────────────────────┘
```

- **Thanh dung lượng**: `SUM(File.size)` của user (lưu ý `BigInt`, mục 7.B), cache Redis — dùng lại đúng số liệu trang Profile (mục 11.E).
- **Tile truy cập nhanh**: chính 7 nhóm + count từ `GET /files/stats`, bấm là vào Type lens nhóm đó — biến Dashboard thành bàn đạp vào lăng kính Loại.
- **"Gần đây" thu nhỏ**: `GET /files?sort=updatedAt_desc&limit=8` — **giới hạn cứng 6-8 file**, đây là điểm khác Drive: Recent chỉ là 1 dải nhỏ tham khảo, không chiếm cả màn hình. Ai muốn xem đầy đủ thì vào mục "🕐 Gần đây" ở sidebar (view riêng, không giới hạn) — tách rõ "liếc nhanh" khỏi "duyệt sâu".

#### Vì sao thiết kế này khớp phần còn lại của plan

- Type lens là hiện thân đầy đủ của "Filter theo loại" (mục 11.A) — 0 schema mới, chỉ query param + 1 endpoint stats.
- Folder lens = đúng cây `Folder.parentId` + breadcrumb + lazy load đã chốt ở mục 11.C — không đổi cơ chế, chỉ đóng khung lại thành 1 trong 2 lăng kính.
- Cả 2 lăng kính đều xài chung toggle Lưới/Danh sách (mục 11.G) trên cùng 1 nguồn dữ liệu; ở chế độ Danh sách, cột breadcrumb `folderPath` có sẵn chỗ hiển thị gọn gàng.
- Toàn bộ tận dụng lại Redis cache + invalidation (mục 5.C) và Supabase Realtime (mục 7.A) đã có — khi upload/xoá xong, count sidebar + tile Dashboard tự cập nhật.
- Trực tiếp bổ trợ cho upload-nguyên-folder (mục 2.1): upload cây thư mục nhiều loại xong, Type lens cho phép rút ra "tất cả mp4" hay "tất cả pdf" trong cây đó ngay, không phải mò từng folder con.

### 11.K. Thùng rác (Trash / Recycle Bin) — nâng lên MVP chính, không phải "râu ria"

Tuy nằm trong mục 11 (nhóm tính năng tham khảo UI Google Drive), tính năng này **xếp vào MVP chính**, khác các mục 11 còn lại. Lý do: thiết kế xoá gốc ban đầu (mục 7.E bản cũ) là xoá vĩnh viễn gần như ngay lập tức, không có đường lùi — với 1 app lưu trữ file cá nhân, "lỡ tay xoá mất vĩnh viễn" là rủi ro nghiêm trọng hơn hẳn so với các tiện ích cá nhân hoá khác (star, theme...), nên không thể để "làm sau".

**Phần backend/data-flow (soft delete, cascade, restore, purge job) đã mô tả đầy đủ ở mục 7.E** — mục này chỉ tập trung UI/UX + endpoint, tránh lặp lại.

**UI:**
- Mục "🗑 Thùng rác" trong sidebar, nhóm "DUYỆT" (lăng kính Thư mục, mục 11.H) — đã có placeholder ở mockup, nay chốt là mục thật.
- Dùng chung khung Grid/List (mục 11.G) với các view khác, nhưng thêm 2 cột riêng:
  - **"Vị trí gốc"**: breadcrumb `folderPath`, tái dùng đúng cơ chế đã dựng cho Type lens ở mục 11.H — vì Thùng rác cũng là danh sách phẳng cắt ngang mọi folder (trash root có thể đến từ bất kỳ đâu trong cây).
  - **"Còn N ngày"**: tính từ `deletedAt + TRASH_RETENTION_DAYS - now()`.
- Mỗi item có 2 action: **Khôi phục** (Restore) và **Xoá vĩnh viễn** (Delete forever, có dialog xác nhận vì không thể hoàn tác).
- Toolbar riêng của view Thùng rác: nút **"Dọn thùng rác"** (Empty trash) — xoá vĩnh viễn toàn bộ cùng lúc, dialog xác nhận mạnh hơn bình thường (VD gõ lại chữ "XOÁ" để xác nhận) vì đây là hành động phá huỷ hàng loạt.
- Sort mặc định của view này: `deletedAt desc` (mới xoá lên đầu) — chỉ cần thêm `deletedAt` vào danh sách field cho phép sort (mục 11.A), không có gì mới về cơ chế.

**Endpoint (additive, schema chỉ thêm field `deletedAt` đã nêu ở mục 7.B):**
| Endpoint | Mô tả |
|---|---|
| `GET /trash` | List trash root của user (file + folder gộp) — `deletedAt` không null, cha (nếu có) không bị trash. Kèm sẵn `folderPath` (mục 11.H) + `daysUntilPurge` tính sẵn ở backend. Đứng riêng thành resource `/trash` (không lồng dưới `/files`) để tránh phụ thuộc thứ tự route với `GET /files/:id`. |
| `PATCH /files/:id/trash`, `PATCH /folders/:id/trash` | Xoá mềm — set `deletedAt`, cascade xuống con nếu là folder (mục 7.E giai đoạn 1). |
| `PATCH /files/:id/restore`, `PATCH /folders/:id/restore` | Khôi phục — clear `deletedAt`, cascade xuống con nếu là folder, áp quy tắc trùng tên (mục 7.E). Chỉ gọi được trên trash root. |
| `DELETE /files/:id`, `DELETE /folders/:id` | Xoá vĩnh viễn 1 item — chỉ hợp lệ khi item đang ở Thùng rác (400 nếu chưa trash) — chạy luồng "Giai đoạn 2" mục 7.E. |
| `POST /trash/empty` | Xoá vĩnh viễn toàn bộ Thùng rác của user — lặp luồng trên cho từng trash root. |

**Đã triển khai** (2026-07-23): backend (`TrashModule`: service/controller/sweep job BullMQ repeatable 03:00 mỗi ngày) + frontend (trang `/trash`, mục sidebar, nút "Xoá" ở Files giờ gọi trash thay vì hard-delete). Migration `deletedAt` đã áp lên Supabase qua `prisma db push` (additive, không mất dữ liệu), RPC search đã cập nhật trên DB thật.

**Dung lượng & Dashboard (mục 11.H):** file trong Thùng rác **vẫn tính vào** "Dung lượng đã dùng" (`SUM(File.size)`) — vì dữ liệu thật sự vẫn nằm trên R2 cho tới khi xoá vĩnh viễn, giống hành vi Google Drive thật. Có thể cân nhắc thêm dòng phụ "Trong đó Thùng rác: X GB" ở Dashboard để người dùng biết dọn thùng rác giải phóng được bao nhiêu — nhỏ, không bắt buộc cho lượt đầu triển khai.

**Không phát sinh bảng DB mới** — chỉ thêm 1 cột `deletedAt DateTime?` vào `File` và `Folder` (mục 7.B), toàn bộ phần còn lại là query filter + tái dùng nguyên cơ chế duyệt cây/gom object key đã có sẵn từ thiết kế cascading delete ban đầu (mục 7.E).

### 11.L. Cắt ảnh đại diện (Image Cropper) — MVP phụ, tự viết không thêm dependency

**Hiện trạng & vấn đề**: `profile.ts` chọn file → `AvatarService.upload()` nén rồi gửi thẳng → backend `me.controller.ts` chạy `sharp().resize(256, 256, { fit: 'cover' })`, tức **cắt tự động vào chính giữa**. Người dùng không kiểm soát được khung hình: ảnh chân dung dọc rất dễ bị cắt mất đầu, ảnh nhóm bị cắt mất người.

**Chốt phương án**: tự viết component canvas, **không** thêm `ngx-image-cropper` — nhất quán với các lần đã chọn "không thêm thư viện ngoài" trong plan (chunking tự cắt bằng vòng lặp string mục 8.C, mapping extension tĩnh mục 11.H), và phạm vi thật sự nhỏ (~150 dòng).

**Thiết kế:**
- Component `app-avatar-cropper` (`shared/avatar-cropper.ts`), mở trong `app-modal` sẵn có (`shared/modal.ts`) ngay sau khi người dùng chọn file — thay vì upload luôn như hiện tại.
- **Hiển thị**: ảnh vẽ lên `<canvas>`, phủ lớp mask tối có **lỗ tròn** ở giữa — đúng hình dạng avatar hiển thị thật, nên thấy trước được kết quả (WYSIWYG), không phải đoán.
- **Tương tác**: kéo để pan + `<input type="range">` để zoom (1x–4x) + nút xoay 90°. Dùng `pointerdown/pointermove/pointerup` để hỗ trợ cả chuột lẫn cảm ứng bằng **một** đường code — không cần thư viện gesture.
- **State** chỉ gồm `{ offsetX, offsetY, scale, rotation }`; mỗi lần đổi thì vẽ lại canvas. Không có state phức tạp nào khác.
- **Xuất**: vẽ vùng crop ra canvas **512×512** rồi `canvas.toBlob(..., 'image/webp', 0.9)` → truyền thẳng vào `AvatarService.upload()` đã có.
- **Backend KHÔNG đổi**: `sharp().resize(256, 256, { fit: 'cover' })` nhận ảnh đã vuông sẵn nên `cover` không cắt thêm gì nữa — bước resize từ chỗ "quyết định khung hình" trở thành thuần chuẩn hoá kích thước/định dạng. Không phải sửa `me.controller.ts`, không phải đổi route raw body ở `main.ts`.
- **Bỏ `browser-image-compression` cho luồng có cropper** (`avatar.service.ts`): canvas đã xuất webp 512px chỉ ~50–100KB, nén thêm là thừa. Giữ nguyên hàm `compress()` làm đường dự phòng nếu cropper lỗi.
- **EXIF orientation**: ảnh chụp từ điện thoại dễ bị xoay sai khi vẽ lên canvas. Dùng `createImageBitmap(file, { imageOrientation: 'from-image' })` để trình duyệt tự áp orientation — **không** tự đọc EXIF bằng tay, cũng không cần thư viện. (Backend vẫn giữ `.rotate()` của sharp cho đường dự phòng.)

**Không phát sinh**: bảng DB, endpoint, env var, hay dependency nào — thuần 1 component Angular mới + sửa nhẹ `profile.ts` để chèn bước cropper vào giữa "chọn file" và "upload".

### 11.M. Responsive (điện thoại / máy tính bảng) — MVP chính

Trước đây responsive được vá lẻ tẻ theo từng trang (mỗi file `.scss` tự đặt breakpoint riêng: 560/576/600/640/720/860/960px). Lượt này rà lại **toàn app** và bổ sung phần nền còn thiếu, theo hướng **sửa ở tầng chung thay vì thêm breakpoint cho từng trang**.

#### Nguyên tắc
1. **Một API, mọi khổ màn** — không có "bản mobile" riêng, cùng một component đổi cách xếp đặt theo bề ngang khả dụng.
2. **Không bao giờ cuộn ngang cả trang**: thứ gì rộng quá thì tự cuộn trong khung của nó (`.table-scroll`, dải hành động ở topnav), `body { overflow-x: hidden }` là lưới an toàn cuối.
3. **Chỉ dùng breakpoint khi nội dung thật sự vỡ**, ưu tiên `min()`/`max()`/`clamp()` + `auto-fill` để layout tự co (VD lưới tệp).

#### Những thứ đã bổ sung ở tầng chung
| Việc | Vì sao |
|---|---|
| `100dvh` (kèm `100vh` dự phòng) cho `.shell`, trang đăng nhập, trang `/s/:token`, khung xem toàn màn hình | `100vh` trên mobile tính cả phần bị thanh địa chỉ che ⇒ đáy app luôn nằm dưới màn hình, nút dưới cùng bấm không tới |
| `env(safe-area-inset-*)` gói thành token `--safe-t/r/b/l` + `viewport-fit=cover` | Máy có tai thỏ/thanh gesture: topnav, drawer, panel upload, overlay xem trước tự né vùng khuyết |
| `touch-action: manipulation` + `-webkit-tap-highlight-color` cho mọi phần tử bấm được | Bỏ độ trễ ~300ms chờ double-tap-to-zoom; bỏ ô xám nhấp nháy khi chạm |
| `@media (pointer: coarse)`: nới vùng bấm ra **44px** bằng `::after` (không đổi kích thước hình) | Nút icon 30–38px quá nhỏ cho ngón tay, nhưng phóng to thật sẽ phá bố cục dày đặc trên desktop |
| `overscroll-behavior: contain` cho modal, drawer sidebar, menu, panel thông báo | Vuốt hết danh sách trong lớp phủ không kéo trang nền cuộn theo |
| `color-scheme` theo theme + `<meta name="theme-color">` | Thanh cuộn/ô input native và thanh trạng thái trình duyệt khớp tông sáng/tối |
| `@media (prefers-reduced-motion: reduce)` | Tôn trọng thiết lập giảm chuyển động của hệ điều hành (a11y) |
| Thang chữ tiêu đề thu nhỏ ở ≤640px (sửa trong `_tokens.scss`) | Một chỗ, mọi trang cùng co. **Không** giảm cỡ chữ thân dưới 16px vì iOS Safari tự zoom khi focus input nhỏ hơn 16px |

#### Các chỗ vỡ thật đã sửa (phát hiện khi soi ở 360/390/768px)
- **Topnav bị cắt cụt** (nghiêm trọng nhất): một hàng không chứa nổi menu + logo + ô tìm kiếm + bộ lọc/sắp xếp + chuông ⇒ ô tìm kiếm bị ép về 0px và các nút bên phải bị cắt khỏi màn hình. Sửa: ≤860px topnav **xuống 2 hàng** (hàng dưới là ô tìm kiếm chiếm trọn bề ngang) + dải bộ lọc/sắp xếp thành **vùng cuộn ngang** thay vì bị cắt.
- **Tên tệp dài nong bảng** ở chế độ Danh sách ⇒ cả trang cuộn ngang. Sửa: `overflow-wrap: anywhere` cho ô tên.
- **Modal không có trần chiều cao**: dialog dài (VD Chia sẻ) tràn khỏi màn hình, nút hành động bị đẩy ra ngoài không bấm được. Sửa: `max-height: calc(100dvh - …)` + thân modal tự cuộn; ≤480px nút xếp dọc full-width.
- **Lưới tệp**: `minmax(180px, 1fr)` cứng ⇒ trên máy 360px chỉ còn 1 cột khổng lồ. Sửa: `minmax(min(180px, 100%), 1fr)`, và ≤560px hạ xuống 132px để giữ 2 cột.
- **Trang Word/text xem trước**: trang A4 rộng cố định làm tràn overlay; lề 64px ăn hết chỗ đọc trên điện thoại. Sửa: khung tự cuộn ngang + thu lề ở ≤640/820px.

#### Đã kiểm chứng (không chỉ đọc CSS)
Chạy `ng serve` rồi nhúng app vào iframe đúng khổ **360 / 390 / 768px** để media query ăn theo bề ngang thật, chụp lại và đo bằng script trong trang:
- `documentElement.scrollWidth - innerWidth = 0` ở cả 3 khổ ⇒ **không có cuộn ngang** ngoài ý muốn.
- `.shell` cao đúng bằng `innerHeight` ⇒ `100dvh` ăn.
- Dải hành động ở topnav `scrollWidth > clientWidth` ⇒ phần dư **cuộn được**, không phải bị cắt mất.

### 11.N. Sao chép / Cắt / Dán + tinh chỉnh UI theo phản hồi thực tế

Nhóm thay đổi sau khi dùng thử app trên điện thoại và desktop (2026-07-26).

#### Sao chép / Cắt / Dán (mới — MVP phụ)

**Chốt: có CẢ hai**, đúng thói quen Windows Explorer — `Ctrl+C` sao chép, `Ctrl+X` cắt, `Ctrl+V` dán vào thư mục đang mở. Cũng có trong menu chuột phải (1 mục lẫn nhiều mục đang chọn) để dùng được trên cảm ứng.

| Quyết định | Lý do |
|---|---|
| **Bảng nháp trong app** (`ClipboardService`, signal), KHÔNG dùng `navigator.clipboard` | Clipboard hệ điều hành chỉ chở text/blob, không chở được "tham chiếu tới tệp trên server", và mỗi lần đọc lại phải xin quyền. Ở đây chỉ cần nhớ `id` + chế độ. |
| **Không lưu bảng nháp xuống `localStorage`** | Dán ở tab/phiên khác dễ trỏ vào mục đã bị xoá; và "đã cắt" mà còn sống qua lần mở app sau là hành vi bất ngờ. |
| **Cắt = tái dùng `move` sẵn có** | Không tốn thêm byte nào, không đụng R2 — chỉ đổi `folderId` trong Postgres (đúng lý do object key = ID cố định, mục 5.A). |
| **Sao chép = copy object SERVER-SIDE trên R2** (`CopyObjectCommand`) | Byte không đi vòng qua instance API: copy tệp 2GB cũng chỉ là 1 lệnh API. `CopySource` phải `encodeURI` vì tên/id có unicode sẽ làm hỏng chữ ký. |
| **Bản sao chép luôn cả `DocumentChunk` (text + vector)** bằng raw SQL | Nội dung y hệt bản gốc ⇒ embedding cũng y hệt. Chép row rẻ hơn nhiều so với gọi lại Gemini, và bản sao **tìm được ngay** bằng AI search thay vì phải chờ pipeline chạy lại. Dùng `$executeRaw` vì cột `embedding` là `Unsupported("vector")` (mục 7.B). |
| **Sao chép thư mục = đệ quy, chạy đồng bộ trong request** | Quy mô cá nhân thì cây nhỏ, và người dùng cần thấy thư mục mới hiện ra ngay khi bấm Dán. Nếu sau này gặp cây hàng nghìn tệp thì mới chuyển sang job BullMQ (cùng khuôn với zip mục 5.E). |
| **Chỉ dán được ở lăng kính Thư mục** | Theo loại / Gần đây / Có gắn dấu sao là kết quả truy vấn **cắt ngang cây** (mục 11.H) — không có "thư mục đang mở" để dán vào, nên nút Dán bị ẩn hẳn ở đó. Đây chính là chỗ người dùng dặn "trừ mấy cái được truy vấn ngược". |
| **Chặn dán thư mục vào chính nó hoặc hậu duệ của nó** | Không chặn thì `copyTree` đệ quy vô tận. Tái dùng `collectDescendantFolderIds()` đã có sẵn cho `move`. |
| **Chỉ sao chép tệp `status = 'ready'`** | Tệp đang tải lên chưa ghép xong trên R2 — copy ra sẽ được object hỏng. |
| **Chống trùng tên chỉ ở CẤP GỐC của thao tác dán** | Các cấp con nằm trong thư mục vừa tạo mới tinh nên không thể trùng — khỏi tốn query thừa. Cấp gốc vẫn theo đúng quy tắc `(1)(2)` mục 2.1. |
| **"Cắt" dùng 1 lần rồi xoá bảng nháp; "Sao chép" giữ lại** | Cắt xong thì mục đã chuyển đi, dán tiếp là vô nghĩa. Sao chép thì dán được vào nhiều thư mục liên tiếp. |

**Endpoint mới (additive, không đổi schema):** `POST /files/:id/copy` và `POST /folders/:id/copy`, body dùng lại đúng DTO của `move` (`{ folderId }` / `{ parentId }`).

> ⚠️ **Sao chép làm tăng dung lượng thật** — bản sao là byte mới trên R2, tính vào quota free tier và vào "Dung lượng đã dùng" (mục 11.E). Khác hẳn Cắt (0 byte phát sinh). Đây là lý do 2 thao tác phải tách bạch rõ trong UI, không gộp thành một.

#### Tìm kiếm 2 tầng trong cùng 1 ô

Trước đây ô tìm kiếm ghi "Tìm kiếm tệp bằng AI…" nhưng thực tế **tìm theo tên** và **tìm bằng AI** là 2 việc khác nhau. Chốt:

- **Vừa gõ** (≥2 ký tự, debounce 250ms) → dropdown gợi ý **theo tên**, gọi `GET /files?q=` — rẻ, **không tốn quota Gemini**. Bấm 1 gợi ý là nhảy thẳng vào thư mục chứa tệp đó.
- **Nhấn Enter** → chạy **AI ngữ nghĩa** và mở trang `/search`. Giữ nguyên quyết định mục 8.C ("AI chỉ chạy khi Enter") — dòng cuối dropdown hiện luôn *Hỏi AI: "…"* kèm gợi ý phím `Enter` để người dùng thấy rõ 2 tầng.
- Backend chỉ thêm 1 query param `q` vào `GET /files` sẵn có: `name contains, mode: 'insensitive'`, **cắt ngang mọi folder** (tìm cả kho chứ không chỉ thư mục đang mở), kèm `folderPath` như các lăng kính cắt ngang khác.

#### Trang chủ (Dashboard) — thiết kế lại 2026-07-26 *(lịch sử — trang Dashboard đã bị xoá 2026-08-20, xem mục 11.P)*

Bản cũ chỉ có tiêu đề + 1 thanh dung lượng mảnh + danh sách "Gần đây", mọi thứ căn trái nên trên điện thoại nhìn trống trải và không có điểm nhìn (phản hồi UI ảnh 16). Bản mới:

1. **Hero căn giữa**: lời chào theo tên (lấy từ Supabase Auth metadata — mục 11.E) + **vòng tròn dung lượng** SVG thuần (không thêm thư viện chart) + 3 số **Đã dùng / Còn trống / Tệp**. Cố ý dùng **đúng ngôn ngữ hình ảnh với thẻ "Dung lượng" ở trang Hồ sơ** để 2 trang không như 2 app khác nhau.
2. **"Truy cập nhanh" theo loại** quay lại (trước đây bỏ vì trùng sidebar): trên điện thoại sidebar "Theo loại" bị giấu sau nút ☰ nên đây là **lối vào duy nhất thấy được ngay**. Chỉ hiện nhóm **có tệp** — tránh một rổ ô trống. Số đếm dùng chung `StatsService` với sidebar, không thêm request mới.
3. **"Gần đây"** giữ giới hạn cứng 8 (mục 11.H) nhưng: hiện **ảnh xem trước** thay vì chỉ icon, và bấm 1 dòng mở **đúng thư mục chứa tệp** thay vì nhảy về danh sách "Gần đây" như trước (bấm gì cũng ra một chỗ).
4. Bề rộng tối đa hạ **1040 → 760px**: trang chỉ có 3 khối xếp dọc, để rộng quá thì mỗi hàng dài thượt.

#### Căn chỉnh & bố cục (cùng lượt)

| Chỗ | Vấn đề | Sửa |
|---|---|---|
| Lưới tệp trên điện thoại/tablet | Ảnh dọc/ngang lẫn lộn, mỗi ô một kiểu ⇒ hàng nào cũng lệch (ảnh 17) | Ô **vuông** (`aspect-ratio: 1/1`) + ảnh **`object-fit: cover`** bo góc nhẹ. **Bẫy**: rule gốc `object-fit: contain` nằm SAU media query trong file nên cùng độ đặc hiệu thì nó thắng — phải viết `.grid .tile-preview img` mới ăn (lỗi này đã dính 2 lần, xem cả `.grid .tile-title`) |
| Thẻ "Dung lượng" ở Hồ sơ | Vòng tròn + 3 số dính mép trái trong khi thẻ hồ sơ ngay trên lại căn giữa ⇒ nhìn lệch hẳn (ảnh 15) | Màn ≤700px: xếp dọc, căn giữa, 3 số thành lưới 3 cột có đường kẻ phân cách — khớp hệt Trang chủ |

#### Tinh chỉnh giao diện theo phản hồi

| Chỗ | Trước | Sau |
|---|---|---|
| Topnav mobile | Dải nút lọc/sắp xếp cuộn ngang, phải vuốt mới thấy hết | **Một nút `tune` mở dropdown gộp** (loại tệp + sắp xếp + lưới/danh sách + tạo lại ảnh xem trước) |
| Chữ "Storage" | Ẩn ở ≤576px | **Hiện lại** — từ khi topnav xuống 2 hàng thì hàng đầu còn rộng, bỏ chữ đi trông trống |
| Nút icon ở topnav | Nút tròn có viền | **Icon trần** (ghost) — "bấm vào icon là đủ, user tự biết" |
| Lưới trên điện thoại/tablet | Ảnh + tên 2 dòng, ô cao và rối | **Chỉ ảnh xem trước**, bỏ tên tệp. **Thư mục vẫn giữ tên** (không có ảnh để nhận diện); chế độ **Danh sách luôn có tên**. Bật lại được ở Cài đặt (`mobileTileNames`, localStorage — mục 11.D) |
| Panel "Chi tiết" | Drawer trượt từ phải, chiếm gần hết màn hình | **Bỏ hẳn ở ≤960px**. Chặn ở *tầng logic* chứ không chỉ ẩn bằng CSS — mở panel còn kéo theo 1 request ký URL xem trước, ẩn CSS thì vẫn tốn request đó |
| Thanh công cụ preview | Nút "⭳ Tải xuống" có chữ | **Chỉ icon**, áp dụng cho **cả desktop**; tên tệp dài cắt bằng "…" (`min-width: 0` mới là thứ làm `text-overflow` chạy trong flex) |
| Đổi ảnh đại diện | Nút tròn nhỏ ở góc dưới-phải, che mất mặt trong ảnh | **Icon máy ảnh giữa ảnh**, chỉ hiện khi hover (thiết bị chạm không có hover ⇒ luôn hiện mờ) |

### 11.O. Kéo-thả để DI CHUYỂN mục vào thư mục — MVP chính (bổ sung 2026-07-27)

**Lỗ hổng phát hiện khi dùng thật**: app đã có kéo-thả **tải lên** từ máy vào (mục 2.1) nhưng **không** kéo-thả được mục *đã có sẵn* vào thư mục — thao tác cơ bản nhất của mọi trình quản lý tệp. Muốn chuyển 1 tệp phải qua menu chuột phải → "Chuyển" → duyệt cây trong dialog, hoặc Ctrl+X/Ctrl+V (mục 11.N). Cả 2 đều dùng được nhưng đều **không phải phản xạ tự nhiên** khi nhìn thấy tệp và thư mục nằm cạnh nhau trên màn hình.

Đây là **thiếu tính năng**, không phải lỗi: trong plan trước đây từ "kéo thả" **chỉ** nói về luồng tải lên (mục 2.1), chưa bao giờ nói tới di chuyển nội bộ.

#### Quyết định

| Quyết định | Lý do |
|---|---|
| **MIME riêng `application/x-storage-items`** cho kéo nội bộ | `Shell` đã bắt kéo-thả ở **tầng cửa sổ** cho luồng tải lên và chỉ phản ứng khi `dataTransfer.types` có `Files` (mục 11.H). Dùng MIME riêng ⇒ hai luồng tự loại trừ nhau, **không phải sửa một dòng nào** trong `Shell`. |
| **Trạng thái "đang kéo cái gì" đặt ở service dùng chung** (`ItemDragService`) chứ không chỉ nhét vào `DataTransfer` | Trình duyệt **cấm đọc** nội dung `DataTransfer` trong `dragover` (chỉ đọc được ở `drop`) — không có service thì đích thả không thể biết có nên sáng lên hay không. Ngoài ra nguồn kéo (trang Files) và một số đích thả (cây thư mục ở sidebar) là component **không cùng cây cha**, phải có chỗ trung gian. |
| **Tái dùng nguyên `PATCH /files/:id/move` + `PATCH /folders/:id/move`** | Không thêm endpoint, không đổi schema. Cùng lý do object key = ID cố định (mục 5.A): di chuyển vẫn chỉ là 1 câu UPDATE, **0 byte** đụng tới R2. |
| **Đích thả gồm 4 chỗ**: ô thư mục trong lưới, **breadcrumb** (kể cả "My Storage" = về gốc), **cây thư mục ở sidebar**, và mục "My Storage" ở sidebar | Ô thư mục là chỗ hiển nhiên; breadcrumb giải quyết thao tác hay dùng nhất mà lưới **không có chỗ để thả** (chuyển ngược lên cấp trên); sidebar là đích duy nhất khả dụng khi đang ở lăng kính cắt ngang cây (Gần đây / Theo loại) — nơi không có ô thư mục nào trên màn hình. |
| **Kéo 1 mục đã nằm trong lựa chọn ⇒ kéo cả lô**; kéo mục chưa chọn ⇒ bỏ lựa chọn cũ, chỉ kéo mục đó | Đúng hành vi Explorer/Drive. Tái dùng `clipTargets()` sẵn có của Sao chép/Cắt (mục 11.N) — không dựng cơ chế chọn thứ hai. |
| **Chỉ chặn ở client trường hợp hiển nhiên** (thả thư mục vào chính nó); thả vào **hậu duệ** để backend chặn | Client không giữ sẵn cả cây (sidebar lazy load — mục 11.C), kiểm tra hậu duệ ở client sẽ phải bắn thêm request giữa lúc đang rê chuột. `folders.service.move()` **đã có sẵn** `collectDescendantFolderIds()` chặn vòng lặp — chỉ cần hiện thông báo lỗi trả về. |
| **Sidebar "spring-loaded"**: rê giữ trên 1 node 700ms thì tự bung nhánh con | Không có thì muốn thả vào thư mục sâu phải bấm mở cây trước rồi mới kéo lại từ đầu. Đây là hành vi chuẩn của Finder/Explorer. |
| **Không làm kéo-thả trên cảm ứng** | HTML5 drag & drop **không chạy** trên touch; muốn có phải tự viết bằng pointer events + tự vẽ "bóng" mục đang kéo. Trên điện thoại đã có **menu chuột phải (nhấn giữ) → Chuyển** và **Cắt/Dán** (mục 11.N) làm đủ việc — không đáng đánh đổi. |
| **Chỉ di chuyển, không kéo-để-sao-chép (Ctrl+kéo)** | Sao chép **tốn byte thật** trên R2 (cảnh báo ở mục 11.N) nên phải là hành động có chủ đích, không nên nằm sau một phím bổ trợ dễ bấm nhầm. |

#### Phản hồi thị giác

- Mục đang bị kéo: mờ đi (`opacity: .45`) để mắt bám được "cái gì đang bay".
- Đích thả đang rê qua: nền `--c-accent-soft` + **viền nét đứt** — cố ý khác viền **liền** của trạng thái "đã chọn" để 2 tín hiệu không lẫn nhau.
- Thả xong hiện toast tái dùng `flash()` của mục 11.N (*"Đã chuyển N mục"*), lỗi từ backend cũng đi qua đúng đường đó.

#### Chỗ đã đụng vào

| Tệp | Việc |
|---|---|
| `apps/web/src/app/core/item-drag.service.ts` | **Mới** — giữ trạng thái kéo, gọi API move, phát sự kiện `moved`/`failed` |
| `apps/web/src/app/pages/files/files.ts` + `.html` + `.scss` | Nguồn kéo (ô lưới + hàng danh sách + ô thư mục) và đích thả (ô thư mục, breadcrumb) |
| `apps/web/src/app/layout/folder-tree-node.ts` | Đích thả + spring-loaded expand |
| `apps/web/src/app/layout/nav-sidebar.ts` + `.html` + `.scss` | "My Storage" làm đích thả về gốc |

**Backend: không đổi gì.**

### 11.P. Bỏ trang Dashboard, "My Storage" (Files) làm trang chủ + sidebar thêm lối tắt AI Search — bổ sung 2026-08-20

**Phát hiện khi dùng thật**: trong 2 trang landing từng cân nhắc (mục 11.H, 11.N), Dashboard là trang **yếu nhất** — chỉ là 1 lớp tổng hợp (vòng tròn dung lượng + tile theo loại + "Gần đây" thu nhỏ) đứng **chắn trước** nội dung thật. Người dùng luôn phải bấm thêm 1 lần nữa mới vào tới "My Storage" — nơi họ thực sự thao tác (duyệt/tải/tìm file). Với 1 app quy mô cá nhân, lớp tổng hợp này không đủ giá trị để trả giá bằng 1 click thừa mỗi lần mở app.

| Quyết định | Lý do |
|---|---|
| **Xoá hẳn** `pages/dashboard/` (3 file, ~641 dòng) thay vì chỉ ẩn route | Sau khi đổi landing, không còn chỗ nào khác tham chiếu tới Dashboard — giữ lại code chết chỉ tổ rối, không có lợi ích "phòng khi cần lại" ở quy mô 1 người dùng |
| `app.routes.ts`: route gốc đổi thành `{ path: '', redirectTo: 'files', pathMatch: 'full' }` | Cách rẻ nhất để đổi trang chủ — "My Storage" (Files) vốn đã là 1 route độc lập, hoàn chỉnh (mục 11.H lăng kính Thư mục), không cần route/guard/resolver mới |
| Thiết kế "Trang chủ = Dashboard tóm tắt" ở mục 11.H và bản thiết kế lại ở mục 11.N **giữ nguyên trong plan, đánh dấu lịch sử** thay vì xoá | Cùng cách plan này từng giữ lại lý do đổi object storage R2↔GCS (mục 5.F) dù đã đảo ngược — để không mất bối cảnh quyết định cũ nếu sau này cân nhắc làm lại Dashboard |
| Sidebar thêm mục cố định **"Tìm kiếm AI"** (`nav-sidebar.html`, icon `auto_awesome`) trỏ thẳng `/app/search` | Trang AI Search (mục 8.C) trước đây chỉ vào được gián tiếp qua ô tìm kiếm ở topnav rồi nhấn Enter (mục 11.N, "tìm kiếm 2 tầng") — không có lối vào cố định nào trong điều hướng chính. Mất trang chủ Dashboard (vốn có tile "Truy cập nhanh") càng cần 1 lối tắt rõ ràng hơn cho AI Search |

View "🕐 Gần đây" riêng ở sidebar (đã có sẵn từ mục 11.H, không giới hạn 8 dòng như strip Dashboard cũ) không đổi — vẫn là nơi xem đầy đủ hoạt động gần đây, chỉ mất đúng cái "liếc nhanh" ở trang chủ.

**Chỗ đã đụng vào:**

| Tệp | Việc |
|---|---|
| `apps/web/src/app/app.routes.ts` | Route gốc `''` đổi từ Dashboard sang `redirectTo: 'files'` |
| `apps/web/src/app/pages/dashboard/` | **Đã xoá** (dashboard.ts/.html/.scss) |
| `apps/web/src/app/layout/nav-sidebar.html` + `.ts` | Thêm mục điều hướng "Tìm kiếm AI" → `/app/search` |

### 11.Q. Đa ngôn ngữ (i18n) Việt/Anh, chọn ở Cài đặt — tự viết, không thêm thư viện — bổ sung 2026-08-20

**Yêu cầu**: cho người dùng đổi ngôn ngữ hiển thị (Việt ↔ Anh) ngay trong trang Cài đặt (mục 11.D), áp dụng cho **toàn bộ app** ngay từ đầu — không phải hạ tầng dựng sẵn rồi dịch dần từng trang.

| Quyết định | Lý do |
|---|---|
| Tự viết `LangService` + dictionary TS thay vì thêm `@ngx-translate/core` | Nhất quán với mọi lượt "không thêm dependency" trước đó trong plan (cropper ảnh tự viết mục 11.L, không JSZip cho nén file mục 3...). Chỉ cần 2 ngôn ngữ tĩnh, không cần lazy-load theo route hay ICU pluralization — thứ các thư viện i18n lớn giải quyết nhưng app này không cần tới |
| Dictionary là 2 file TypeScript (`i18n/vi.ts`, `i18n/en.ts`), không phải JSON | Được TypeScript type-check ngay lúc build: thiếu hoặc gõ sai key ở `en.ts` là **lỗi compile**, không phải hiện key thô (`"files.errorLoad"`) ra UI lúc runtime rồi mới phát hiện |
| `vi.ts` khai báo **không** dùng `as const`; `en.ts` gõ kiểu `export const en: Dict = {...}` với `type Dict = typeof vi` | Nếu `as const`, mọi giá trị lá bị suy thành literal type (VD kiểu của `save` là chính xác chuỗi `"Lưu"`, không phải `string`) ⇒ `en.ts` gán `"Save"` vào cùng field bị TypeScript từ chối. Bỏ `as const` để giá trị lá widen về `string`, nhưng **cấu trúc key** (`Dict`) vẫn bị ép buộc y hệt — `en.ts` thiếu 1 key là lỗi compile ngay |
| Lưu lựa chọn ở `localStorage`, tái dùng đúng pattern `ThemeService` đã có sẵn | Đúng quyết định đã chốt cho mọi cài đặt cá nhân — không thêm bảng DB (mục 11.D / hàng #31 mục 0) — ngôn ngữ hiển thị cũng là tuỳ chọn thuần cá nhân, không cần đồng bộ đa thiết bị |
| `TranslatePipe` (dùng trong template qua `\| t`) khai báo `pure: false` | Output của pipe phụ thuộc **state ngoài** (`LangService.lang()`), không chỉ phụ thuộc input (key truyền vào) — pipe pure mặc định sẽ không re-render lại chữ khi đổi ngôn ngữ nếu key không đổi |
| `formatDate()` (`file-utils.ts`) nhận thêm tham số `locale`, dùng `Intl`/`toLocaleDateString(locale, ...)` thay vì tự ghép chuỗi | Đổi ngôn ngữ phải đổi cả **định dạng ngày** (`vi-VN` → DD/MM/YYYY, `en-US` → MM/DD/YYYY), không chỉ đổi chữ hiển thị — tận dụng luôn `Intl` sẵn có của trình duyệt thay vì tự viết logic format |
| Setting ngôn ngữ là **card đầu tiên** trong trang Cài đặt, cùng layout `.card.sect` với card Giao diện (theme) | Đúng yêu cầu gốc "nó sẽ nằm trong settings" — tái dùng UI pattern đã có, không thiết kế thêm loại control mới |

**Phạm vi dịch**: toàn bộ chuỗi hiển thị trong app — cả template (`.html`) lẫn chuỗi cứng trong code TS (toast/thông báo lỗi như `"Đã sao chép ..."`, tên thư mục mặc định khi tạo mới...). Rà soát bằng 2 lượt regex tìm ký tự có dấu tiếng Việt (`[À-ỹ]`): 1 lượt cho chuỗi trong `'...'`/`"..."`, 1 lượt riêng cho template literal (`` `...` ``) — lượt đầu bỏ sót các chuỗi trong backtick (VD toast ghép tên file động), phải quét thêm lượt 2 mới bắt hết.

> **Rút kinh nghiệm giữa chừng**: ban đầu để nguyên "AI Search" bằng tiếng Anh trong `vi.ts` (coi như tên tính năng/thương hiệu, giống cách "My Storage" giữ nguyên tiếng Anh). Người dùng phản hồi muốn dịch luôn — sửa lại `sidebar.aiSearch` và `search.title` trong `vi.ts` thành "Tìm kiếm AI" (`en.ts` giữ nguyên "AI Search"). Bài học: không tự suy đoán chuỗi nào là "tên riêng nên giữ tiếng Anh" khi không được xác nhận rõ — mặc định dịch hết, trừ khi có chỉ định ngược lại.

**Chỗ đã đụng vào (tiêu biểu — thực tế chạm gần như toàn bộ `apps/web/src/app`):**

| Tệp | Việc |
|---|---|
| `apps/web/src/app/core/i18n/lang.service.ts` | **Mới** — service trung tâm: signal ngôn ngữ hiện tại (đọc/ghi `localStorage`), `t(key, params?)` resolve key dạng dot-path (`'files.errorLoad'`) bằng đệ quy + thay `{{param}}` bằng regex, `locale()` cho `formatDate` |
| `apps/web/src/app/core/i18n/vi.ts`, `en.ts` | **Mới** — 2 dictionary; `vi.ts` là nguồn `Dict`, `en.ts` type-check theo đúng cấu trúc key của `vi.ts` |
| `apps/web/src/app/shared/translate.pipe.ts` | **Mới** — `TranslatePipe` (`pure: false`), dùng trong template qua `\| t` |
| `apps/web/src/app/core/files/file-utils.ts` | `formatDate()` nhận thêm tham số `locale` (mặc định `'vi-VN'`) |
| `apps/web/src/app/pages/settings/settings.html` + `.ts` | Thêm card chọn ngôn ngữ (đầu tiên, cùng layout card Giao diện) |
| `apps/web/src/app/pages/files/`, `trash/`, `shared/`, `search/`, `layout/nav-sidebar`, `layout/shell`, và toàn bộ page/component còn lại | Dịch template qua `\| t` + chuỗi cứng trong `.ts` (toast, thông báo lỗi, tên mặc định...) qua `lang.t(...)` |

## 12. Chia sẻ (Share) — mời theo email trong app + link công khai

> Tính năng này nằm trong MVP phụ (mục 2.2) nhưng trước đây chỉ có 1 dòng mô tả, chưa từng được thiết kế. Mục này chốt thiết kế đầy đủ để implement.

### 12.A. Phạm vi đã chốt — 2 kênh chia sẻ

| Kênh | Đối tượng nhận | Cách xác thực | Dùng khi |
|---|---|---|---|
| **A. Trực tiếp trong app** (kênh chính) | 1 user **đã có tài khoản**, mời bằng **email** | JWT của chính người nhận | Gửi cho người cũng dùng app này — người nhận được **thông báo**, file hiện ở view "Được chia sẻ với tôi" |
| **B. Link công khai** | Bất kỳ ai có link | `token` trong URL (+ mật khẩu tuỳ chọn) | Gửi ra ngoài app (người nhận không có tài khoản) |

Cả 2 kênh **dùng chung 1 bảng `Share`** (12.C) vì bản chất giống nhau — "cấp quyền đọc vào 1 target" — chỉ khác **cách nhận diện người được cấp**. Nhờ vậy: dialog "Quản lý quyền" liệt kê cả 2 bằng 1 query, thu hồi cũng chỉ là xoá row cho cả 2.

**Vẫn để NGOÀI phạm vi**: role `editor` (người nhận sửa/xoá/upload vào folder được chia sẻ). Lượt này người nhận chỉ **xem + tải** (`viewer`), vì quyền ghi kéo theo hàng loạt câu hỏi khác (ai chịu quota dung lượng, người nhận xoá thì vào Thùng rác của ai, trùng tên xử lý theo cây của ai...) — không đáng gộp vào một lượt.

#### ⚠️ Điểm phá vỡ giả định lớn nhất của code hiện tại

Toàn bộ backend đang xây trên bất biến **"thấy được = sở hữu"** (`WHERE userId = me`, hàm `assertOwned()` ở `FilesService`/`FoldersService`). Kênh A phá vỡ đúng bất biến đó: giờ có file bạn **thấy được nhưng không sở hữu**.

**Quyết định để giảm tối đa phạm vi ảnh hưởng** — file được chia sẻ **KHÔNG trộn vào các lăng kính sẵn có**:

| View | Nguồn dữ liệu | Đổi gì? |
|---|---|---|
| Lăng kính Thư mục, Lăng kính Loại, Gần đây, Có gắn dấu sao, Dashboard, Thùng rác, AI Search | **Chỉ file mình sở hữu** (`WHERE userId = me`) | **KHÔNG đổi một dòng nào** |
| **"Được chia sẻ với tôi"** (view mới) | Chỉ file người khác chia sẻ cho mình | View hoàn toàn mới, query riêng |

Đây chính là cách Google Drive tách "My Drive" khỏi "Shared with me", và khớp đúng triết lý **"2 lăng kính không bao giờ trộn lẫn"** đã chốt ở mục 11.H — nay thành lăng kính thứ 3. Nếu trộn file được chia sẻ vào mọi view thì phải sửa **toàn bộ** query list/stats/search + mọi chỗ gọi `assertOwned()`, rủi ro hở quyền cao mà lợi ích không tương xứng.

**Nguyên tắc bất di bất dịch:**
1. Link chia sẻ **không bao giờ** trỏ tới URL public của bucket (xem 12.B) — luôn qua backend, luôn presigned TTL ngắn.
2. Client công khai **không bao giờ** gửi `fileId`/`folderId` thật để quyết định quyền — mọi thứ phân giải từ `token`.
3. Mọi điều kiện hợp lệ kiểm ở **hàm dùng chung**, không rải rác từng handler: `resolveShare()` cho kênh B (12.E), `assertGrantedAccess()` cho kênh A (12.I).
4. Người nhận **chỉ đọc**: không rename/move/xoá/upload, không thấy file đó trong Thùng rác hay số đếm dung lượng của mình.

### 12.B. Bảo mật đường lấy nội dung: chỉ presigned, không URL public

**Bối cảnh lịch sử (2026-07-25, thời còn dùng R2)**: khi rà code để thiết kế mục này đã phát hiện bucket R2 bật **public development URL** (`R2_PUBLIC_BASE_URL=https://pub-<hash>.r2.dev`) và `DownloadService.fileUrl()` ưu tiên trả thẳng URL đó. Đã kiểm chứng `HEAD pub-<hash>.r2.dev/<key-sai>` trả **404** (không phải 401/403) ⇒ bucket cho đọc ẩn danh: ai biết `{userId}/{fileId}` là tải được, tức **an toàn nhờ khó đoán**, không phải nhờ kiểm soát truy cập. Hệ quả nếu Share dùng URL đó: (1) **không thể thu hồi** — người nhận lưu URL là đọc được vĩnh viễn, CDN còn cache thêm tầng nữa; (2) `expiresAt` và mật khẩu chỉ còn là **trang trí**.

**Trạng thái hiện tại (từ 2026-08-14, quay lại R2): rủi ro tái mở MỘT PHẦN — cần kỷ luật thao tác.**

Diễn biến qua 3 giai đoạn:
1. **2026-07-25 (R2 gốc)**: phát hiện bucket R2 bật public dev URL, `HEAD` key sai trả 404 (không phải 401/403) ⇒ đọc ẩn danh được, an toàn nhờ khó đoán chứ không phải kiểm soát truy cập thật.
2. **2026-07-26 → 2026-08-14 (GCS)**: bật **Public access prevention** — khoá **cứng ở tầng hạ tầng**, dù code có lỡ gọi `publicUrl()` cũng chỉ nhận `null`. Rủi ro coi như đóng hẳn.
3. **2026-08-14 → nay (R2 lại)**: R2 **không có** toggle tương đương "Public access prevention". Bảo vệ quay về đúng cơ chế gốc: **không bật** Public Development URL trên Dashboard (thao tác) + để trống `R2_PUBLIC_BASE_URL` (code) ⇒ `StorageService.publicUrl()` trả `null`, `DownloadService.fileUrl()` rơi vào nhánh presigned.

- Trang công khai `/s/:token` vẫn **luôn** lấy nội dung qua backend với **presigned TTL 10 phút** (`SHARE_CONTENT_TTL_SECONDS`). Thu hồi có hiệu lực trong tối đa 1 TTL — không đổi qua các giai đoạn.
- **Khác biệt quan trọng cần nhớ**: giai đoạn GCS có đảm bảo **ở tầng hạ tầng** (infra-enforced); giai đoạn R2 hiện tại đảm bảo **ở tầng thao tác + code** (ops-enforced) — nghĩa là 1 lần bấm nhầm "Enable Public Development URL" trên Dashboard Cloudflare, hoặc 1 lần set nhầm `R2_PUBLIC_BASE_URL` trong env production, sẽ làm thủng ngay. **Nên kiểm tra định kỳ** (VD mỗi lần deploy) rằng bucket vẫn ở chế độ private mặc định.
- Đánh đổi đã chấp nhận: R2 vẫn có CDN Cloudflare miễn phí đi kèm (khác GCS phải trả thêm Cloud CDN riêng) — nhưng **không dùng** để giữ mọi đường đọc là presigned; nếu grid thumbnail chậm rõ rệt mới cân nhắc bật public + custom domain, và khi đó phải rà lại toàn bộ mục 12.

> ⚠️ Nếu sau này vì lý do hiệu năng mà bật public access + điền `R2_PUBLIC_BASE_URL`, **phải rà lại toàn bộ mục 12**: mọi lập luận về thu hồi/hết hạn/mật khẩu ở đây dựa trên giả định "không có đường đọc ẩn danh".

### 12.C. Schema — thêm 2 model: `Share` + `Notification`

Model đầy đủ đã đặt trong khối schema ở **mục 7.B**. Phần này giải thích **vì sao** từng quyết định:

| Quyết định | Lý do |
|---|---|
| `token` random, **không** dùng `fileId` | Sinh bằng `crypto.randomBytes(16).toString('base64url')` → 22 ký tự, ~128 bit. Dùng `fileId` làm token thì không thu hồi được (id không đổi được) và lộ luôn id nội bộ. Không dùng `randomUUID()` vì chỉ 122 bit và dài hơn khi lên URL. |
| **2 FK nullable** (`fileId?` + `folderId?`) thay vì `targetType` + `targetId` | Giữ được `onDelete: Cascade` **thật ở tầng DB**: xoá vĩnh viễn file/folder thì link tự chết, không cần code dọn. Polymorphic bằng string không làm được điều này. Ràng buộc "đúng 1 trong 2" kiểm ở tầng app — nhất quán mục 3 (mọi ràng buộc ở NestJS). |
| **1 bảng cho cả 2 kênh** thay vì `Share` + `ShareMember` riêng | Bản chất giống nhau: "cấp quyền đọc vào target X", chỉ khác cách nhận diện người được cấp (`token` vs `sharedWithUserId`). Gộp lại thì dialog "Quản lý quyền" liệt kê cả 2 bằng 1 query, thu hồi cùng 1 đường code, `expiresAt`/`allowDownload` không phải nhân đôi. Đánh đổi: có cột chỉ dùng cho 1 kênh (`passwordHash` chỉ cho link) — chấp nhận được, rẻ hơn nhiều so với 2 bảng gần trùng nhau. |
| `@@unique([fileId, sharedWithUserId])` + `@@unique([folderId, sharedWithUserId])` | Chặn mời trùng 1 người 2 lần cho cùng target (mời lại = cập nhật row cũ). **Không** ảnh hưởng kênh link vì Postgres coi mỗi `NULL` là khác nhau ⇒ nhiều link share cùng target vẫn tồn tại song song. |
| Cho phép **nhiều link cho 1 item** | Use case thật: 1 link hết hạn 7 ngày gửi cho người A, 1 link vĩnh viễn cho người B. UI mặc định hiện link mới nhất + mục "Quản lý link". |
| Lưu **cả** `sharedWithUserId` **và** `sharedWithEmail` | `sharedWithUserId` là thứ dùng để kiểm quyền (email đổi được, id thì không). `sharedWithEmail` chỉ để **hiển thị lại** trong dialog mà không phải gọi ngược Supabase Auth mỗi lần render danh sách. |
| `passwordHash` dùng **`crypto.scrypt` có sẵn của Node** | `scryptSync(password, salt, 64)`, lưu dạng `salt:hash`, so sánh bằng `timingSafeEqual`. **Không thêm** `bcrypt`/`argon2` — đúng triết lý plan, và scrypt là KDF chuẩn đủ mạnh cho mục đích này. |
| **Không có cột `revokedAt`** | Thu hồi = xoá hẳn row. Đơn giản hơn, và không có nhu cầu tra lịch sử link đã huỷ. |
| Có `viewCount` / `downloadCount` / `lastAccessAt` | Đủ để hiện "đã xem 5 lần" trong dialog — chỉ tốn 1 câu `increment`. **Không** làm bảng log truy cập chi tiết (over-engineering cho MVP). |

### 12.D. Giao cắt với các cơ chế đã có — phần dễ thủng nhất

Share cắt ngang gần như mọi luồng đã chốt. Bảng này là checklist bắt buộc khi implement:

| Cơ chế đã có | Ảnh hưởng & xử lý bắt buộc |
|---|---|
| **Thùng rác (`deletedAt`, mục 7.E/11.K)** | Item bị xoá mềm thì link phải **404 ngay**. Mọi truy vấn phân giải token bắt buộc kèm `deletedAt: null` — đúng loại lỗi đã từng bỏ sót ở `zip.processor.ts` (lượt 2026-07-23, zip đóng gói nhầm file đã xoá mềm). Khôi phục từ Thùng rác → link sống lại nguyên trạng, không cần tạo lại. |
| **Xoá vĩnh viễn (mục 7.E giai đoạn 2)** | `onDelete: Cascade` tự xoá row `Share`. Không cần code thêm — nhưng **phải nhớ** khi viết migration là cascade đúng chiều. |
| **`status` của file (mục 7.B)** | Chỉ phục vụ file `status = 'ready'`. File đang `uploading`/`processing`/`failed`/`delete_pending` → 404, tránh chia sẻ file chưa ghép xong trên R2. |
| **Chia sẻ folder** | Người xem duyệt được cây con. **BẮT BUỘC verify hậu duệ**: mọi request public kèm `fileId`/`folderId` con phải xác nhận item đó thật sự nằm trong cây con của folder gốc đã share (lần `parentId` ngược lên, tái dùng `folderMap` mục 11.H). **Thiếu bước này = 1 link folder bất kỳ trở thành chìa khoá đọc toàn bộ file của user.** |
| **Rate limit (mục 5.D)** | Route public không có user id → `UserThrottlerGuard` fallback về `req.ip` (đã có sẵn). NHƯNG guard đang **tắt toàn cục** (`shouldSkip` trả true khi `RATE_LIMIT !== 'on'`) — chấp nhận được với route đã đăng nhập, **không** chấp nhận được với route ẩn danh (brute-force token/mật khẩu). ⇒ Guard riêng `PublicThrottlerGuard` **không override `shouldSkip`**. Đề xuất: 60 req/phút/IP cho xem, **10 req/phút/IP cho thử mật khẩu**. |
| **Auth guard** | Mọi controller hiện gắn `@UseGuards(JwtAuthGuard, ...)` ở **cấp class**, chưa có cơ chế `@Public()`. ⇒ Tách hẳn **controller riêng không gắn guard**, thay vì chế thêm decorator + global guard (sửa phạm vi toàn cục dễ hở nhầm chỗ khác). |
| **CORS (`main.ts`)** | Chỉ mở cho `WEB_ORIGIN`; trang `/s/:token` nằm trong cùng app Angular ⇒ **không cần đổi**. |
| **Supabase Realtime + RLS (`supabase-setup.sql`)** | Kênh B (ẩn danh) không nói chuyện với Supabase ⇒ policy `realtime_own_files` giữ nguyên. **Nhưng kênh A cần thêm**: bảng `Notification` phải vào publication `supabase_realtime` + policy RLS `SELECT` cho `authenticated` lọc `"userId" = auth.uid()::text` — lặp **đúng** khuôn mẫu đã dùng cho bảng `File` (DO-block `if not exists` để chạy lại an toàn). Thiếu policy = user này nghe được thông báo của user khác. |
| **AI Search (mục 8.C)** | **Không đổi** — file được chia sẻ **không** lọt vào semantic search của người nhận (RPC vẫn lọc `user_id = người đang tìm`). Chấp nhận có chủ đích: search nội dung file người khác kéo theo câu hỏi quyền phức tạp, để lượt sau. |
| **Redis cache (mục 5.C)** | Thêm key `share:{token}` TTL 60s cache phân giải token (kênh B). Kênh A **không cache quyền** — sai sót ở đây nghĩa là người bị thu hồi vẫn đọc được tới 60s; rẻ hơn thì cứ query, `@@index([sharedWithUserId])` đã đủ nhanh. Invalidate khi sửa/thu hồi. **Không** cache nội dung file. |
| **Dung lượng & stats (mục 11.H)** | Không đổi — file được chia sẻ vẫn tính vào `SUM(size)` của **owner**, không tính vào của người nhận (họ không sở hữu byte nào). |
| **Bất biến "thấy được = sở hữu"** | Đây là thứ bị phá vỡ (xem 12.A). Xử lý: **không** sửa `assertOwned()` — giữ nguyên cho mọi thao tác GHI (rename/move/xoá/upload) vì người nhận chỉ có quyền đọc. Thêm hàm **mới** `assertGrantedAccess()` (12.I) chỉ dùng cho các đường ĐỌC của view "Được chia sẻ với tôi". Hai hàm tách bạch, không hàm nào nới lỏng hàm kia. |
| **Thùng rác (phía người nhận)** | Người nhận **không** xoá được file của owner ⇒ không có gì vào Thùng rác của họ. Owner xoá mềm → item biến mất khỏi view "Được chia sẻ với tôi" (vì `deletedAt IS NULL` là điều kiện chung) nhưng row `Share` **vẫn còn**; owner khôi phục thì tự hiện lại. Không cần thông báo "file đã bị xoá" cho MVP. |
| **Trang Profile / Auth metadata (mục 11.E)** | Hiển thị "ai đã chia sẻ" cần email của owner. Lấy từ `auth.users` (12.I) — **không** tạo bảng `User` riêng, giữ đúng quyết định mục 11.E. |

### 12.E. API

**Nhóm A — quản lý quyền chia sẻ (CÓ đăng nhập, chủ sở hữu), `ShareController` @ `/api/shares`**

| Endpoint | Mô tả |
|---|---|
| `POST /shares/link` | Tạo **link** (kênh B). Body `{ fileId?, folderId?, allowDownload?, expiresInDays?, password? }` → trả `{ id, token, url, ... }`. Xác thực sở hữu bằng `assertOwned()` sẵn có. |
| `POST /shares/invite` | Mời **theo email** (kênh A). Body `{ fileId?, folderId?, email, allowDownload?, expiresInDays? }` → tra user theo email (12.I), tạo row `Share` + đẩy `Notification` cho người nhận. Mời lại người đã có quyền = cập nhật row cũ (nhờ `@@unique`). |
| `GET /shares?fileId=&folderId=` | Danh sách **mọi** quyền của 1 item (cả link lẫn người được mời) — cho dialog "Quản lý quyền". |
| `PATCH /shares/:id` | Sửa `allowDownload` / `expiresAt` / đặt hoặc gỡ mật khẩu (link). |
| `DELETE /shares/:id` | Thu hồi (xoá row) — dùng chung cho cả 2 kênh. |

**Nhóm B — truy cập công khai (KHÔNG guard), `PublicShareController` @ `/api/s`**

| Endpoint | Mô tả |
|---|---|
| `GET /s/:token` | Metadata dựng trang: tên, loại, kích thước, `allowDownload`, `kind` (file/folder), cờ `requiresPassword`. **Không** trả `fileId` thật, **không** trả URL bucket. Nếu có mật khẩu mà chưa mở khoá → chỉ trả `{ requiresPassword: true }`, không kèm gì khác (kể cả tên file). |
| `POST /s/:token/unlock` | Body `{ password }`. Đúng → trả **token phiên ngắn hạn** (JWT ký bằng `SHARE_SESSION_SECRET`, TTL 30 phút, payload chỉ chứa `token` + `exp`) để các request sau gửi kèm. Không dùng cookie/session server-side — không phát sinh state. |
| `GET /s/:token/content` | Presigned URL TTL 10 phút để **xem** (ảnh/video/audio/PDF — R2 hỗ trợ Range request sẵn). Tăng `viewCount`. |
| `GET /s/:token/download` | Presigned `attachment` + đúng tên gốc (tái dùng `contentDisposition()` ở `r2.service.ts`, đã xử lý tiếng Việt có dấu — mục 11.J). **403** nếu `allowDownload = false`. Tăng `downloadCount`. |
| `GET /s/:token/blob` | Proxy bytes qua backend — cho renderer DOCX/XLSX phía client cần `fetch()` đọc được response (đúng lý do đã ghi ở `DownloadService.fileBlob`: tránh phụ thuộc CORS của bucket — mục 5.A). |
| `GET /s/:token/list?folderId=` | **Chỉ với link folder**: liệt kê con của `folderId` (mặc định = gốc đã share), sau khi verify hậu duệ (12.D). |
| `GET /s/:token/file/:fileId/{content\|download\|blob}` | **Chỉ với link folder**: thao tác trên 1 file con — cũng phải verify hậu duệ trước. |

**Hàm phân giải chung `resolveShare(token, sessionToken?)`** — mọi endpoint nhóm B đều đi qua, kiểm **một chỗ duy nhất** theo thứ tự: tồn tại → chưa hết hạn → mật khẩu đã mở (nếu có) → target `deletedAt IS NULL` → (file) `status = 'ready'`. Không lặp lại điều kiện ở từng handler — đây chính là bài học từ lượt Thùng rác (vá thiếu 1 chỗ là thủng).

**Nhóm C — người NHẬN truy cập (CÓ đăng nhập), `SharedWithMeController` @ `/api/shared`**

| Endpoint | Mô tả |
|---|---|
| `GET /shared` | View "Được chia sẻ với tôi": các `Share` có `sharedWithUserId = me`, chưa hết hạn, target chưa bị trash. Kèm metadata file/folder + **email người chia sẻ** + `folderPath` (mục 11.H). |
| `GET /shared/:shareId/list?folderId=` | Chỉ với chia sẻ folder: duyệt cây con read-only, sau khi verify hậu duệ (12.D). |
| `GET /shared/file/:fileId/{content\|download\|blob\|text}` | Xem/tải 1 file được chia sẻ. Mọi đường đều gọi `assertGrantedAccess(me, fileId)` (12.I) trước. `download` trả **403** nếu `allowDownload = false`. |

> Cố tình **không** nhét các đường này vào `DownloadController` sẵn có: controller đó dựng trên `assertOwned()` (chỉ chủ sở hữu). Trộn 2 mô hình quyền vào cùng một chỗ là cách nhanh nhất để hở quyền khi sửa về sau.

### 12.F. Frontend

- **Dialog "Chia sẻ"** (một dialog, 2 phần — giống Google Drive): mở từ menu ngữ cảnh file/folder đã có (`onContextMenu` ở trang Files), dùng lại `app-modal`.
  - *Phần trên — Mời người dùng*: ô nhập **email** + nút "Mời", bên dưới là danh sách người đang có quyền (avatar/email + "Người xem" + nút gỡ). Báo lỗi rõ khi email chưa có tài khoản (xem 12.I).
  - *Phần dưới — Link công khai*: nút "Tạo link" → ô link + nút Sao chép, công tắc "Cho phép tải xuống", chọn hết hạn (Không / 1 / 7 / 30 ngày), đặt mật khẩu (tuỳ chọn), số lượt xem-tải, nút "Thu hồi".
- **Trang công khai `/s/:token`**: route đặt **ngoài** `Shell` và `authGuard` (cạnh `login` trong `app.routes.ts`) — người chưa đăng nhập phải vào được. Layout tối giản: tên file + kích thước + khung xem trước + nút Tải xuống; link folder thì thêm khung duyệt cây read-only.
- **View "Được chia sẻ với tôi"** (`/shared`): mục sidebar mới trong nhóm "DUYỆT" (cạnh Thùng rác), dùng chung khung Grid/List (mục 11.G) + cột thêm **"Người chia sẻ"** (email owner) và **"Vị trí"** (`folderPath`). Không có nút Xoá/Đổi tên/Di chuyển — chỉ Xem và Tải xuống.
- **Chuông thông báo**: icon trong header của `Shell` + badge số chưa đọc, bấm ra dropdown danh sách. Nhận realtime qua Supabase (12.J) và bắn `Notification` trình duyệt bằng `core/notification.service.ts` **đã có sẵn** (mục 11.F Phương án 1) — không viết mới.
- **Refactor cần làm trước** (có ảnh hưởng chéo): các component ở `shared/preview/` hiện gọi thẳng `api.fileBlob(fileId)` (đường authed, chỉ chủ sở hữu). Phải đổi sang **nhận URL/loader truyền vào** để dùng chung cho cả 3 ngữ cảnh (chủ sở hữu / được chia sẻ / link công khai). Làm bước này trước, nếu không sẽ phải viết trùng toàn bộ renderer 3 lần.
- **Chỉ báo trên card**: item đang được chia sẻ hiện icon 🔗/👤 nhỏ — thêm `_count: { shares: true }` vào `select` của query list sẵn có, rẻ, không thêm endpoint.

### 12.G. Env mới

```
SHARE_BASE_URL=http://localhost:4200      # backend dựng URL đầy đủ trả cho dialog
SHARE_SESSION_SECRET=<random>             # ký token phiên khi mở khoá mật khẩu
SHARE_CONTENT_TTL_SECONDS=600             # TTL presigned cho link công khai (10 phút, mục 12.B)
```

### 12.H. Thứ tự triển khai đề xuất

Kênh A (trực tiếp trong app) làm **trước** vì đó là use case chính; kênh B (link) dùng lại phần lớn hạ tầng đã dựng.

1. Model `Share` + `Notification` + `prisma db push` (additive, không mất dữ liệu — đúng cách đã làm với `deletedAt`, **không** dùng `prisma migrate dev` vì repo chưa có lịch sử migration). Thêm `Notification` vào publication Realtime + policy RLS trong `supabase-setup.sql`.
2. `ShareModule`: `ShareService` (tra user theo email + `assertGrantedAccess` + CRUD) → `ShareController` (nhóm A) → `SharedWithMeController` (nhóm C).
3. `NotificationModule` + chuông thông báo ở `Shell` (12.J).
4. Refactor `shared/preview/*` nhận URL/loader truyền vào (chặn đường cả 2 kênh nếu không làm sớm).
5. Dialog "Chia sẻ" (phần **mời theo email**) + view `/shared`.
6. Kênh B: `PublicShareController` + `PublicThrottlerGuard` + trang `/s/:token` cho **file**.
7. Chia sẻ **folder** cho cả 2 kênh (duyệt cây + verify hậu duệ) — **sau cùng** vì phức tạp và rủi ro bảo mật cao nhất.

> Cơ chế chi tiết của bước 2 (tra user, kiểm quyền) ở **12.I**; của bước 3 (thông báo) ở **12.J**.

### 12.I. Kênh A — tra user theo email & kiểm quyền

#### Tra user theo email

Không có bảng `User` riêng (quyết định mục 11.E) ⇒ phải hỏi Supabase Auth.

**Chốt: truy vấn thẳng `auth.users` bằng Prisma `$queryRaw`** —
```sql
select id, email from auth.users where lower(email) = lower($1) limit 1
```
- Prisma kết nối bằng connection string cấp service-role nên **đọc được schema `auth`** (đúng lý do đã ghi ở mục 3 về việc RLS không áp dụng cho Prisma).
- Chính xác và rẻ: 1 query, cột `email` đã có unique index sẵn của Supabase.
- **Đánh đổi đã cân nhắc**: phụ thuộc vào schema nội bộ của Supabase Auth. Chấp nhận được vì `auth.users(id, email)` là phần ổn định nhất và đây là truy vấn **chỉ đọc**. Phương án dự phòng nếu Supabase đổi schema: `supabase.auth.admin.listUsers()` qua `@supabase/supabase-js` (đã là dependency của API) rồi lọc — đúng chuẩn hơn nhưng phải duyệt phân trang toàn bộ user.

#### Các trường hợp biên bắt buộc xử lý

| Tình huống | Xử lý |
|---|---|
| Email chưa có tài khoản | Trả lỗi rõ ràng: *"Email này chưa có tài khoản trên app. Hãy dùng Link công khai để gửi ra ngoài."* — có chủ đích **không** làm "lời mời chờ đăng ký" (pending invite) ở lượt này: kéo theo luồng gán quyền lúc signup, không đáng cho MVP. |
| Tự chia sẻ cho chính mình | Chặn ở tầng service, báo lỗi. |
| Mời lại người đã có quyền | Không tạo row mới — cập nhật row cũ (nhờ `@@unique`), và **không** bắn thông báo trùng. |
| Người nhận đổi email sau khi được mời | Quyền vẫn đúng vì kiểm theo `sharedWithUserId`, không theo email. `sharedWithEmail` chỉ là nhãn hiển thị (có thể cũ — chấp nhận). |
| **Dò email (account enumeration)** | Thông báo "chưa có tài khoản" vô tình xác nhận email nào **có** tài khoản. Với app cá nhân, rủi ro chấp nhận được và đổi lại UX rõ ràng. Ghi nhận tại đây để sau này biết là có chủ đích, không phải bỏ sót. |

#### `assertGrantedAccess(userId, fileId)` — hàm kiểm quyền đọc

Trả về file nếu **một trong ba** đúng, ngược lại ném `NotFoundException` (không dùng 403 để không lộ sự tồn tại của file):
1. `file.userId === userId` (chính chủ), **hoặc**
2. Có `Share` với `sharedWithUserId = userId` trỏ **thẳng** vào `fileId`, **hoặc**
3. Có `Share` với `sharedWithUserId = userId` trỏ vào **một folder tổ tiên** của file (lần `parentId` ngược lên gốc, tái dùng `folderMap` mục 11.H).

Mọi trường hợp còn phải thoả: share **chưa hết hạn**, file `deletedAt IS NULL`, `status = 'ready'`.

> Điều kiện (3) chính là chỗ dễ sai nhất của cả tính năng — chia sẻ folder mà quên kiểm tổ tiên thì hoặc là người nhận không mở được file con (lỗi nhẹ), hoặc là kiểm hụt và cho đọc file ngoài cây (lỗi bảo mật). Viết **một** hàm, dùng chung cho cả kênh A và kênh B (kênh B thay bước "có Share của user" bằng "có Share khớp token").

### 12.J. Thông báo trong app

**Vì sao cần bảng `Notification` thật** (không chỉ Realtime như mục 11.F Phương án 1): Realtime chỉ tới được khi **tab đang mở**. Chia sẻ là việc xảy ra lúc người nhận thường **không** online ⇒ không có bảng thì thông báo mất luôn. Bảng giải quyết: đăng nhập lại vẫn thấy chưa đọc, có badge đếm, có lịch sử.

**Luồng:**
1. `POST /shares/invite` tạo row `Share` → tạo row `Notification` cho người nhận (`type: 'share_received'`, `linkPath: '/shared'`) trong **cùng một** transaction Prisma (`$transaction`) — tránh cảnh có quyền nhưng không có thông báo hoặc ngược lại.
2. Người nhận đang mở app: Supabase Realtime đẩy INSERT của bảng `Notification` (đã thêm vào publication + policy RLS lọc `auth.uid()`) → Angular cập nhật badge và gọi `notification.service.ts` bắn Notification trình duyệt.
3. Người nhận offline: lần mở app sau, `GET /notifications?unread=true` trả về đủ.

**Endpoint** (`NotificationController` @ `/api/notifications`): `GET /notifications?unread=`, `PATCH /notifications/:id/read`, `POST /notifications/read-all`.

**Có chủ đích KHÔNG làm ở lượt này:**
- **Gửi email** cho người nhận (cần SMTP/Resend + template) — thông báo trong app là đủ cho phạm vi "người dùng của app này".
- Web Push thật (mục 11.F Phương án 2) — vẫn để ngỏ như cũ.
- Thông báo cho các sự kiện khác (thumbnail xong, zip xong...) — cột `type` đã chừa sẵn, thêm sau chỉ là thêm giá trị enum, không đổi schema.

## 13. Nhật ký thay đổi

> ⚠️ Object storage đổi nhà cung cấp **2 lần** — đọc kỹ trước khi tin bất kỳ câu nào nhắc "GCS" hay "R2" ở các mục dưới đây theo đúng nghĩa đen của nó:
> 1. Các mục ghi ngày **trước 2026-07-26** nhắc "R2"/"Cloudflare R2" mô tả trạng thái **lúc đó** (R2 gốc).
> 2. Các entry ghi ngày **2026-07-26 → 2026-08-14** mô tả giai đoạn dùng **Google Cloud Storage** — giữ nguyên câu chữ, đây là lịch sử đã xảy ra thật.
> 3. Từ **2026-08-14**, object storage **quay lại Cloudflare R2** (hosting API rời Cloud Run sang Render — xem entry cuối mục này) — mục 1–12 đã được rà lại để mô tả **đúng trạng thái hiện tại (R2)**; chỉ những đoạn cố tình gắn nhãn "lịch sử"/"giai đoạn giữa" mới còn nói về GCS.
> Giữ nguyên toàn bộ câu chữ cũ trong changelog bên dưới để không bóp méo lịch sử quyết định — phần đang có hiệu lực nằm ở các mục 0–12 phía trên.

- **2026-07-15**: Khởi tạo kế hoạch. Chốt Supabase Auth. Để ngỏ embedding provider.
- **2026-07-15**: Chuyển thư mục dự án sang `C:\Users\PCPV\repos\storage-app`.
- **2026-07-15**: Bổ sung chiến lược tối ưu dung lượng lưu trữ (nén client-side, tách AI artifacts khỏi file gốc), chiến lược chunked multipart upload + CDN/Range Requests/Redis cache, và kế hoạch chi tiết tính năng preview/thumbnail (background worker + Supabase Realtime + Prisma schema `File`). Nguồn: `storage_optimization_guide.pdf`, `document_preview_plan.pdf`.
- **2026-07-15**: Chốt embedding provider = Google Gemini Embedding API (`gemini-embedding-001`, backup Jina AI). Đã verify package `@google/genai` và sửa tên model từ `text-embedding-004` (lỗi thời) sang `gemini-embedding-001`. Ghi chú rủi ro chưa xác thực được rate-limit free tier cụ thể.
- **2026-07-15**: Chốt text extraction strategy (mục 8.D): `pdf-parse` (PDF, đã verify vẫn active maintain), `mammoth` (DOCX), Gemini OCR cho ảnh/PDF scan thay vì `tesseract.js`. Đã verify + sửa code mẫu OCR: dùng `ai.files.upload()` + `ai.interactions.create()` (model sinh nội dung `gemini-3.5-flash`, khác với model embedding). Ghi nhận `officeparser` là lựa chọn gộp gọn cho tương lai (hỗ trợ thêm XLSX/PPTX + có sẵn RAG chunking).
- **2026-07-15**: Làm rõ 3 điểm: (1) chiến lược "ủy thác OCR cho Gemini" vẫn ổn ở quy mô vài người dùng nhờ BullMQ đã tuần tự hoá job — thêm ghi chú concurrency limit + retry backoff vào mục 5.B; (2) sửa lại khung "giới hạn dung lượng" — storage app không nên áp trần tổng dung lượng, chỉ cần trần per-file (kỹ thuật) + rate limiting theo request (chống abuse), cập nhật mục 3 & 9; (3) review đề xuất XLSX/PPTX của Gemini — xác nhận `xlsx`/SheetJS đúng, nhưng code mẫu `office-text-extractor` bị sai cú pháp (đã sửa thành `getTextExtractor()`), quyết định XLSX/PPTX là tính năng **phụ** (dùng `officeparser`), không thuộc MVP chính vì trọng tâm sản phẩm là lưu trữ + AI search.
- **2026-07-15**: Chốt con số cụ thể cho mục 5.D (mới thêm): trần dung lượng 1 file = **2GB** (env var, không hardcode) — tính toán dựa trên free tier R2 đã verify (10GB storage/tháng, 1M Class A + 10M Class B ops miễn phí) và giới hạn multipart thật của R2 (10,000 parts, 5MiB-5GiB/part, verify từ Cloudflare docs). Chốt chunk size = 8MB. Chốt bảng rate limiting theo user id qua `@nestjs/throttler`: upload session 30/phút, browse 100/phút, AI search 20/phút, download 200/phút.
- **2026-07-15**: Dựng prototype UI tĩnh (HTML/CSS/JS) minh hoạ grid file, AI search panel, luồng upload bất đồng bộ — publish tại Artifact riêng (không lưu trong repo).
- **2026-07-15**: Thêm mục 0 "Tóm tắt giải pháp đã chốt" lên đầu file để tra cứu nhanh. Thêm mục 10 "Khoảng trống & rủi ro cần xử lý" sau khi rà soát toàn bộ plan — phát hiện các gap chưa thiết kế: cấu trúc folder trong DB, CORS cho R2, move/rename trên R2 (không atomic), cascading delete, và verify thêm free tier Supabase (500MB DB, tự pause sau 1 tuần không hoạt động — rủi ro thật cho side project ít dùng).
- **2026-07-15**: Rà soát sâu thêm và phát hiện 2 gap nghiêm trọng mới (chưa từng nhắc tới): (1) thiếu hẳn schema `DocumentChunk` để lưu chunk text + vector — bảng lõi nhất của cả tính năng AI Search; (2) "Download file/folder" trong MVP chính chưa có giải pháp kỹ thuật cho việc tải cả 1 thư mục (R2 không hỗ trợ native). Đồng thời phát hiện mâu thuẫn nội bộ: mục 4.B (nén file gốc thành zip) xung đột với mục 5.A (upload thẳng, không qua NestJS) và mục 5.C (Range Requests preview — không range được vào file zip).
- **2026-07-15**: Hoàn chỉnh toàn bộ các gap trên trong 1 lượt: (1) thêm model `Folder` + `DocumentChunk` vào schema (mục 7.B); (2) chốt R2 key = ID cố định thay vì path — giải quyết luôn vấn đề move/rename không atomic (mục 5.A); (3) thêm CORS policy mẫu cho R2 (mục 5.A); (4) thiết kế luồng cascading delete — xoá R2 trước, DB sau (mục 7.E, mới); (5) thiết kế download folder qua zip bất đồng bộ (mục 5.E, mới); (6) thêm RPC SQL `match_document_chunks` có filter `user_id` bắt buộc — vá lỗ hổng bảo mật tiềm ẩn (mục 8.C); (7) bỏ hẳn ý tưởng nén file gốc thành zip (mục 4.B) — giải quyết mâu thuẫn đã phát hiện; (8) chốt Prisma làm ORM chính thức; (9) thêm chiến lược Redis cache invalidation (chủ động + TTL ngắn, mục 5.C). Đồng bộ lại số liệu chunk size (8MB) giữa các mục.
- **2026-07-15**: Soi plan theo 1 kịch bản luồng tương tác cụ thể (user chia sẻ) từ Login → Dashboard → Upload → AI Search, phát hiện thêm 1 loạt gap thật (không phải lỗi thời của kịch bản, vốn dùng số liệu cũ đã lỗi thời như chunk 10MB/`text-embedding-004`/ngưỡng similarity cứng — plan đã chốt khác từ trước, giữ nguyên). Gap mới, đã quyết và ghi vào plan: (1) **drag & drop** là tương tác upload chính + picker dự phòng, kéo thả folder đọc đệ quy qua `webkitGetAsEntry()` (mục 2.1) — trả lời luôn câu hỏi mở cũ về upload folder; (2) **trùng tên** file/folder tự thêm hậu tố kiểu Windows Explorer `(1)(2)` (mục 2.1), tách bạch với câu hỏi versioning thật sự (vẫn để mở, mục 9.1); (3) **resumable upload** dùng thẳng `ListParts` API có sẵn của R2, không cần bảng DB riêng track chunk (mục 5.A); (4) thêm `status: 'failed'` + `errorMessage` vào schema `File` — tránh file kẹt vô thời hạn ở `processing` khi AI xử lý lỗi vĩnh viễn (mục 7.B); (5) file trích text rỗng (không lỗi) vẫn `ready`, chỉ không có `DocumentChunk` (mục 7.B); (6) chốt cách NestJS verify JWT — `passport-jwt` + Supabase JWT secret (mục 3); (7) chốt AI Search chỉ trigger khi nhấn Enter, không debounce theo keystroke, tiết kiệm quota Gemini (mục 8.C). Cố tình **để phụ, chưa thiết kế sâu**: UI chi tiết cho progress bar/nút tạm dừng khi upload (cần xem lại có khớp MVP + phương pháp kỹ thuật đã chốt hay không, tính sau khi implement — mục 9.5), OAuth Google login (mục 9.4), tính năng "gợi ý file/folder" ở Dashboard (ngoài scope, chỉ là ý tưởng minh hoạ — mục 9.7), phân trang danh sách file (mục 9.6).
- **2026-07-15**: Rà soát top-to-bottom toàn bộ file sau các lượt cập nhật gần đây, sửa 4 điểm không nhất quán: (1) lỗi heading `## 8.D` (đang ngang hàng mục 8 thay vì là con của nó) → sửa thành `### 8.D`; (2) hàng #20 mục 0 trích dẫn nhầm mục 7.E (cascading delete, không liên quan `status: failed`) → bỏ, chỉ giữ 7.B; (3) mục 7.B tham chiếu "hết số lần retry của BullMQ" nhưng mục 5.B chưa từng chốt con số → thêm cụ thể **tối đa 3 lần** (`attempts: 3` + backoff) vào mục 5.B; (4) quy tắc tự thêm hậu tố `(1)(2)` khi trùng tên (mục 2.1) trước đó chỉ nói tới lúc tạo mới/upload, trong khi MVP chính cũng có rename/move — mở rộng quy tắc áp dụng chung cho cả 3 tình huống thay vì chỉ 1.
- **2026-07-16**: Rà soát "sẵn sàng build chưa" theo yêu cầu, phát hiện + sửa 4 điểm quan trọng trước khi chốt plan: (1) **bug thật**: `File.size` kiểu `Int` (32-bit, max ~2.147 tỷ) tràn số đúng ở trần dung lượng 2GB đã chốt → đổi sang `BigInt` (mục 7.B); (2) **mâu thuẫn kiến trúc**: mục 3 (Auth) từng nói Supabase Auth "tích hợp RLS dễ" cho public/private + roles, nhưng ORM đã chốt Prisma kết nối thẳng Postgres connection string (service-role) khiến Postgres RLS không tự áp dụng — sửa lại mô tả cho khớp thực tế: phân quyền xử lý ở tầng app (NestJS), tự lọc `WHERE userId` tường minh trong mọi query, nhất quán với cách RPC search đã làm từ đầu (mục 3, mục 0 hàng #2 & #27); (3) **quyết định còn thiếu**: chốt quy tắc chunking text trước khi embed — cố định 1000 ký tự/chunk, overlap 100 ký tự, tự cắt bằng vòng lặp string không thêm thư viện ngoài (mục 8.C, mục 0 hàng #25); (4) **gap bị bỏ sót**: thêm dòng Video vào bảng thumbnail (mục 7.C) — theo đúng pattern đã có với Office (MVP chỉ icon, Production dùng ffmpeg chụp frame giây đầu rồi tái dùng pipeline resize của `sharp`), mục 4.A đã ngầm coi video là loại file có hỗ trợ đặc biệt nhưng 7.C trước đó bỏ sót (mục 0 hàng #26). Sau 4 điểm này, plan đủ chắc để chốt và bắt đầu build — các mục còn lại ở mục 9/10 là câu hỏi mở/rủi ro chấp nhận được, không chặn thiết kế.
- **2026-07-16**: Thêm hẳn **mục 11 "Cá nhân hoá & Điều hướng nâng cao"** (mới) theo yêu cầu bổ sung "râu ria" tham khảo UI Google Drive (settings, profile, sort, filter, star, cây thư mục, thông báo đẩy) — mục "Nhật ký thay đổi" dời từ mục 11 xuống **mục 12** để giữ đúng thứ tự đọc. Chi tiết từng phần, tất cả đều chọn phương án đơn giản nhất, không phát sinh bảng DB thừa: (1) **11.A Sort & Filter** — chỉ thêm query param vào endpoint list sẵn có, xếp vào **MVP chính** vì gần như miễn phí; (2) **11.B Star/Favorite** — thêm `isStarred: Boolean` vào `File` + `Folder` (mục 7.B), xếp **MVP phụ**; (3) **11.C Cây thư mục sidebar + breadcrumb** — lazy load con theo node khi expand (không load hết cây 1 lần), tái dùng nguyên `Folder.parentId` sẵn có, xếp **MVP chính** vì là 1 phần của "duyệt file" cốt lõi; xác nhận luôn việc tạo thư mục con trong thư mục khác không cần thiết kế gì thêm; (4) **11.D Settings** — chốt lưu ở `localStorage`, không tạo bảng `UserSettings`, tránh over-engineering cho 1 người dùng; (5) **11.E Profile** — dùng thẳng Supabase Auth user metadata, không tạo bảng `User` riêng; (6) **11.F Thông báo** — đưa ra 2 phương án và đánh giá: Browser Notification API (rẻ, tái dùng Realtime sẵn có, chỉ báo khi tab mở) **chốt làm trước**, Web Push thật (cần Service Worker + VAPID + bảng `PushSubscription` + effort cao hơn hẳn) để ngỏ làm sau nếu thật sự cần, thêm câu hỏi mở mục 9.8.
- **2026-07-18**: Thêm **mục 11.H "Kiến trúc điều hướng: 2 lăng kính (Thư mục ↔ Loại) + Dashboard"** theo phản hồi UX của người dùng ("Google Drive rối, Recent đổ đầy màn hình làm người mới choáng, không biết dùng"). Quyết định cốt lõi: tách bạch **2 lăng kính không trộn lẫn** — (A) **Thư mục** giữ đúng cấu trúc lúc upload (`folderId`, mục 11.C), (B) **Theo loại** cắt ngang mọi folder (`extension IN (...)`, không ràng buộc folder). Chốt qua 3 câu hỏi với người dùng: (1) **Trang chủ = Dashboard tóm tắt** (thanh dung lượng + tile truy cập nhanh theo loại + "Gần đây" thu nhỏ giới hạn cứng 6-8 file) thay vì đổ feed Recent — chính là cái chống nỗi choáng của Drive; (2) **Sidebar "Theo loại" = 7 nhóm cân bằng** (Tài liệu/Ảnh/Video/Âm thanh/Code/Nén/Khác, gộp bảng tính+trình chiếu vào Tài liệu), mỗi nhóm dropdown ra từng đuôi file kèm **số đếm**; (3) view-theo-loại hiện **breadcrumb đầy đủ** (`Gốc › Dự án › Ảnh`) mỗi dòng, bấm crumb nhảy sang lăng kính Thư mục, file ở gốc thì không có path. Backend chỉ thêm 3 thứ additive, **không đổi schema**: endpoint `GET /files/stats` (`groupBy extension` + cache Redis) cấp số đếm cho sidebar & tile Dashboard; query param `?extensions=...` cross-folder trên `GET /files` sẵn có; enrich `folderPath` per-file (nạp folder map 1 lần rồi lần `parentId`, nâng cấp recursive CTE nếu cây lớn). Cập nhật mục 0 (thêm hàng #35-#37), ghi chú mục 11.A rằng "Filter theo loại" nay được nâng cấp thành lăng kính đầy đủ ở 11.H (11.A là nền backend, 11.H là lớp IA/UI). Mọi thứ tái dùng Redis cache/invalidation (mục 5.C), Realtime (mục 7.A), toggle Lưới/Danh sách (mục 11.G), breadcrumb+lazy tree (mục 11.C) đã chốt — không phát sinh model/bảng mới.
- **2026-07-16**: Thêm **mục 11.G "Chế độ hiển thị: Lưới & Danh sách"** theo yêu cầu bổ sung toggle Grid/List (tham khảo thêm UI Google Drive) — xếp **MVP chính** vì thuần là đổi component render, không phát sinh API/schema mới: Lưới tái dùng Card đã chốt ở mục 7.D, Danh sách là bảng dòng ngang mới (Tên/Lần sửa đổi/Dung lượng) cùng nguồn dữ liệu với mục 11.A; lựa chọn Lưới/Danh sách lưu ở `localStorage` tái dùng cơ chế Settings mục 11.D. Thêm hàng #34 vào mục 0.
- **2026-07-23**: Rà lại toàn bộ luồng xoá file/folder theo yêu cầu "nghĩ về vấn đề Thùng rác giống Google Drive" — phát hiện gap nghiêm trọng: thiết kế cũ ở mục 7.E xoá **vĩnh viễn gần như ngay lập tức**, chỉ trễ vài giây do job dọn R2, hoàn toàn không có đường khôi phục khi lỡ tay. Thiết kế lại thành **Thùng rác 2 giai đoạn**, nâng lên **MVP chính** (an toàn dữ liệu, không phải tiện ích phụ): (1) thêm cột `deletedAt DateTime?` vào cả `File` và `Folder` (mục 7.B) — xoá mềm chỉ đổi 1 timestamp, không đụng R2, khôi phục được; cascade `deletedAt` xuống toàn bộ con khi trash 1 folder để mọi query list chỉ cần `WHERE deletedAt IS NULL`, không cần kiểm tra đệ quy tổ tiên; (2) viết lại mục 7.E: Giai đoạn 1 (xoá mềm, vào Thùng rác) → Giai đoạn 2 (xoá vĩnh viễn, tái dùng nguyên luồng R2-trước-DB-sau cũ), thêm job BullMQ định kỳ quét Thùng rác quá hạn (`TRASH_RETENTION_DAYS` = 30 ngày mặc định, env var); (3) thiết kế luồng Khôi phục (Restore) — clear `deletedAt` đệ quy, áp lại đúng quy tắc trùng tên `(1)(2)` đã chốt ở mục 2.1, xác nhận **không cần** thêm cột `originalFolderId` vì xoá mềm không đổi `folderId`; (4) chốt quy ước Thùng rác chỉ hiện **trash root**, không rã cây con ra hiển thị (giống Google Drive) — quyết định này giải quyết luôn câu hỏi "khôi phục file khi folder cha cũng bị xoá" bằng cách loại bỏ tình huống đó khỏi UI; (5) thêm **mục 11.K** mô tả UI (cột "Vị trí gốc" + "Còn N ngày", nút Khôi phục/Xoá vĩnh viễn/Dọn thùng rác) và endpoint mới (`GET /trash`, `POST /trash/empty`, `PATCH .../trash`, `PATCH .../restore`, `DELETE /files|folders/:id`) — toàn bộ additive, không thêm bảng DB; (6) vá lỗ hổng liên quan: RPC `match_document_chunks` (mục 8.C) thêm điều kiện `deletedAt is null` để file đã xoá mềm không lọt vào kết quả AI search; `GET /files/stats` (mục 11.H) thêm `deletedAt: null` vào query để sidebar/Dashboard không đếm nhầm file trong Thùng rác; (7) chốt file trong Thùng rác **vẫn tính vào** dung lượng Dashboard (giống Drive thật, vì dữ liệu vẫn còn trên R2) — khác với việc bị loại khỏi số đếm theo loại/sidebar. Cập nhật mục 0 (thêm hàng #38-#39), mục 3, mục 10.A.
- **2026-07-23 (implement)**: Cài đặt Thùng rác thật vào code (không chỉ thiết kế). Backend: `deletedAt` thêm vào `File`/`Folder` qua `prisma db push` lên Supabase thật (additive, không mất dữ liệu — KHÔNG dùng `prisma migrate dev` vì repo chưa có lịch sử migration, nó đòi reset toàn bộ DB); RPC `match_document_chunks` cập nhật trực tiếp trên DB qua `prisma db execute`; `FilesService`/`FoldersService` thêm `trash()`/`restore()`/`hardDelete()` (thay `remove()` cũ), mọi query list/stats/folderMap/siblingNames lọc `deletedAt: null`; `TrashModule` mới (`TrashService` gộp trash-root file+folder, `TrashController` ở `/trash`, `TrashSweepProcessor` + `TrashSweepScheduler` đăng ký BullMQ repeatable job 03:00 mỗi ngày qua `jobId` cố định để không tạo job trùng khi restart); phát hiện + vá thêm 1 gap khi rà `zip.processor.ts`: tải folder/bulk zip trước đó KHÔNG lọc `deletedAt`, có thể đóng gói nhầm file đã xoá mềm vào zip — thêm filter. Frontend: trang `/trash` (list phẳng + cột "Vị trí gốc"/"Còn N ngày" + Khôi phục/Xoá vĩnh viễn/Dọn thùng rác có xác nhận gõ "XOÁ"), mục sidebar "Thùng rác", nút "Xoá" ở trang Files đổi sang gọi trash mềm (copy cũng sửa "không thể hoàn tác" → nói rõ có thể khôi phục). Phát hiện thêm: mục 11.I/11.J đã bị code dùng trước cho tính năng khác (retry thumbnail, bulk zip download) chưa từng ghi vào PLAN.md — đổi số mục Thùng rác từ 11.I dự kiến ban đầu sang **11.K** để tránh đụng số, và endpoint list thật dùng resource riêng `GET /trash` + `POST /trash/empty` (không lồng dưới `/files`) thay vì `GET /files/trash` như phác thảo ban đầu — tránh phụ thuộc thứ tự route với `GET /files/:id`. Rebuild + restart lại Docker image `storage-app-api:local` để container chạy thật lên code mới; xác nhận `nest build`/`ng build`/`tsc --noEmit` sạch và container boot thành công (route `/api/trash` map đúng, job sweep đăng ký thành công).
- **2026-07-25 (đổi Supabase project)**: Chuyển toàn bộ sang project Supabase mới `wvwrrkymwyvgsvbuzmep` (Tokyo) thay cho `zniettadfyvqglzlrwew` (Singapore). Tái tạo schema bằng `prisma db push` (3 model `Folder`/`File`/`DocumentChunk`) + chạy lại `prisma/supabase-setup.sql` (extension `vector`, RPC `match_document_chunks`, publication Realtime cho bảng `File`, policy RLS `realtime_own_files`); verify bằng query trực tiếp cả 3 thứ. Cập nhật `apps/api/.env` (DATABASE_URL dùng pooler `aws-0-ap-northeast-1`, SUPABASE_URL/ANON/SERVICE_ROLE) và `apps/web/src/environments/environment.ts`. Ghi chú: JWT của project mới ký **bất đối xứng** (ES256/RS256) nên `jwt.strategy.ts` verify qua JWKS, `SUPABASE_JWT_SECRET` chỉ còn là đường dự phòng cho token HS256 legacy.
- **2026-07-25 (thumbnail DOCX)**: Bỏ hẳn việc sinh ảnh xem trước cho DOCX — `ThumbnailService.supports()` không còn nhận `docx`, xoá `generateDocxThumb()` cùng helper `wrapText`/`firstLine` và import `mammoth`. Lý do: "thẻ xem trước" tự vẽ bằng SVG (11 dòng chữ cỡ 11px trên canvas 400×300) khi co về kích thước card (~150px) trở thành một khối chữ rối, không nhận diện được gì; thử phóng to chữ + giảm số dòng + ép NFC cho dấu tiếng Việt vẫn không đủ tốt. Quay về đúng ý định ban đầu của mục 7.C cho nhóm Office ở giai đoạn MVP: **chỉ hiện icon** (client đã có sẵn fallback `iconForExtension`). Xem trước đầy đủ khi bấm mở file vẫn giữ nguyên qua `docx-preview` (mục 11.I) — vốn render đúng layout Word thật. Đã dọn `thumbnailUrl` về `null` + xoá object thumbnail cũ trên R2 cho 19 file docx sẵn có.
- **2026-07-25 (implement Share + cropper)**: Cài đặt thật toàn bộ mục 12 + mục 11.L. **Backend**: 2 model `Share` + `Notification` đẩy lên Supabase bằng `prisma db push` (additive); `supabase-setup.sql` thêm bước 4/4b — đưa `Notification` vào publication Realtime + policy RLS `realtime_own_notifications`. `ShareModule` với **3 controller tách bạch theo mô hình quyền** (`ShareController` chủ sở hữu / `SharedWithMeController` người nhận / `PublicShareController` ẩn danh — controller cuối là chỗ DUY NHẤT không gắn `JwtAuthGuard`, bù lại bắt buộc `PublicThrottlerGuard` khoá theo IP và cố tình không override `shouldSkip` nên luôn bật kể cả khi `RATE_LIMIT` tắt). `ShareService` gom toàn bộ điều kiện vào 2 hàm dùng chung `resolveShare()` (kênh B) và `assertGrantedAccess()` (kênh A) đúng như plan; mật khẩu dùng `crypto.scrypt`, token phiên dùng HMAC tự ký — **không thêm dependency nào** (không bcrypt, không jsonwebtoken). `NotificationsModule` cho chuông. **Frontend**: trừu tượng `FileSource` (`core/file-source.ts`) tách renderer khỏi đường lấy nội dung — `docx-viewer`/`sheet-viewer`/`text-viewer` đổi từ `[fileId]` sang `[source]`, nhờ đó 3 ngữ cảnh quyền dùng chung một bộ renderer thay vì nhân bản 3 lần; thêm `app-file-preview` gom chuỗi chọn renderer cho 2 trang mới; dialog `app-share-dialog` (mời email + link công khai trong cùng 1 dialog); trang `/shared`; trang `/s/:token` đặt NGOÀI `Shell`/`authGuard`; chuông thông báo + `InboxService` (gộp REST lịch sử + Realtime để không mất thông báo lúc offline). **Mục 11.L**: `app-avatar-cropper` canvas ~200 dòng (mask tròn, pan bằng pointer events, zoom 1–4x, xoay 90°, `createImageBitmap(..., {imageOrientation:'from-image'})` cho EXIF), xuất webp 512px; `AvatarService.uploadBlob()` mới cho đường có cropper, giữ `upload()` cũ làm dự phòng; backend `me.controller.ts` **không đổi** đúng như thiết kế. **Kiểm chứng end-to-end với DB thật** (2 tài khoản, JWT thật tạo qua `auth.admin.generateLink` + `verifyOtp`): kênh B 15/15 (presigned **không** phải URL r2.dev — đúng mục 12.B; chỉ-xem → 403; hết hạn/thu hồi/file vào Thùng rác → 404, khôi phục thì link sống lại; meta khi có mật khẩu KHÔNG lộ tên tệp; sai mật khẩu và session bị sửa đều bị chặn; xoá folder thì `Share` tự cascade). Kênh A 13/13 (mời email chưa có tài khoản → 400 kèm gợi ý dùng link; tự chia sẻ cho mình → 400; `Share` + `Notification` tạo trong 1 transaction; mời lại KHÔNG nhân đôi thông báo; thu hồi là mất quyền ngay). **Kiểm tra riêng lỗ hổng nguy hiểm nhất** (verify hậu duệ, mục 12.D) 10/10: link folder không đọc được file ngoài cây, không list được folder ngoài cây, link-1-tệp không lấy được tệp khác qua `?fileId=`; và xác nhận file được chia sẻ **không lọt** vào view "Gần đây" của người nhận — đúng quyết định "không trộn lăng kính" ở mục 12.A. Người nhận gọi route ghi (`rename`/`trash`) đều 404 vì `assertOwned()` giữ nguyên. Rebuild + restart image `storage-app-api:local`; `nest build`, `ng build`, `eslint` đều sạch.
- **2026-07-25 (sửa lỗi NG0950 — dialog Chia sẻ không hiện)**: Bấm "Chia sẻ" không có gì xảy ra. Nguyên nhân: `ShareDialog` gọi `reload()` **trong constructor**, mà `reload()` đọc `input.required()` (`kind`/`targetId`) — Angular chỉ gán giá trị cho required input SAU khi dựng component, nên đọc sớm ném `NG0950` và component chết im lặng (không log ra UI). Trang `/s/:token` (`PublicShare`) dính đúng lỗi này vì đọc `token()` trong constructor. Sửa: chuyển phần khởi tạo sang `ngOnInit()` ở cả 2 component. Các component mới còn lại không dính vì đã dùng `effect()` (chạy sau khi input được gán) — `AvatarCropper`, `FilePreview`, và 3 renderer `docx/sheet/text-viewer`. **Bài học ghi lại để lần sau không lặp**: với `input.required()`, chỉ được đọc trong `ngOnInit`/`effect()`, KHÔNG đọc trong constructor. Đã kiểm chứng lại trên trình duyệt: menu → Chia sẻ mở đúng dialog, "Tạo link" trả link thật, mở link ở trang `/s/:token` xem được nội dung mà không cần đăng nhập.
- **2026-07-25 (thiết kế Share + cropper)**: Thêm **mục 12 "Chia sẻ qua link công khai (Share)"** (mới) và **mục 11.L "Cắt ảnh đại diện"** (mới); "Nhật ký thay đổi" dời từ mục 12 xuống **mục 13**. Diễn biến quyết định: ban đầu chốt **chỉ link công khai**, sau đó bổ sung yêu cầu "chia sẻ trực tiếp trong app bằng email + nhận thông báo" ⇒ thiết kế lại thành **2 kênh dùng chung 1 bảng `Share`** (kênh A `sharedWithUserId`, kênh B `token`) vì cùng bản chất "cấp quyền đọc vào target", chỉ khác cách nhận diện người nhận. Các điểm chốt: (1) **phát hiện rủi ro thật khi rà code** — bucket R2 đang bật public (`HEAD` key sai trả 404 chứ không phải 401) nên URL `pub-*.r2.dev` mà `DownloadService.fileUrl()` đang trả ra là world-readable; nếu Share dùng URL đó thì thu hồi/hết hạn/mật khẩu đều vô nghĩa ⇒ trang công khai **luôn** dùng presigned TTL 10 phút, ghi rủi ro còn lại vào mục 9.9 & 10.B; (2) **xử lý việc Share phá vỡ bất biến "thấy được = sở hữu"** của toàn bộ code hiện tại — chốt **không trộn** file được chia sẻ vào các lăng kính sẵn có, chỉ hiện ở view mới "Được chia sẻ với tôi" (đúng triết lý "lăng kính không trộn lẫn" mục 11.H) ⇒ **không phải sửa dòng nào** trong query list/stats/search, `assertOwned()` giữ nguyên cho thao tác ghi, thêm hàm mới `assertGrantedAccess()` chỉ cho đường đọc; (3) thêm bảng **`Notification`** (không chỉ dựa Realtime) vì chia sẻ hay xảy ra lúc người nhận offline — Realtime-only sẽ nuốt mất thông báo, đúng điểm yếu đã ghi ở mục 11.F; tạo `Share` + `Notification` trong cùng 1 `$transaction`; (4) tra user theo email bằng `$queryRaw` trên `auth.users` (Prisma đã ở cấp service-role) thay vì tạo bảng `User` — giữ đúng mục 11.E, dự phòng là `auth.admin.listUsers()`; (5) liệt kê đầy đủ **các chỗ giao cắt dễ thủng** thành checklist ở 12.D: Thùng rác (`deletedAt IS NULL` khi phân giải), verify **hậu duệ** khi chia sẻ folder (thiếu là lỗ hổng đọc toàn bộ file của user), throttle riêng theo IP cho route ẩn danh (guard hiện đang **tắt toàn cục** qua `RATE_LIMIT`), policy RLS cho bảng `Notification`; (6) cố tình để ngoài phạm vi: role `editor`, gửi email, pending invite (mục 9.10), AI search trên file được chia sẻ. **Mục 11.L**: chốt tự viết cropper canvas (mask tròn + pan + zoom + xoay, xuất 512px webp, dùng `createImageBitmap(..., { imageOrientation: 'from-image' })` cho EXIF) thay vì thêm `ngx-image-cropper`; backend `me.controller.ts` **không đổi** vì `sharp().resize(256,256,{fit:'cover'})` nhận ảnh đã vuông thì không cắt thêm gì. Cập nhật mục 0 (thêm hàng #40-#47), mục 2.2, mục 3 (4 hàng mới), mục 7.B (2 model mới + ghi chú), mục 9 (thêm 9.9, 9.10), mục 10.B, mục 11.E.
- **2026-07-26 (bỏ Cloudflare R2 → Google Cloud Storage)**: Cập nhật plan cho khớp code thật sau khi đổi nhà cung cấp object storage. **Lý do gốc**: khi deploy + kiểm thử trên môi trường Google Cloud (Cloud Run), luồng qua R2 không chạy ổn định; app chỉ dùng object storage để lưu trữ thuần tuý và 2 dịch vụ có cùng cơ chế cơ bản (S3-compatible, multipart, presigned URL), nên chuyển hẳn sang **Google Cloud Storage** và gom hạ tầng về cùng một nhà cung cấp với nơi chạy API. **Cách tích hợp**: dùng **XML API tương thích S3** (bật Interoperability + HMAC key của service account có role `Storage Object Admin`), giữ nguyên `@aws-sdk/client-s3`/`s3-request-presigner` — chỉ đổi `endpoint`, `region` (= location bucket) và credential ⇒ toàn bộ luồng multipart/presign/`ListParts`/stream/delete viết cho R2 dùng lại nguyên vẹn, `R2Service` đổi tên thành `StorageService`, env `R2_*` thành `GCS_*`. **Thay đổi trong plan**: (1) thêm hẳn **mục 5.F "Đặc thù Google Cloud Storage"** — cách kết nối, checklist việc phải làm phía Google Cloud, và bảng **bẫy đã gặp thật** (nổi bật: AWS SDK v3 ≥3.729 tự chèn `x-amz-checksum-crc32` khiến GCS từ chối PUT ⇒ phải đặt `requestChecksumCalculation/responseChecksumValidation = 'WHEN_REQUIRED'`); (2) **mục 5.A** viết lại cho đúng thực tế code: chunk đi **qua backend** (`POST /uploads/part`) chứ không PUT thẳng lên bucket ⇒ **bỏ hẳn phần cấu hình CORS** (không cần nữa), ghi rõ đánh đổi là byte upload đi qua Cloud Run; (3) **mục 5.C** bỏ Cloudflare CDN, thay bằng presigned URL trực tiếp + bucket đặt cùng vùng người dùng, Cloud CDN để mở kèm cảnh báo presigned URL làm cache hit thấp; (4) **mục 5.D** tính lại lý do trần 2GB — không còn "free tier 10GB/tháng" để bảo vệ, GCS tính tiền theo mức dùng thật nên trần đổi vai trò thành chống tai nạn; ghi chú *Always Free* của GCS chỉ áp cho vài region Mỹ, **không** áp cho bucket `asia`; sửa luôn hàng rate-limit upload cho đúng (request chở chunk không nằm trong hạn mức 30/phút); (5) **mục 5.E** đổi sang lifecycle rule của GCS (`gcloud storage buckets update --lifecycle-file`, xoá tiền tố `_zips/` sau 1 ngày); (6) **mục 6** vẽ lại sơ đồ kiến trúc (Cloud Run + GCS, chiều lên qua backend / chiều xuống presigned trực tiếp); (7) **rủi ro "bucket public" đóng hẳn** — mục 12.B viết lại: bucket GCS bật *Public access prevention* + `R2_PUBLIC_BASE_URL` để trống nên `publicUrl()` trả `null` và **mọi** đường đọc là presigned; điều từng là "kỷ luật của code" nay được hạ tầng bảo đảm; cập nhật theo đó mục 9.9 (đổi thành câu hỏi "có cần Cloud CDN không"), mục 10.A/10.B, và hàng #44 ở mục 0; (8) thêm rủi ro mới vào 10.B: **chi phí GCS** (cần bật budget alert, theo dõi storage/egress/ops) và làm rõ mục hosting đã có Dockerfile cho Cloud Run; (9) ghi rõ ở mục 7.B rằng **cột DB vẫn tên `r2Key`** (và payload job vẫn `r2Keys`) là **di sản cố ý giữ lại** — đổi tên chỉ tốn migration + sửa hàng chục chỗ mà không thêm giá trị; (10) rà toàn bộ file thay các tham chiếu R2 còn lại (mục 0, 1, 2.1, 3, 4, 7.A/7.B/7.E, 8.C, 11.E, 11.K, 12.D/12.E) sang GCS, chỉ giữ chữ "R2" ở những chỗ **cố tình** kể lại lịch sử hoặc so sánh 2 nhà cung cấp.
- **2026-07-26 (responsive toàn app)**: Rà lại giao diện trên khổ điện thoại/máy tính bảng và bổ sung **mục 11.M** (mới). Trọng tâm: sửa ở **tầng chung** (`index.html`, `styles.scss`, `_tokens.scss`, `shell.scss`, `modal.ts`) thay vì thêm breakpoint rời rạc cho từng trang. Phần nền thêm mới: `100dvh` thay `100vh`, token `--safe-t/r/b/l` bọc `env(safe-area-inset-*)` + `viewport-fit=cover`, `touch-action: manipulation`, vùng bấm 44px cho thiết bị chạm qua `@media (pointer: coarse)` (dùng `::after` nên không phá bố cục desktop), `overscroll-behavior: contain` cho mọi lớp phủ, `color-scheme` + `<meta name="theme-color">` theo theme, khối `prefers-reduced-motion`, và thang chữ tiêu đề thu nhỏ ở ≤640px. Bốn lỗi vỡ thật đã sửa: (1) **topnav bị cắt cụt** trên mobile — ô tìm kiếm bị ép về 0px, nút bên phải văng khỏi màn hình ⇒ chuyển 2 hàng + dải sắp xếp cuộn ngang; (2) tên tệp dài nong bảng Danh sách làm cả trang cuộn ngang ⇒ `overflow-wrap: anywhere`; (3) modal không có trần chiều cao nên nút hành động bị đẩy khỏi màn hình ⇒ `max-height: 100dvh - …` + thân cuộn + ≤480px nút xếp dọc; (4) lưới tệp `minmax(180px)` cứng ⇒ đổi sang `minmax(min(180px,100%),1fr)` + 132px ở ≤560px để giữ 2 cột. Kiểm chứng bằng cách nhúng app vào iframe 360/390/768px trên `ng serve` rồi đo trong trang: không có cuộn ngang (`scrollWidth - innerWidth = 0`), `.shell` cao đúng `innerHeight`, dải hành động cuộn được thật. Nâng ngưỡng cảnh báo `anyComponentStyle` trong `angular.json` 16→20kB vì `files.scss` vượt sau khi thêm rule.
- **2026-07-26 (Sao chép/Cắt/Dán + tinh chỉnh UI)**: Thêm **mục 11.N** (mới) theo phản hồi khi dùng thử thật trên điện thoại lẫn desktop. **Tính năng mới lớn nhất — Sao chép/Cắt/Dán** (`Ctrl+C`/`Ctrl+X`/`Ctrl+V` + menu chuột phải, chạy được cả với nhiều mục đang chọn): bảng nháp là service signal trong app (KHÔNG dùng `navigator.clipboard` — nó không chở được tham chiếu tệp trên server), Cắt tái dùng `move` sẵn có (0 byte phát sinh), Sao chép dùng `CopyObjectCommand` **copy server-side ngay trên GCS** nên byte không đi qua Cloud Run, và **chép luôn `DocumentChunk` (text + vector) bằng raw SQL** để bản sao tìm được bằng AI search ngay mà không phải gọi lại Gemini. Sao chép thư mục là đệ quy chạy đồng bộ (cây nhỏ ở quy mô cá nhân). Chặn: dán ở lăng kính không phải Thư mục (Theo loại/Gần đây/Có gắn dấu sao — đúng ý "trừ mấy cái được truy vấn ngược"), dán thư mục vào chính nó hoặc hậu duệ, sao chép tệp chưa `ready`. Endpoint mới `POST /files/:id/copy` + `POST /folders/:id/copy`, **không đổi schema**. **Tìm kiếm tách 2 tầng trong cùng 1 ô**: vừa gõ → dropdown gợi ý theo TÊN qua `GET /files?q=` (rẻ, không tốn quota), nhấn Enter → AI ngữ nghĩa như cũ (mục 8.C). **Tinh chỉnh UI**: topnav mobile đổi dải nút cuộn ngang thành 1 dropdown gộp; hiện lại chữ "Storage"; bỏ viền tròn các nút icon; lưới mobile bỏ tên tệp (thư mục vẫn có tên, Danh sách vẫn có tên, bật lại được ở Cài đặt); bỏ hẳn panel Chi tiết ở ≤960px (chặn ở tầng logic để không tốn request ký URL); nút trong preview chỉ còn icon kể cả trên desktop + cắt tên dài bằng "…"; icon đổi ảnh đại diện chuyển vào giữa ảnh, hiện khi hover. **Kiểm chứng thật với DB + GCS thật**: copy tệp video 70MB tên tiếng Nhật → object mới trên GCS đúng 70.482.037 byte khớp `size` trong DB (đo bằng `HeadObject`), copy lần 2 tự thành "(1)", copy cả cây trả về thư mục có đủ 1 thư mục con + 2 tệp, dán vào hậu duệ bị chặn 400 đúng thông báo; chạy lại toàn bộ luồng qua UI (Ctrl+C → vào thư mục → nút Dán → Ctrl+V lần 2) và xác nhận nút Dán **không** xuất hiện ở lăng kính Gần đây. Dọn sạch dữ liệu thử sau khi test (5 tệp/0 thư mục/thùng rác rỗng như trước).
- **2026-07-26 (thiết kế lại Trang chủ + căn chỉnh)**: Theo phản hồi "căn giữa, bố cục, trang chủ thiết kế lại cho phù hợp". **Trang chủ** dựng lại quanh một **hero căn giữa**: lời chào theo tên + vòng tròn dung lượng SVG thuần + 3 số Đã dùng/Còn trống/Tệp — cùng ngôn ngữ hình ảnh với thẻ "Dung lượng" ở Hồ sơ để 2 trang không rời rạc; đưa lại **"Truy cập nhanh" theo loại** (chỉ nhóm có tệp, số đếm dùng chung `StatsService`) vì trên điện thoại sidebar "Theo loại" bị giấu sau nút ☰; "Gần đây" thêm ảnh xem trước và **bấm mở đúng thư mục chứa tệp** thay vì luôn nhảy về danh sách Gần đây; hạ max-width 1040→760px. **Căn chỉnh**: lưới tệp trên điện thoại/tablet đổi sang ô **vuông + `object-fit: cover`** nên hàng nào cũng đều tăm tắp (trước đó ảnh dọc/ngang lẫn lộn, mỗi ô một kiểu); thẻ "Dung lượng" ở Hồ sơ căn giữa + 3 số thành lưới 3 cột ở ≤700px. Ghi lại **bẫy CSS đã dính 2 lần**: media query đặt TRƯỚC rule gốc trong file thì cùng độ đặc hiệu sẽ thua — phải nâng độ đặc hiệu (`.grid .tile-preview img`, `.grid .tile-title`). Kiểm chứng bằng iframe 424px + desktop 1200px trên `ng serve` với API cục bộ, sau đó trả `environment.ts` về URL Cloud Run.
- **2026-08-14 (quay lại Cloudflare R2, phát hiện & vá khi rà soát 2026-08-18)**: Trong khoảng thời gian này, hosting API rời **Google Cloud Run** sang **Render** (free plan, Singapore) và web chuyển sang **Cloudflare Workers Static Assets** (commit `chore: migrate storage config from GCS to Cloudflare R2, add deploy docs`, cùng lúc thêm `apps/api/DEPLOY.md` + `apps/web/DEPLOY.md`). Vì lý do gốc của quyết định 2026-07-26 ("gom object storage về cùng nhà cung cấp với Cloud Run") không còn áp dụng, object storage **quay lại Cloudflare R2** — code đổi (env `R2_*`, `StorageService` trỏ `r2.cloudflarestorage.com`) nhưng **PLAN.md không được cập nhật theo lúc đó**, khiến plan và code lệch nhau gần 1 tháng cho tới khi rà soát lại hôm nay. **Việc đã làm hôm nay để vá gap**: rà toàn bộ file, thay mọi tham chiếu "GCS"/"Google Cloud Storage" đang mô tả trạng thái **hiện tại** thành "R2"/"Cloudflare R2" (mục 0 hàng #1/#3/#4/#6/#7/#14/#16/#21/#38/#44/#48/#49, mục 1, 2.1, 3, 4, 5.A/5.C/5.D/5.E, 6, 7.A/7.B/7.E, 8.C, 9.9, 10.A/10.B, 11.E/11.H/11.N/11.O, 12.B/12.E); **viết lại hoàn toàn mục 5.F** thành "Đặc thù Cloudflare R2 (bản hiện hành)" kèm bảng so sánh GCS-vs-R2 thay vì tiếp tục mô tả GCS làm hiện tại; cập nhật sơ đồ kiến trúc mục 6 (Cloud Run → Render); **viết lại mục 12.B** thành 3 giai đoạn rõ ràng (R2 gốc → GCS đảm bảo hạ tầng → R2 lại là kỷ luật thao tác) vì đây là **rủi ro bảo mật tái mở một phần** đáng được nêu rõ, không chỉ đổi chữ; cập nhật header (mục 0-6) và cảnh báo đầu mục 13. Toàn bộ **entry lịch sử cũ giữ nguyên câu chữ** (không sửa những gì đã ghi ngày 2026-07-26 mô tả GCS) — chỉ phần mô tả trạng thái hiện tại được rà lại.
- **2026-08-18 (Hybrid Search — text + image)**: Thêm **mục 8.E** (mới). Vấn đề: semantic search 1 model (Gemini/BazaarLink) bỏ sót từ khoá chính xác và không tìm được ảnh bằng mô tả ngôn ngữ tự nhiên. Giải pháp 4 nhánh fuse bằng **Reciprocal Rank Fusion**: `dense` (BazaarLink/Gemini fallback, 768d) + `bge` (BAAI/bge-m3 qua HF Inference API, 1024d, đa ngôn ngữ) + `fts` (Postgres tsvector + GIN + `unaccent`, accent-insensitive) + ảnh qua **Gemini vision auto-captioning** (không dùng được CLIP/SigLIP vì HF Inference Providers 2025 không host serverless nhóm model này — đã thử 5 model khác nhau đều 400 "Model not supported"). Prompt vision ép sinh 3 khối OCR + MÔ TẢ + **TỪ KHOÁ (bắt buộc gồm tên dân dã**, VD ảnh hoa xuyến chi phải kèm "cứt lợn, cỏ hôi, đơn kim") để text chunk tự động lọt vào cả 3 nhánh text mà không cần schema/code riêng cho nhánh ảnh. **Ngưỡng lọc sau RRF**: dense ≥0.6 hoặc bge ≥0.65 (1 nhánh rất tự tin) HOẶC dense ≥0.45 và bge ≥0.55 (đồng thuận) HOẶC FTS hit — loại match yếu mà RRF vẫn xếp vào top-K; % hiển thị = cosine thật, không normalize theo top (tránh hiện tượng "top nào cũng 100%" gây hiểu lầm khi query không liên quan gì tới kết quả, phát hiện qua test "hoa cứt lợn" ra nhầm cầu thủ bóng đá). **Rerank cuối** bằng cross-encoder `BAAI/bge-reranker-v2-m3` để phân biệt các kết quả gần giống nhau chính xác hơn RRF thuần (VD "cầu thủ số 49" giữa 2 ảnh cầu thủ khác số áo — RRF/cosine cho điểm gần nhau, reranker phân biệt rõ 0.98 vs 0.01). **Query robustness**: chặn query <2 ký tự (tránh match rác 1 ký tự trùng ngẫu nhiên trong caption), tự normalize leet-speak (`h0a`→`hoa`) bằng cách embed song song cả 2 bản rồi lấy max, FTS match cả bản có dấu lẫn bản `unaccent`. **Vấn đề vận hành đã vá**: HF đổi endpoint (`router.huggingface.co`, path `/hf-inference/models/{id}/pipeline/{task}`), BazaarLink hết credit (402) tự fallback Gemini, Gemini free tier 20 req/ngày/model (đổi model khi hết quota), reranker response shape không cố định (tự nhận diện 2 shape). Kiểm chứng thật với 8 ảnh (2 cầu thủ Manchester United + 6 ảnh khác) qua HTTP thật: "số 49"→Garnacho 100%, "Cantona"→71%, "cứt lợn"→ra đúng ảnh hoa 56% (trước đó 0 kết quả), "c"/"a"→rỗng đúng như kỳ vọng guard. Chi tiết đầy đủ (log test, code snippet, bảng so sánh trước/sau) ở `HYBRID_SEARCH.md` (gốc repo).
