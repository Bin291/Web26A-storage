# Cấu trúc thư mục dự án Storage

Tài liệu này mô tả cấu trúc thư mục mẫu cho 2 phần của hệ thống:

1. **Frontend** — Angular (`storage`)
2. **Backend** — NestJS (`storage-api`)

---

## 1. Frontend — Angular (`storage`)

```
storage/
├── src/
│   ├── app/
│   │   ├── core/                      # Singleton services, chỉ import 1 lần ở AppModule
│   │   │   ├── guards/
│   │   │   │   └── auth.guard.ts
│   │   │   ├── interceptors/
│   │   │   │   └── http-error.interceptor.ts
│   │   │   ├── services/
│   │   │   │   ├── auth.service.ts
│   │   │   │   └── storage-api.service.ts
│   │   │   ├── models/
│   │   │   │   └── file.model.ts
│   │   │   └── store/                 # Root store (NgRx) — state dùng toàn app
│   │   │       ├── app.state.ts       # Định nghĩa AppState tổng hợp từ các feature state
│   │   │       ├── app.reducer.ts     # ActionReducerMap gộp các reducer
│   │   │       ├── app.selectors.ts   # Selector cấp app (nếu cần)
│   │   │       └── index.ts
│   │   │
│   │   ├── shared/                    # Component/pipe/directive dùng chung
│   │   │   ├── components/
│   │   │   │   ├── button/
│   │   │   │   ├── modal/
│   │   │   │   └── loading-spinner/
│   │   │   ├── pipes/
│   │   │   │   └── file-size.pipe.ts
│   │   │   ├── directives/
│   │   │   └── shared.module.ts
│   │   │
│   │   ├── features/                  # Từng tính năng chính, tách biệt module
│   │   │   ├── file-explorer/
│   │   │   │   ├── components/
│   │   │   │   │   ├── file-list/
│   │   │   │   │   └── file-upload/
│   │   │   │   ├── pages/
│   │   │   │   │   └── file-explorer-page/
│   │   │   │   ├── store/             # NgRx state riêng cho feature này
│   │   │   │   │   ├── file-explorer.actions.ts
│   │   │   │   │   ├── file-explorer.reducer.ts
│   │   │   │   │   ├── file-explorer.selectors.ts
│   │   │   │   │   ├── file-explorer.effects.ts
│   │   │   │   │   ├── file-explorer.state.ts
│   │   │   │   │   └── index.ts       # Barrel export (actions, reducer, selectors...)
│   │   │   │   ├── file-explorer-routing.module.ts
│   │   │   │   └── file-explorer.module.ts
│   │   │   │
│   │   │   ├── storage-settings/
│   │   │   │   ├── components/
│   │   │   │   ├── pages/
│   │   │   │   ├── store/
│   │   │   │   │   ├── storage-settings.actions.ts
│   │   │   │   │   ├── storage-settings.reducer.ts
│   │   │   │   │   ├── storage-settings.selectors.ts
│   │   │   │   │   ├── storage-settings.effects.ts
│   │   │   │   │   └── storage-settings.state.ts
│   │   │   │   └── storage-settings.module.ts
│   │   │   │
│   │   │   └── auth/
│   │   │       ├── login/
│   │   │       ├── register/
│   │   │       ├── store/
│   │   │       │   ├── auth.actions.ts
│   │   │       │   ├── auth.reducer.ts
│   │   │       │   ├── auth.selectors.ts
│   │   │       │   ├── auth.effects.ts
│   │   │       │   └── auth.state.ts
│   │   │       └── auth.module.ts
│   │   │
│   │   ├── layout/                    # Header, sidebar, footer chung toàn app
│   │   │   ├── main-layout/
│   │   │   └── layout.module.ts
│   │   │
│   │   ├── app-routing.module.ts
│   │   ├── app.component.ts
│   │   └── app.module.ts
│   │
│   ├── assets/
│   │   ├── images/
│   │   └── icons/
│   │
│   ├── environments/
│   │   ├── environment.ts
│   │   └── environment.prod.ts
│   │
│   ├── styles/                        # SCSS variables, mixins nếu dùng Tailwind hoặc SCSS
│   │   └── styles.scss
│   │
│   └── index.html
│
├── angular.json
├── package.json
├── tsconfig.json
└── README.md
```

### Ghi chú áp dụng

- **`core/`**: chỉ chứa thứ dùng 1 lần duy nhất (auth, interceptor, service gọi API chính) — không import lại ở feature module.
- **`shared/`**: component/pipe tái sử dụng nhiều nơi (button, modal, spinner...).
- **`features/`**: mỗi tính năng lớn (file-explorer, storage-settings, auth...) là 1 module riêng, có thể lazy-load để tối ưu tốc độ tải.
- Nếu dùng **Angular 17+ với standalone components**, có thể bỏ hẳn các file `*.module.ts` trong `features/` và import trực tiếp component vào route.

### Ghi chú riêng cho NgRx

