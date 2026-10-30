import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
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
  private snackBar = inject(MatSnackBar);

  selectedEmployeeUid = signal<string>('');
  selectedDate = signal<string>(getISTDateString());
  isLoadingRecord = signal(false);
  isSaving = signal(false);

  currentRecord = signal<AttendanceRecord | null>(null);

  // All Users
  users$ = collectionData(collection(this.firestore, 'users'), { idField: 'uid' }) as Observable<UserProfile[]>;
  users = toSignal(this.users$, { initialValue: [] });

  correctionForm = this.fb.group({
    checkInTime: ['10:10', Validators.required],
    checkOutTime: ['19:30', Validators.required],
    status: ['present' as AttendanceStatus, Validators.required],
    note: ['', [Validators.required, Validators.minLength(4)]]
  });

  async fetchRecord() {
    const uid = this.selectedEmployeeUid();
    const date = this.selectedDate();
    if (!uid || !date) {
      this.snackBar.open('Please select an employee and date first.', 'Close', { duration: 3000 });
      return;
    }

    this.isLoadingRecord.set(true);
    try {
      const docRef = doc(this.firestore, `attendance/${uid}_${date}`);
      docData(docRef).subscribe(data => {
        if (data) {
          const r = data as AttendanceRecord;
          this.currentRecord.set(r);
          // Extract time portion HH:mm
          const inTime = r.checkIn ? new Date(r.checkIn).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '10:10';
          const outTime = r.checkOut ? new Date(r.checkOut).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '19:30';
          this.correctionForm.patchValue({
            checkInTime: inTime,
            checkOutTime: outTime,
            status: r.status,
            note: r.note || ''
          });
        } else {
          this.currentRecord.set(null);
          this.correctionForm.patchValue({
            checkInTime: '10:10',
            checkOutTime: '19:30',
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
    if (!uid || !date || this.correctionForm.invalid || this.isSaving()) return;

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
