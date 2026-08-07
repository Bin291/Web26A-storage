import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

interface NavItem {
  icon: string;
  label: string;
}

interface CategoryItem {
  icon: string;
  label: string;
  count: number;
}

@Component({
  selector: 'app-main-layout',
  imports: [RouterOutlet, UpperCasePipe, MatIconModule, MatButtonModule],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MainLayout {
  protected readonly userName = signal('binh\'\'\'');

  protected readonly browseItems: NavItem[] = [
    { icon: 'cloud', label: 'My Storage' },
    { icon: 'star_border', label: 'Có gắn dấu sao' },
    { icon: 'schedule', label: 'Gần đây' },
    { icon: 'group', label: 'Được chia sẻ với tôi' },
    { icon: 'delete_outline', label: 'Thùng rác' },
  ];

  protected readonly categoryItems: CategoryItem[] = [
    { icon: 'description', label: 'Tài liệu', count: 0 },
    { icon: 'image', label: 'Ảnh', count: 0 },
    { icon: 'movie', label: 'Video', count: 0 },
    { icon: 'music_note', label: 'Âm thanh', count: 0 },
    { icon: 'code', label: 'Code', count: 0 },
    { icon: 'folder_zip', label: 'Nén', count: 0 },
    { icon: 'attachment', label: 'Khác', count: 0 },
  ];
}
