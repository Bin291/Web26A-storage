import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Folder, StoredFile } from '../models/file.model';

export interface SharedItem {
  shareId: string;
  kind: 'file' | 'folder';
  sharedByEmail: string | null;
  allowDownload: boolean;
  file?: StoredFile;
  folder?: Folder;
}

@Injectable({ providedIn: 'root' })
export class SharedApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/shared`;

  list(): Observable<SharedItem[]> {
    return this.http.get<SharedItem[]>(this.base);
  }

  contentUrl(fileId: string): Observable<{ url: string }> {
    return this.http.get<{ url: string }>(`${this.base}/file/${fileId}/content`);
  }

  downloadUrl(fileId: string): Observable<{ url: string }> {
    return this.http.get<{ url: string }>(`${this.base}/file/${fileId}/download`);
  }
}
