import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Firestore, collection, collectionData, query, where, doc, docData } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthService } from '../../../core/auth.service';
import { SettingsService } from '../../../core/settings.service';
import { AttendanceRecord, RegularizationRequest, Holiday, AttendanceStatus } from '../../../core/models';
import { getISTDateString, formatTime12h, formatDuration } from '../../../core/date-utils';
import { StatusChipComponent } from '../../../shared/status-chip/status-chip.component';
import { switchMap, of, map } from 'rxjs';

interface DayGridItem {
  dayNumber: number;
  dateStr: string;
  isCurrentMonth: boolean;
  isWeekend: boolean;
  isHoliday: boolean;
  holidayName?: string;
  isFuture: boolean;
  attendance?: AttendanceRecord;
  status: AttendanceStatus | 'holiday' | 'weekend' | 'future' | 'not_marked';
}

@Component({
  selector: 'app-my-attendance',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatInputModule,
    MatTooltipModule,
    StatusChipComponent,
  ],
  templateUrl: './my-attendance.html',
  styleUrls: ['./my-attendance.css']
})
export class MyAttendanceComponent {
  private fb = inject(FormBuilder);
  private firestore = inject(Firestore);
  private functions = inject(Functions);
  public auth = inject(AuthService);
  private settingsService = inject(SettingsService);
  private snackBar = inject(MatSnackBar);

  todayDateStr = getISTDateString();
  selectedYear = signal(new Date().getFullYear());
  selectedMonth = signal(new Date().getMonth() + 1); // 1-12

  selectedDay = signal<DayGridItem | null>(null);
  showRegularizationModal = signal(false);
  isSubmittingReg = signal(false);

  years = [2025, 2026, 2027];
  months = [
    { value: 1, name: 'January' },
    { value: 2, name: 'February' },
    { value: 3, name: 'March' },
    { value: 4, name: 'April' },
    { value: 5, name: 'May' },
    { value: 6, name: 'June' },
    { value: 7, name: 'July' },
    { value: 8, name: 'August' },
    { value: 9, name: 'September' },
    { value: 10, name: 'October' },
    { value: 11, name: 'November' },
    { value: 12, name: 'December' },
  ];

  // Holidays & Settings
  settings$ = this.settingsService.getSettings();
  settings = toSignal(this.settings$, { initialValue: null });

  holidays$ = this.settingsService.getHolidays();
  holidays = toSignal(this.holidays$, { initialValue: [] });
  holidaysMap = computed(() => new Map(this.holidays().map(h => [h.date, h.name])));

  // Monthly Attendance
  monthPrefix = computed(() => {
    const m = String(this.selectedMonth()).padStart(2, '0');
    return `${this.selectedYear()}-${m}`;
  });

  monthlyRecords$ = this.auth.userProfile$.pipe(
    switchMap(profile => {
      if (!profile) return of([]);
      const colRef = collection(this.firestore, 'attendance');
      const q = query(
        colRef,
        where('uid', '==', profile.uid)
      );
      return collectionData(q, { idField: 'id' }).pipe(
        map(list => {
          const arr = list as AttendanceRecord[];
          return arr.filter(r => r.date.startsWith(this.monthPrefix()));
        })
      );
    })
  );
  monthlyRecords = toSignal(this.monthlyRecords$, { initialValue: [] });

