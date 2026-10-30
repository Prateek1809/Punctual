import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Firestore, collection, collectionData, doc, docData } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { toSignal } from '@angular/core/rxjs-interop';
import { UserProfile, AttendanceRecord, AttendanceStatus } from '../../../core/models';
import { SettingsService } from '../../../core/settings.service';
import { getISTDateString, formatTime12h, formatDuration } from '../../../core/date-utils';
import { StatusChipComponent } from '../../../shared/status-chip/status-chip.component';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-corrections',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    StatusChipComponent
  ],
  templateUrl: './corrections.html'
})
export class CorrectionsComponent {
  private fb = inject(FormBuilder);
  private firestore = inject(Firestore);
  private functions = inject(Functions);
  private settingsService = inject(SettingsService);
  private snackBar = inject(MatSnackBar);

  selectedEmployeeUid = signal<string>('');
  selectedDate = signal<string>(getISTDateString());
  isLoadingRecord = signal(false);
  isSaving = signal(false);

  currentRecord = signal<AttendanceRecord | null>(null);

  // All Users
  users$ = collectionData(collection(this.firestore, 'users'), { idField: 'uid' }) as Observable<UserProfile[]>;
  users = toSignal(this.users$, { initialValue: [] });

  settings$ = this.settingsService.getSettings();
  settings = toSignal(this.settings$, { initialValue: null });

  correctionForm = this.fb.group({
    checkInTime: ['', Validators.required],
    checkOutTime: ['', Validators.required],
    status: ['present' as AttendanceStatus, Validators.required],
    note: ['', [Validators.required, Validators.minLength(4)]]
  }, {
    validators: (group: AbstractControl): ValidationErrors | null => {
      const inTime = group.get('checkInTime')?.value;
      const outTime = group.get('checkOutTime')?.value;
      if (!inTime || !outTime) return null;
      if (inTime >= outTime) {
        group.get('checkOutTime')?.setErrors({ endBeforeStart: true });
        return { timeOrder: true };
      } else {
        if (group.get('checkOutTime')?.hasError('endBeforeStart')) {
          const errors = { ...group.get('checkOutTime')?.errors };
          delete errors['endBeforeStart'];
          group.get('checkOutTime')?.setErrors(Object.keys(errors).length ? errors : null);
        }
      }
      return null;
    }
  });

  async fetchRecord() {
    const uid = this.selectedEmployeeUid();
    const date = this.selectedDate();
    if (!uid || !date) {
      this.snackBar.open('Please select an employee and date first.', 'Close', { duration: 3000 });
      return;
    }

    const defaultIn = this.settings()?.officeStart || '';
    const defaultOut = this.settings()?.officeEnd || '';

    this.isLoadingRecord.set(true);
    try {
      const docRef = doc(this.firestore, `attendance/${uid}_${date}`);
      docData(docRef).subscribe(data => {
        if (data) {
          const r = data as AttendanceRecord;
          this.currentRecord.set(r);
          // Extract time portion HH:mm
          const inTime = r.checkIn ? new Date(r.checkIn).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : defaultIn;
          const outTime = r.checkOut ? new Date(r.checkOut).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : defaultOut;
          this.correctionForm.patchValue({
            checkInTime: inTime,
            checkOutTime: outTime,
            status: r.status,
            note: r.note || ''
          });
        } else {
          this.currentRecord.set(null);
          this.correctionForm.patchValue({
            checkInTime: defaultIn,
            checkOutTime: defaultOut,
            status: 'present',
            note: ''
          });
        }
        this.isLoadingRecord.set(false);
      });
    } catch {
      this.isLoadingRecord.set(false);
    }
  }

  async saveCorrection() {
    const uid = this.selectedEmployeeUid();
    const date = this.selectedDate();
    if (!uid || !date || this.correctionForm.invalid || this.isSaving()) {
      if (this.correctionForm.get('checkOutTime')?.hasError('endBeforeStart')) {
        this.snackBar.open('Check-out time must be after check-in time.', 'Close', { duration: 3500 });
      }
      return;
    }

    this.isSaving.set(true);
    try {
      const val = this.correctionForm.value;
      const checkInISO = new Date(`${date}T${val.checkInTime}:00+05:30`).toISOString();
      const checkOutISO = new Date(`${date}T${val.checkOutTime}:00+05:30`).toISOString();

      const correctFn = httpsCallable(this.functions, 'adminCorrectAttendance');
      await correctFn({
        attendanceId: `${uid}_${date}`,
        checkIn: checkInISO,
        checkOut: checkOutISO,
        status: val.status,
        note: val.note
      });

      this.snackBar.open('Attendance record adjusted and audit logged!', 'Close', { duration: 4000 });
    } catch (e: any) {
      this.snackBar.open(e.message || 'Error saving correction', 'Close', { duration: 4000 });
    } finally {
      this.isSaving.set(false);
    }
  }

  formatTime(iso?: string): string {
    return formatTime12h(iso);
  }

  formatMins(m?: number): string {
    return formatDuration(m || 0);
  }
}
