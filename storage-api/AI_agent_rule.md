# AI Agent Rule — Backend (`storage-api`)

Đọc file này **trước khi** tạo, sửa, xoá hoặc refactor bất kỳ file nào trong dự án `storage-api`. Nếu hành động sắp làm không khớp với rule ở đây, hãy dừng lại và hỏi lại người dùng thay vì tự quyết.

Cấu trúc thư mục chuẩn nằm ở [`../tree.md`](../tree.md) (mục 2 — Backend, NestJS). File này là **rule bắt buộc để thực thi** cấu trúc đó, không phải bản sao — nếu hai file lệch nhau, `tree.md` là nguồn xác định layout, còn file này là nguồn xác định *quy trình làm việc*.

> Lưu ý: tại thời điểm viết rule này, `src/` mới chỉ có bộ khung mặc định của Nest CLI (`app.module.ts`, `app.controller.ts`, `app.service.ts`, `main.ts`). Các thư mục `config/`, `common/`, `database/`, `modules/`, `shared/` mô tả trong `tree.md` **chưa tồn tại** — chỉ tạo khi thực sự có nội dung đầu tiên cần đặt vào, không tạo trước hàng loạt thư mục rỗng.

## Nguyên tắc cứng (không được vi phạm)

1. **Không tạo thư mục cấp 1 mới** trong `src/` ngoài những gì `tree.md` liệt kê: `config/`, `common/`, `database/`, `modules/`, `shared/`. Nếu cần khái niệm mới, hỏi người dùng trước.
2. **Mỗi domain nghiệp vụ = 1 module riêng** trong `modules/<ten-domain>/`, đóng gói đủ `controller` + `service` + `module` + `dto/` + `entities/` (nếu có) + `*.spec.ts` đi kèm. Không viết logic nghiệp vụ thẳng vào `app.module.ts` hay `app.controller.ts`.
3. **`common/`** chỉ chứa thứ **không gắn với 1 domain cụ thể** (guard, filter, interceptor, pipe, decorator dùng ở ≥2 module). Nếu guard/interceptor chỉ phục vụ 1 module, đặt trong chính module đó, không đẩy lên `common/`.
4. **Không tạo file/thư mục rỗng "phòng khi cần"**. Chỉ tạo `dto/`, `entities/`, `strategies/`, `providers/`, `interfaces/` bên trong 1 module khi module đó thực sự có nội dung cho thư mục đó.
5. **Không xoá hoặc di chuyển file ra ngoài cấu trúc** khi refactor/redesign API. Sửa nội dung tại chỗ; nếu bắt buộc đổi vị trí, phải cập nhật mọi import và giải thích lý do.
6. **Không mất unit test khi refactor**: file `*.spec.ts` luôn nằm cạnh file gốc trong `modules/<domain>/`. E2E test nằm trong `test/`, không trộn vào `src/`.

## Vị trí đặt file theo loại thay đổi

| Việc cần làm | Đặt ở đâu |
|---|---|
| Thêm 1 domain/resource mới (vd. `files`, `users`) | `modules/<ten-domain>/` với `dto/`, `entities/`, `<domain>.controller.ts`, `<domain>.service.ts`, `<domain>.module.ts`, `<domain>.service.spec.ts` |
| Guard/filter/interceptor/pipe dùng chung nhiều module | `common/guards|filters|interceptors|pipes/` |
| Decorator dùng chung | `common/decorators/` |
| Hằng số dùng toàn app | `common/constants/` |
| Cấu hình app (env, database, jwt...) | `config/` |
| Migration, seed, kết nối DB | `database/` |
| Type/interface/util dùng toàn app, không gắn 1 domain | `shared/` |
| Đăng ký module mới | Import vào `app.module.ts` — không viết route/logic trực tiếp ở đây |

## Quy trình khi tạo 1 feature/domain mới

1. Xác định tên domain (số ít hoặc số nhiều nhất quán với domain khác đã có, vd. `users`, `files`).
2. Tạo `modules/<domain>/<domain>.module.ts`, `.controller.ts`, `.service.ts`.
3. Chỉ tạo `dto/` khi có ít nhất 1 DTO thật; chỉ tạo `entities/` khi có entity/schema thật (TypeORM/Prisma).
4. Viết `*.service.spec.ts` đi kèm ngay khi tạo service — không để lại "làm sau".
5. Import `<Domain>Module` vào `app.module.ts`.
6. Nếu domain cần guard/strategy riêng (vd. `auth` với `jwt.strategy.ts`), đặt trong `modules/auth/strategies/`, không đẩy lên `common/` trừ khi module khác cũng dùng.

## Quy trình khi sửa thiết kế lại (redesign) hoặc refactor

1. Giữ nguyên vị trí file trong cây thư mục — refactor là sửa nội dung logic/API contract, không phải sắp xếp lại thư mục.
2. Nếu 1 service/controller quá lớn cần tách, file tách ra vẫn nằm trong **cùng module**, không tạo module mới trừ khi đó thực sự là 1 domain khác.
3. Không đổi tên file/thư mục/route hàng loạt trừ khi được yêu cầu rõ ràng — thay đổi route ảnh hưởng trực tiếp tới FE (`storage-api.service.ts` bên `storage`), phải giữ tên khớp giữa 2 phía.
4. Sau khi sửa, chạy build/test (`npm run build`, `npm run test`) để đảm bảo không phá cấu trúc.

## Tự kiểm tra trước khi báo hoàn thành

- [ ] Mọi file mới đều nằm đúng nhánh theo bảng trên và theo `tree.md`.
- [ ] Không có thư mục cấp 1 mới trong `src/` ngoài 5 thư mục chuẩn.
- [ ] Không có thư mục con rỗng được tạo "phòng khi cần".
- [ ] Mỗi domain mới đều có `*.spec.ts` đi kèm.
- [ ] Route/DTO đổi tên đã được đối chiếu với phía `storage` (FE) nếu có ảnh hưởng.
- [ ] Build/test chạy thành công.
