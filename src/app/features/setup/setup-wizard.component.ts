import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/auth.service';
import { LocationService } from '../../core/location.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-setup-wizard',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatCheckboxModule,
    MatSnackBarModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './setup-wizard.html'
})
export class SetupWizardComponent {
  private fb = inject(FormBuilder);
  private functions = inject(Functions);
  private authService = inject(AuthService);
  private locationService = inject(LocationService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);

  currentStep = signal(1); // 1, 2, 3, 4
  isSubmitting = signal(false);
  isLoadingLocation = signal(false);

  setupForm = this.fb.group({
    // Step 1: Admin account
    adminName: ['', [Validators.required, Validators.minLength(2)]],
    adminEmail: ['', [Validators.required, Validators.email]],
    adminPassword: ['', [Validators.required, Validators.minLength(6)]],

    // Step 2: Office & Geofence
    officeName: ['', Validators.required],
    officeLat: [null as number | null, Validators.required],
    officeLng: [null as number | null, Validators.required],
    radiusM: [200, [Validators.required, Validators.min(10)]],

    // Step 3: Timings
    officeStart: ['', Validators.required],
    officeEnd: ['', Validators.required],
    graceMinutes: [10, [Validators.required, Validators.min(0)]]
  }, {
    validators: (group: AbstractControl): ValidationErrors | null => {
      const s = group.get('officeStart')?.value;
      const e = group.get('officeEnd')?.value;
      if (!s || !e) return null;
      if (s >= e) {
        group.get('officeEnd')?.setErrors({ endBeforeStart: true });
        return { timeOrder: true };
      } else {
        if (group.get('officeEnd')?.hasError('endBeforeStart')) {
          const errors = { ...group.get('officeEnd')?.errors };
          delete errors['endBeforeStart'];
          group.get('officeEnd')?.setErrors(Object.keys(errors).length ? errors : null);
        }
      }
      return null;
    }
  });

  nextStep() {
    if (this.currentStep() === 1) {
      const name = this.setupForm.get('adminName');
      const email = this.setupForm.get('adminEmail');
      const pass = this.setupForm.get('adminPassword');
      if (name?.invalid || email?.invalid || pass?.invalid) {
        name?.markAsTouched();
        email?.markAsTouched();
        pass?.markAsTouched();
        return;
      }
    } else if (this.currentStep() === 2) {
      const oName = this.setupForm.get('officeName');
      const lat = this.setupForm.get('officeLat');
      const lng = this.setupForm.get('officeLng');
      const rad = this.setupForm.get('radiusM');
      if (oName?.invalid || lat?.invalid || lng?.invalid || rad?.invalid) {
        oName?.markAsTouched();
        lat?.markAsTouched();
        lng?.markAsTouched();
        rad?.markAsTouched();
        return;
      }
    } else if (this.currentStep() === 3) {
      const oStart = this.setupForm.get('officeStart');
      const oEnd = this.setupForm.get('officeEnd');
      const grace = this.setupForm.get('graceMinutes');
      if (oStart?.invalid || oEnd?.invalid || grace?.invalid || (oStart?.value && oEnd?.value && oStart.value >= oEnd.value)) {
        oStart?.markAsTouched();
        oEnd?.markAsTouched();
        grace?.markAsTouched();
        if (oStart?.value && oEnd?.value && oStart.value >= oEnd.value) {
          this.snackBar.open('Office end time must be after start time.', 'Close', { duration: 3500 });
        }
        return;
      }
    }

    this.currentStep.update(s => Math.min(4, s + 1));
  }

  prevStep() {
    this.currentStep.update(s => Math.max(1, s - 1));
  }

  async useCurrentLocation() {
    this.isLoadingLocation.set(true);
    try {
      const pos = await this.locationService.getPosition();
      if (!pos) throw new Error('Could not access current location. Please allow browser location access.');

      this.setupForm.patchValue({
        officeLat: Number(pos.lat.toFixed(6)),
        officeLng: Number(pos.lng.toFixed(6))
      });

      this.snackBar.open(`Captured coordinates: ${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`, 'Close', {
        duration: 3000
      });
    } catch (e: any) {
      this.snackBar.open(e.message || 'Error getting location', 'Close', { duration: 4000 });
    } finally {
      this.isLoadingLocation.set(false);
    }
  }

  async completeSetup() {
    if (this.setupForm.invalid || this.isSubmitting()) return;

    this.isSubmitting.set(true);
    const val = this.setupForm.value;

    try {
      const setupFn = httpsCallable(this.functions, 'setupInitialAdmin');
      await setupFn({
        adminName: val.adminName,
        adminEmail: val.adminEmail,
        adminPassword: val.adminPassword,
        officeName: val.officeName,
        officeLat: Number(val.officeLat),
        officeLng: Number(val.officeLng),
        radiusM: Number(val.radiusM),
        officeStart: val.officeStart,
        officeEnd: val.officeEnd,
        graceMinutes: Number(val.graceMinutes)
      });

      this.snackBar.open('Initial setup complete! Logging in as Administrator...', '', { duration: 2500 });

      // Automatically sign in the new Admin
      await this.authService.login(val.adminEmail!.trim(), val.adminPassword!);

      this.snackBar.open('Welcome, Admin! Now you can add managers and employees.', 'Close', {
        duration: 5000
      });

      // Redirect directly to employee management to add managers
      this.router.navigate(['/admin/employees']);
    } catch (error: any) {
      this.snackBar.open(error.message || 'Setup initialization failed', 'Close', { duration: 5000 });
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
