import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { SupabaseService } from '../services/supabase.service';

/**
 * Đính JWT Supabase vào mọi request tới storage-api. Lấy token tươi từ Supabase
 * (tự refresh) thay vì cache — tránh gửi token hết hạn.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl)) {
    return next(req);
  }
  const supabase = inject(SupabaseService);
  return from(supabase.getSession()).pipe(
    switchMap(({ data }) => {
      const token = data.session?.access_token;
      const authReq = token
        ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
        : req;
      return next(authReq);
    }),
  );
};
