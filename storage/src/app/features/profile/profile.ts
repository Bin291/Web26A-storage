import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'app-profile',
  imports: [TranslatePipe],
  template: `
    <h1 class="page-title">{{ 'profile.title' | t }}</h1>
    @if (profile(); as p) {
      <div class="profile-card">
        <div class="avatar">
          @if (p.avatarUrl) {
            <img [src]="p.avatarUrl" [alt]="p.displayName || 'avatar'" />
          } @else {
            <span class="mi" style="font-size: 48px">account_circle</span>
          }
        </div>
        <div>
          <div class="profile-name">{{ p.displayName }}</div>
          <div class="profile-email">{{ p.email }}</div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .profile-card {
        display: flex;
        align-items: center;
        gap: 18px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 22px;
        max-width: 440px;
      }
      .avatar {
        width: 72px;
        height: 72px;
        border-radius: 0;
        overflow: hidden;
        display: grid;
        place-items: center;
        background: var(--surface-2);
      }
      .avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .profile-name {
        font-size: 18px;
        font-weight: 600;
      }
      .profile-email {
        color: var(--text-muted);
        font-size: 14px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Profile {
  private readonly auth = inject(AuthService);
  protected readonly profile = this.auth.profile;
}