- **`core/store/`**: chỉ chứa state dùng chung toàn app (ví dụ: user hiện tại, theme, thông báo global...). Đăng ký bằng `StoreModule.forRoot(reducers)` trong `app.module.ts`.
- **`features/<feature>/store/`**: mỗi feature quản lý state riêng, đăng ký bằng `StoreModule.forFeature('featureName', reducer)` ngay trong module của feature đó — giúp lazy-load state cùng lúc với module.
- Cấu trúc file trong mỗi `store/` theo chuẩn NgRx:
  - `*.actions.ts` — định nghĩa action bằng `createAction`
  - `*.reducer.ts` — xử lý state bằng `createReducer`
  - `*.selectors.ts` — lấy dữ liệu từ state bằng `createSelector`
  - `*.effects.ts` — xử lý side-effect (gọi API...) bằng `createEffect`
  - `*.state.ts` — định nghĩa interface cho state của feature
- Nếu dùng devtools, thêm `StoreDevtoolsModule.instrument()` trong `app.module.ts` (chỉ bật ở môi trường dev).
- Với feature nhỏ ít state (ví dụ `storage-settings`), có thể cân nhắc dùng **Component Store** (`@ngrx/component-store`) thay vì global store để tránh phức tạp hoá không cần thiết.

---

## 2. Backend — NestJS (`storage-api`)

```
storage-api/
├── src/
│   ├── main.ts                        # Entry point
│   ├── app.module.ts                  # Root module
│   │
│   ├── config/                        # Cấu hình app (env, database, jwt...)
│   │   ├── configuration.ts
│   │   ├── database.config.ts
│   │   └── validation.schema.ts       # Validate env bằng Joi/class-validator
│   │
│   ├── common/                        # Dùng chung toàn app
│   │   ├── decorators/
│   │   │   └── current-user.decorator.ts
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   └── roles.guard.ts
│   │   ├── interceptors/
│   │   │   ├── logging.interceptor.ts
│   │   │   └── transform-response.interceptor.ts
│   │   ├── pipes/
│   │   │   └── validation.pipe.ts
│   │   └── constants/
│   │       └── app.constants.ts
│   │
│   ├── database/                      # Kết nối DB, migrations, seed
│   │   ├── migrations/
│   │   ├── seeds/
│   │   └── database.module.ts
│   │
│   ├── modules/                       # Từng tính năng nghiệp vụ = 1 module
│   │   ├── auth/
│   │   │   ├── dto/
│   │   │   │   ├── login.dto.ts
│   │   │   │   └── register.dto.ts
│   │   │   ├── strategies/
│   │   │   │   ├── jwt.strategy.ts
│   │   │   │   └── local.strategy.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── auth.module.ts
│   │   │   └── auth.service.spec.ts   # Unit test đi kèm
│   │   │
│   │   ├── users/
│   │   │   ├── dto/
│   │   │   │   ├── create-user.dto.ts
│   │   │   │   └── update-user.dto.ts
│   │   │   ├── entities/
│   │   │   │   └── user.entity.ts
│   │   │   ├── users.controller.ts
│   │   │   ├── users.service.ts
│   │   │   ├── users.module.ts
│   │   │   └── users.service.spec.ts
│   │   │
│   │   ├── files/                     # Ví dụ module lưu trữ file
│   │   │   ├── dto/
│   │   │   │   └── upload-file.dto.ts
│   │   │   ├── entities/
│   │   │   │   └── file.entity.ts
│   │   │   ├── files.controller.ts
│   │   │   ├── files.service.ts
│   │   │   ├── files.module.ts
│   │   │   └── files.service.spec.ts
│   │   │
│   │   └── storage/                   # Module xử lý logic storage (S3, local disk...)
│   │       ├── providers/
│   │       │   ├── s3-storage.provider.ts
│   │       │   └── local-storage.provider.ts
│   │       ├── interfaces/
│   │       │   └── storage-provider.interface.ts
│   │       ├── storage.service.ts
│   │       └── storage.module.ts
│   │
│   └── shared/                        # Type, interface, util dùng chung
│       ├── interfaces/
│       ├── utils/
│       └── types/
│
├── test/                              # E2E tests
│   ├── app.e2e-spec.ts
│   └── jest-e2e.json
│
├── .env
├── .env.example
├── nest-cli.json
├── package.json
├── tsconfig.json
└── README.md
```

### Ghi chú áp dụng

- **`common/`**: chứa guard, filter, interceptor, decorator không gắn với 1 nghiệp vụ cụ thể (dùng ở nhiều module).
- **`modules/`**: mỗi domain nghiệp vụ (auth, users, files, storage...) đóng gói trọn vẹn: controller + service + dto + entity + module riêng, dễ maintain và test độc lập.
- **`database/`**: nếu dùng TypeORM/Prisma thì tách riêng migrations, seed data ở đây thay vì để lẫn trong module.
- File `*.spec.ts` nên đặt cạnh file gốc (unit test), còn e2e test để ở thư mục `test/` riêng.
- Nếu dùng **Prisma** thay vì TypeORM, sẽ có thêm thư mục `prisma/` ở root chứa `schema.prisma`.

---

## Ghi chú chung

- Cả 2 cấu trúc trên theo phong cách **module/feature-based**, giúp dễ mở rộng và maintain khi dự án lớn dần.
- Nếu Frontend và Backend giao tiếp với nhau qua REST API, tên các route/service ở `storage-api.service.ts` (Angular) nên khớp với controller ở `files.controller.ts` / `storage` module (NestJS) để dễ đối chiếu.