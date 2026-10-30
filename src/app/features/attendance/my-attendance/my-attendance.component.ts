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
import { AttendanceRecord, RegularizationRequest, Holiday, AttendanceStatus, LeaveRequest } from '../../../core/models';
import { getISTDateString, formatTime12h, formatDuration } from '../../../core/date-utils';
import { StatusChipComponent } from '../../../shared/status-chip/status-chip.component';
import { switchMap, of, map, Observable } from 'rxjs';

export interface DayGridItem {
  dayNumber: number;
  dateStr: string;
  isCurrentMonth: boolean;
  isWeekend: boolean;
  isHoliday: boolean;
  holidayName?: string;
  isFuture: boolean;
  isToday: boolean;
  attendance?: AttendanceRecord;
  leaveRequest?: LeaveRequest;
  status: AttendanceStatus | 'holiday' | 'weekend' | 'future' | 'not_marked';
  checkInFormatted?: string;
  checkOutFormatted?: string;
  workedFormatted?: string;
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
  activeLegendFilter = signal<string | null>(null);

  years = [2024, 2025, 2026, 2027, 2028];
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

  currentMonthName = computed(() => {
    const m = this.months.find(x => x.value === this.selectedMonth());
    return m ? m.name : '';
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

  // Approved Leaves for Employee
  myApprovedLeaves$ = this.auth.userProfile$.pipe(
    switchMap(profile => {
      if (!profile) return of([]);
      const q = query(
        collection(this.firestore, 'leaveRequests'),
        where('uid', '==', profile.uid),
        where('status', '==', 'approved')
      );
      return collectionData(q, { idField: 'id' }) as Observable<LeaveRequest[]>;
    })
  );
  myApprovedLeaves = toSignal(this.myApprovedLeaves$, { initialValue: [] });

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
        isToday: false,
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
      const isToday = dateStr === this.todayDateStr;
      const isFuture = dateStr > this.todayDateStr;

      const isHoliday = this.holidaysMap().has(dateStr);
      const holidayName = this.holidaysMap().get(dateStr);

      const att = this.attendanceMap().get(dateStr);
      const activeLeave = this.myApprovedLeaves().find(l => l.startDate <= dateStr && l.endDate >= dateStr);

      let status: DayGridItem['status'] = 'not_marked';
      if (isFuture) {
        status = 'future';
      } else if (isHoliday) {
        status = 'holiday';
      } else if (activeLeave) {
        status = 'leave';
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
        isToday,
        attendance: att,
        leaveRequest: activeLeave,
        status,
        checkInFormatted: att?.checkIn ? formatTime12h(att.checkIn) : undefined,
        checkOutFormatted: att?.checkOut ? formatTime12h(att.checkOut) : undefined,
        workedFormatted: att?.workedMinutes ? formatDuration(att.workedMinutes) : undefined
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
    let holidayCount = 0;
    let weekendCount = 0;
    let totalWorkedMinutes = 0;

    for (const day of this.calendarDays()) {
      if (!day.isCurrentMonth) continue;

      if (day.isHoliday) holidayCount++;
      else if (day.isWeekend) weekendCount++;

      if (day.isFuture) continue;

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

    const totalHoursNum = totalWorkedMinutes / 60;
    const avgHours = presentCount > 0 ? (totalHoursNum / presentCount).toFixed(1) : '0.0';

    return {
      present: presentCount,
      late: lateCount,
      halfDay: halfDayCount,
      absent: absentCount,
      leave: leaveCount,
      holidays: holidayCount,
      weekends: weekendCount,
      totalHours: totalHoursNum.toFixed(1),
      avgHoursPerDay: `${avgHours}h`
    };
  });

  prevMonth() {
    if (this.selectedMonth() === 1) {
      this.selectedMonth.set(12);
      this.selectedYear.update(y => y - 1);
    } else {
      this.selectedMonth.update(m => m - 1);
    }
  }

  nextMonth() {
    if (this.selectedMonth() === 12) {
      this.selectedMonth.set(1);
      this.selectedYear.update(y => y + 1);
    } else {
      this.selectedMonth.update(m => m + 1);
    }
  }

  goToToday() {
    const d = new Date();
    this.selectedYear.set(d.getFullYear());
    this.selectedMonth.set(d.getMonth() + 1);
    const todayItem = this.calendarDays().find(x => x.dateStr === this.todayDateStr);
    if (todayItem) {
      this.selectDay(todayItem);
    }
  }

  toggleLegendFilter(status: string) {
    if (this.activeLegendFilter() === status) {
      this.activeLegendFilter.set(null);
    } else {
      this.activeLegendFilter.set(status);
    }
  }

  selectDay(day: DayGridItem) {
    if (!day.isCurrentMonth || day.isFuture) return;
    this.selectedDay.set(day);
  }

  closeDetails() {
    this.selectedDay.set(null);
  }

  formatTime(iso?: string | null): string {
    return formatTime12h(iso || undefined);
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
