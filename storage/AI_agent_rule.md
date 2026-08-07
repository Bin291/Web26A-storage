# AI Agent Rule — Frontend (`storage`)

Đọc file này **trước khi** tạo, sửa, xoá hoặc refactor bất kỳ file nào trong dự án `storage`. Nếu hành động sắp làm không khớp với rule ở đây, hãy dừng lại và hỏi lại người dùng thay vì tự quyết.

Cấu trúc thư mục chuẩn nằm ở [`tree.md`](../tree.md) (mục 1 — Frontend). File này là **rule bắt buộc để thực thi** cấu trúc đó, không phải bản sao — nếu hai file lệch nhau, `tree.md` là nguồn xác định layout, còn file này là nguồn xác định *quy trình làm việc*.

## Nguyên tắc cứng (không được vi phạm)

1. **Không tạo thư mục cấp 1 mới** trong `src/app/` ngoài 5 thư mục đã có: `core/`, `shared/`, `features/`, `layout/`, và các file gốc (`app.ts`, `app.html`, `app.css`, `app.routes.ts`, `app.config.ts`, ...). Nếu thấy cần một khái niệm mới (vd. `plugins/`, `widgets/`), phải hỏi người dùng trước, không tự thêm.
2. **Không tạo NgModule** (`*.module.ts`). Toàn bộ component là standalone theo `storage/.claude/CLAUDE.md`. Route lazy-load bằng `loadComponent` / `loadChildren` trỏ thẳng vào component, không qua module.
3. **Không đặt file lạc chỗ**: mỗi file phải map được vào đúng 1 nhánh trong `tree.md`. Không tạo file `.ts`/`.html`/`.css` trực tiếp trong `src/app/` (ngoài các file gốc của `App`).
4. **Không tự ý tạo nhánh con không cần thiết**. Ví dụ: đừng tạo `features/dashboard/components/` nếu dashboard chưa có component con nào tách ra — chỉ tạo khi thực sự có ≥1 file cần đặt vào đó (áp dụng nguyên tắc "không premature abstraction" trong CLAUDE.md).
5. **Không thêm state management (NgRx) mặc định**. `tree.md` mô tả cấu trúc `store/` cho từng feature như một khả năng, không phải yêu cầu. Chỉ tạo `store/` khi feature thực sự cần state phức tạp chia sẻ giữa nhiều component; nếu không, dùng `signal()`/`computed()` cục bộ trong component hoặc một service đơn giản trong `core/services/` hay trong chính thư mục feature.
6. **Không xoá hoặc di chuyển file ra ngoài cấu trúc** khi refactor/redesign. Sửa nội dung tại chỗ; nếu bắt buộc phải đổi vị trí file, phải cùng lúc cập nhật mọi import liên quan và giải thích lý do.

## Vị trí đặt file theo loại thay đổi

| Việc cần làm | Đặt ở đâu |
|---|---|
| Thêm 1 feature/trang mới | `features/<ten-feature-kebab-case>/` — tạo `pages/`, `components/` bên trong **chỉ khi cần** |
| Component dùng lại ở ≥2 nơi | `shared/components/<ten-component>/` |
| Pipe/Directive dùng chung | `shared/pipes/` hoặc `shared/directives/` |
| Service gọi API dùng 1 lần duy nhất (singleton toàn app) | `core/services/` |
| Guard / Interceptor | `core/guards/` / `core/interceptors/` |
| Model / Interface dùng toàn app | `core/models/` |
| Header, sidebar, layout khung app | `layout/` |
| Route mới | Khai báo trong `app.routes.ts`, lazy-load bằng `loadComponent` |

## Quy trình khi tạo 1 feature mới

1. Xác định tên feature (kebab-case), tạo `features/<ten-feature>/`.
2. Tạo component trang chính trước (vd. `<ten-feature>.ts` + `.html` + `.css`), theo đúng convention đã dùng ở `features/dashboard/`: `standalone`, `ChangeDetectionStrategy.OnPush`, `signal()`/`computed()` cho state, `input()`/`output()` thay vì decorator.
3. Chỉ tách `components/` con khi trang có phần UI lặp lại hoặc phức tạp cần cô lập.
4. Thêm route trong `app.routes.ts` bằng `loadComponent`, lồng trong `MainLayout` nếu feature cần sidebar/topbar chung.
5. Nếu cần gọi API: tạo service trong `core/services/` (dùng chung) hoặc ngay trong thư mục feature nếu chỉ feature đó dùng.
6. Không tự thêm thư viện UI mới (chart, table, v.v.) nếu Angular Material đã đáp ứng được — dự án đã cài `@angular/material` với theme Material 3 tại `src/material-theme.scss`.

## Quy trình khi sửa thiết kế lại (redesign) hoặc refactor

1. Giữ nguyên vị trí file trong cây thư mục — redesign là sửa nội dung UI/CSS/logic, không phải sắp xếp lại thư mục.
2. Nếu refactor buộc phải tách file (component quá lớn), file tách ra phải nằm **trong cùng thư mục feature/shared/core** tương ứng, không tạo thư mục cấp cao mới.
3. Không đổi tên file/thư mục hàng loạt trừ khi được yêu cầu rõ ràng.
4. Sau khi sửa, chạy `ng build` để đảm bảo không phá cấu trúc import.

## Tự kiểm tra trước khi báo hoàn thành

- [ ] Mọi file mới đều nằm đúng nhánh theo bảng trên và theo `tree.md`.
- [ ] Không có thư mục cấp 1 mới trong `src/app/` ngoài 4 thư mục chuẩn.
- [ ] Không có thư mục con rỗng hoặc chỉ chứa `.gitkeep` được tạo "phòng khi cần" — chỉ tạo khi có file thật bên trong.
- [ ] Không có `*.module.ts` nào được tạo.
- [ ] `ng build` chạy thành công.
