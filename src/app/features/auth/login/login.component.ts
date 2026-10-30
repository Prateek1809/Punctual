import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AuthService } from '../../../core/auth.service';
import { Router } from '@angular/router';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatSnackBarModule,
  ],
  templateUrl: './login.html',
  styleUrls: ['./login.css'],
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);

  isLoading = signal(false);
  hidePassword = signal(true);
  showForgotModal = signal(false);
  forgotEmail = signal('');
  isResetting = signal(false);

  loginForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  async onSubmit() {
    if (this.loginForm.invalid || this.isLoading()) return;

    this.isLoading.set(true);
    try {
      const { email, password } = this.loginForm.value;
      await this.authService.login(email!.trim(), password!);
      this.snackBar.open('Signed in successfully!', 'Dismiss', { duration: 2500 });
      this.router.navigate(['/dashboard']);
    } catch (error: any) {
      let msg = error.message;
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
        msg = 'Invalid email or password. Please check your credentials.';
      } else if (error.code === 'auth/user-not-found') {
        msg = 'No user account found with this email.';
      }
      this.snackBar.open(msg, 'Close', { duration: 4000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  openForgotPassword() {
    this.forgotEmail.set(this.loginForm.get('email')?.value || '');
    this.showForgotModal.set(true);
  }

  closeForgotPassword() {
    this.showForgotModal.set(false);
  }

  async sendResetEmail() {
    const email = this.forgotEmail().trim();
    if (!email) {
      this.snackBar.open('Please enter your email address', 'Close', { duration: 3000 });
      return;
    }

    this.isResetting.set(true);
    try {
      await this.authService.sendPasswordReset(email);
      this.snackBar.open('Password reset email sent! Check your inbox.', 'Close', { duration: 4000 });
      this.showForgotModal.set(false);
    } catch (err: any) {
      this.snackBar.open(err.message, 'Close', { duration: 4000 });
    } finally {
      this.isResetting.set(false);
    }
  }
}
