import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { BreadcrumbCrumb } from '../models/file.model';

export interface TrashItem {
  kind: 'file' | 'folder';
  id: string;
  name: string;
  extension: string | null;
  size: string | null;
  isStarred: boolean;
  deletedAt: string;
  daysUntilPurge: number;
  folderPath: BreadcrumbCrumb[];
}

@Injectable({ providedIn: 'root' })
export class TrashApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/trash`;

  list(): Observable<TrashItem[]> {
    return this.http.get<TrashItem[]>(this.base);
  }

  empty(): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.base}/empty`, {});
  }
}
