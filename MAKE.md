# Chạy dự án bằng Make

Dự án gồm 2 phần: `storage` (Frontend - Angular) và `storage-api` (Backend - NestJS), được quản lý chung qua [`Makefile`](Makefile) ở thư mục gốc.

## Các lệnh

| Lệnh | Ý nghĩa |
|---|---|
| `make install` | cài `npm install` cho cả `storage` (FE) và `storage-api` (BE) |
| `make fe` | chạy riêng FE (`ng serve`, port 4200) |
| `make be` | chạy riêng BE (`nest start --watch`, port 3000) |
| `make dev` | chạy **song song** cả FE và BE (dùng `make -j2`) |
| `make build` | build production cả 2 |
| `make test` | chạy test cả 2 |
| `make lint` | lint cả 2 |
| `make clean` | xoá `node_modules` + build output của cả 2 |

Chạy `make help` để xem lại danh sách này trong terminal.

## Bắt đầu nhanh

```bash
make install   # chỉ cần chạy 1 lần, hoặc khi package.json thay đổi
make dev       # chạy cả FE + BE cùng lúc
```

- FE: http://localhost:4200
- BE: http://localhost:3000

Nếu chỉ cần chạy 1 phía, dùng `make fe` hoặc `make be` riêng.
