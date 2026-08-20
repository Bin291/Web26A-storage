import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

@Component({
  selector: 'app-register',
  imports: [RouterLink, TranslatePipe],
  templateUrl: './register.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Register {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly email = signal('');
  readonly password = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly info = signal<string | null>(null);

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.loading()) return;
    this.error.set(null);
    this.info.set(null);
    this.loading.set(true);
    try {
      const { needsConfirmation } = await this.auth.signUp(this.email().trim(), this.password());
      if (needsConfirmation) {
        this.info.set('auth.confirmEmail');
      } else {
        await this.router.navigateByUrl('/files');
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'auth.loginFailed');
    } finally {
      this.loading.set(false);
    }
  }
}