  attendanceMap = computed(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const r of this.monthlyRecords()) {
      map.set(r.date, r);
    }
    return map;
  });

  // Regularizations
  regularizations$ = this.auth.userProfile$.pipe(
    switchMap(profile => {
      if (!profile) return of([]);
      const colRef = collection(this.firestore, 'regularizations');
      const q = query(colRef, where('uid', '==', profile.uid));
      return collectionData(q, { idField: 'id' }).pipe(
        map(list => {
          const arr = list as RegularizationRequest[];
          return arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        })
      );
    })
  );
  regularizations = toSignal(this.regularizations$, { initialValue: [] });

  // Regularization Form
  regForm = this.fb.group({
    date: ['', Validators.required],
    requestedIn: ['', Validators.required],
    requestedOut: ['', Validators.required],
    reason: ['', [Validators.required, Validators.minLength(5)]]
  }, {
    validators: (group: AbstractControl): ValidationErrors | null => {
      const inTime = group.get('requestedIn')?.value;
      const outTime = group.get('requestedOut')?.value;
      if (!inTime || !outTime) return null;
      if (inTime >= outTime) {
        group.get('requestedOut')?.setErrors({ endBeforeStart: true });
        return { timeOrder: true };
      } else {
        if (group.get('requestedOut')?.hasError('endBeforeStart')) {
          const errors = { ...group.get('requestedOut')?.errors };
          delete errors['endBeforeStart'];
          group.get('requestedOut')?.setErrors(Object.keys(errors).length ? errors : null);
        }
      }
      return null;
    }
  });

  // Calendar Heatmap Days Generation
  calendarDays = computed(() => {
    const year = this.selectedYear();
    const month = this.selectedMonth();
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDayIndex = new Date(year, month - 1, 1).getDay(); // 0 = Sun

    const items: DayGridItem[] = [];

    // Empty padding slots for days before 1st of month
    for (let i = 0; i < firstDayIndex; i++) {
      items.push({
        dayNumber: 0,
        dateStr: '',
        isCurrentMonth: false,
        isWeekend: false,
        isHoliday: false,
        isFuture: false,
        status: 'not_marked'
      });
    }

    // Days in current month
    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(year, month - 1, day);
      const dayOfWeek = dateObj.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6; // Sun or Sat

      const dayStr = String(day).padStart(2, '0');
      const dateStr = `${this.monthPrefix()}-${dayStr}`;
      const isFuture = dateStr > this.todayDateStr;

      const isHoliday = this.holidaysMap().has(dateStr);
      const holidayName = this.holidaysMap().get(dateStr);

      const att = this.attendanceMap().get(dateStr);

      let status: DayGridItem['status'] = 'not_marked';
      if (isFuture) {
        status = 'future';
      } else if (isHoliday) {
        status = 'holiday';
      } else if (isWeekend) {
        status = 'weekend';
      } else if (att) {
        status = att.status;
      } else {
        status = 'absent';
      }

      items.push({
        dayNumber: day,
        dateStr,
        isCurrentMonth: true,
        isWeekend,
        isHoliday,
        holidayName,
        isFuture,
        attendance: att,
        status
      });
    }

    return items;
  });

  // Summary Metrics
  summaryMetrics = computed(() => {
    let presentCount = 0;
    let lateCount = 0;
    let halfDayCount = 0;
    let absentCount = 0;
    let leaveCount = 0;
    let totalWorkedMinutes = 0;

    for (const day of this.calendarDays()) {
      if (!day.isCurrentMonth || day.isFuture) continue;

      if (day.status === 'present') presentCount++;
      else if (day.status === 'late') {
        lateCount++;
        presentCount++;
      } else if (day.status === 'half-day') halfDayCount++;
      else if (day.status === 'absent' && !day.isWeekend && !day.isHoliday) absentCount++;
      else if (day.status === 'leave') leaveCount++;

      if (day.attendance?.workedMinutes) {
        totalWorkedMinutes += day.attendance.workedMinutes;
      }
    }

    return {
      present: presentCount,
      late: lateCount,
      halfDay: halfDayCount,
      absent: absentCount,
      leave: leaveCount,
      totalHours: (totalWorkedMinutes / 60).toFixed(1)
    };
  });

  getDayTileBg(day: DayGridItem): string {
    if (!day.isCurrentMonth) return 'invisible';
    if (day.isFuture) return 'bg-slate-50 text-slate-300 border-slate-100 cursor-default';
    if (day.isHoliday) return 'bg-purple-100 text-purple-800 border-purple-200';
    if (day.isWeekend) return 'bg-slate-100 text-slate-400 border-slate-200';

    switch (day.status) {
      case 'present':
        return 'bg-emerald-500 text-white border-emerald-600 shadow-sm';
      case 'late':
        return 'bg-amber-400 text-amber-950 border-amber-500 shadow-sm';
      case 'half-day':
        return 'bg-orange-400 text-white border-orange-500 shadow-sm';
      case 'leave':
        return 'bg-blue-500 text-white border-blue-600 shadow-sm';
      case 'absent':
        return 'bg-rose-500 text-white border-rose-600 shadow-sm';
      default:
        return 'bg-slate-100 text-slate-500 border-slate-200';
    }
  }

  selectDay(day: DayGridItem) {
    if (!day.isCurrentMonth || day.isFuture) return;
    this.selectedDay.set(day);
  }

  closeDetails() {
    this.selectedDay.set(null);
  }

  formatTime(iso?: string): string {
    return formatTime12h(iso);
  }

  formatMins(m?: number): string {
    return formatDuration(m || 0);
  }

  openRegularizationModal(defaultDate?: string) {
    const inTime = this.settings()?.officeStart || '';
    const outTime = this.settings()?.officeEnd || '';
    if (defaultDate) {
      this.regForm.patchValue({ date: defaultDate, requestedIn: inTime, requestedOut: outTime });
    } else {
      this.regForm.patchValue({ requestedIn: inTime, requestedOut: outTime });
    }
    this.showRegularizationModal.set(true);
  }

  closeRegularizationModal() {
    this.showRegularizationModal.set(false);
  }

  async submitRegularization() {
    if (this.regForm.invalid || this.isSubmittingReg()) {
      if (this.regForm.get('requestedOut')?.hasError('endBeforeStart')) {
        this.snackBar.open('Check-out time must be after check-in time.', 'Close', { duration: 3500 });
      }
      return;
    }

    this.isSubmittingReg.set(true);
    try {
      const regFn = httpsCallable(this.functions, 'requestRegularization');
      await regFn(this.regForm.value);
      this.snackBar.open('Regularization request submitted to manager for review!', 'Close', {
        duration: 4000
      });
      this.showRegularizationModal.set(false);
      const inTime = this.settings()?.officeStart || '';
      const outTime = this.settings()?.officeEnd || '';
      this.regForm.reset({ requestedIn: inTime, requestedOut: outTime });
    } catch (e: any) {
      this.snackBar.open(e.message || 'Error submitting regularization', 'Close', { duration: 4000 });
    } finally {
      this.isSubmittingReg.set(false);
    }
  }
}
