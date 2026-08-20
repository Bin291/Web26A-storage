import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

@Component({
  selector: 'app-login',
  imports: [RouterLink, TranslatePipe],
  templateUrl: './login.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly email = signal('');
  readonly password = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.loading()) return;
    this.error.set(null);
    this.loading.set(true);
    try {
      await this.auth.signIn(this.email().trim(), this.password());
      const redirect = new URLSearchParams(location.search).get('redirect') || '/files';
      await this.router.navigateByUrl(redirect);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'auth.loginFailed');
    } finally {
      this.loading.set(false);
    }
  }

  async loginWithGoogle(): Promise<void> {
    if (this.loading()) return;
    this.error.set(null);
    this.loading.set(true);
    try {
      const redirect = new URLSearchParams(location.search).get('redirect') || '/files';
      await this.auth.signInWithGoogle(redirect);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'auth.loginFailed');
      this.loading.set(false);
    }
  }
}
