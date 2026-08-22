import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { EmailOtpForm } from '../email-otp-form/email-otp-form';

@Component({
  selector: 'app-register',
  imports: [RouterLink, TranslatePipe, EmailOtpForm],
  templateUrl: './register.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Register {}
