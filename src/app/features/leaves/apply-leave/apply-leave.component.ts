import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule, MatCalendarCellClassFunction } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Firestore, collection, addDoc, collectionData, query, where, orderBy, doc, docData } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthService } from '../../../core/auth.service';
import { SettingsService } from '../../../core/settings.service';
import { LeaveRequest, LeaveBalance, UserProfile } from '../../../core/models';
import { getISTDateString, calculateWorkingDays, getDatesInRange, formatTime12h } from '../../../core/date-utils';
import { StatusChipComponent } from '../../../shared/status-chip/status-chip.component';
import { ConfirmDialogService } from '../../../shared/confirm-dialog/confirm-dialog.component';
import { switchMap, of, map, catchError } from 'rxjs';

@Component({
  selector: 'app-apply-leave',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatCheckboxModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatTableModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    StatusChipComponent
  ],
  templateUrl: './apply-leave.html',
  styleUrls: ['./apply-leave.css']
})
export class ApplyLeaveComponent {
  private fb = inject(FormBuilder);
  private firestore = inject(Firestore);
  private functions = inject(Functions);
  public auth = inject(AuthService);
  private settingsService = inject(SettingsService);
  private snackBar = inject(MatSnackBar);
  private confirmService = inject(ConfirmDialogService);

  selectedTab = signal(0);
  isSubmitting = signal(false);
  cancellingId = signal<string | null>(null);

  todayDateStr = getISTDateString();
  currentYear = this.todayDateStr.split('-')[0];

  // Current Date object with zeroed time for datepicker [min] restrictions
  todayDate = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  // 1. Settings & Holidays for Day Calculation
  settings$ = this.settingsService.getSettings().pipe(catchError(() => of(null)));
  settings = toSignal(this.settings$, { initialValue: null });

  holidays$ = this.settingsService.getHolidays().pipe(catchError(() => of([])));
  holidays = toSignal(this.holidays$, { initialValue: [] });

  holidayDates = computed(() => this.holidays().map(h => h.date));
  weeklyOffs = computed(() => this.settings()?.weeklyOffs || [0, 6]);


  // 2. User Leave Balance (Gracefully fallback if not allocated yet)
  leaveBalance$ = this.auth.userProfile$.pipe(
    switchMap(profile => {
      if (!profile) return of(null);
      const balRef = doc(this.firestore, `leaveBalances/${profile.uid}_${this.currentYear}`);
      return docData(balRef).pipe(
        map(data => (data ? (data as LeaveBalance) : null)),
        catchError(() => of(null))
      );
    }),
    catchError(() => of(null))
  );
  leaveBalance = toSignal(this.leaveBalance$, { initialValue: null });

  remainingDays = computed(() => {
    const bal = this.leaveBalance();
    if (bal && bal.balances?.unified) {
      return Number((bal.balances.unified.allotted - bal.balances.unified.used).toFixed(1));
    }
    const quota = this.settings()?.monthlyQuota ?? 1.5;
    const currentMonth = new Date().getMonth() + 1;
    return Number((quota * currentMonth).toFixed(1));
  });

  isNegativeBalance = computed(() => this.remainingDays() < 0);


  // 3. User's Own Leaves History
  myLeaves$ = this.auth.userProfile$.pipe(
    switchMap(profile => {
      if (!profile) return of([]);
      const colRef = collection(this.firestore, 'leaveRequests');
      const q = query(
        colRef,
        where('uid', '==', profile.uid)
      );
      return collectionData(q, { idField: 'id' }).pipe(
        map(list => {
          const arr = list as LeaveRequest[];
          return arr.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        }),
        catchError(() => of([]))
      );
    }),
    catchError(() => of([]))
  );
  myLeaves = toSignal(this.myLeaves$, { initialValue: [] });

  // 4. Teammates Approved Leaves (Only for managers, fallback to [] for employees)
  allUsers$ = collectionData(collection(this.firestore, 'users'), { idField: 'uid' }).pipe(
    catchError(() => of([]))
  );
  allUsers = toSignal(this.allUsers$, { initialValue: [] });

  teamLeaves$ = this.auth.userProfile$.pipe(
    switchMap(profile => {
      // Employees do not query full collection to avoid permission errors
      if (!profile || profile.role === 'employee') return of([]);
      const q = query(
        collection(this.firestore, 'leaveRequests'),
        where('status', '==', 'approved')
      );
      return collectionData(q, { idField: 'id' }).pipe(
        catchError(() => of([]))
      );
    }),
    catchError(() => of([]))
  );
  teamLeaves = toSignal(this.teamLeaves$, { initialValue: [] });

  // Sets of User's active leaves (Approved and Pending) to mark & block in calendar
  approvedLeaveDatesSet = computed(() => {
    const set = new Set<string>();
    const leaves = this.myLeaves().filter(l => l.status === 'approved');
    for (const l of leaves) {
      for (const d of getDatesInRange(l.startDate, l.endDate)) {
        set.add(d);
      }
    }
    return set;
  });

  pendingLeaveDatesSet = computed(() => {
    const set = new Set<string>();
    const leaves = this.myLeaves().filter(l => l.status === 'pending');
    for (const l of leaves) {
      for (const d of getDatesInRange(l.startDate, l.endDate)) {
        set.add(d);
      }
    }
    return set;
  });

  // Material Datepicker Cell Class: Marks approved leaves, pending leaves, and holidays
  dateClass: MatCalendarCellClassFunction<Date> = (cellDate, view) => {
    if (view === 'month') {
      const dateStr = this.formatDate(cellDate);
      if (this.approvedLeaveDatesSet().has(dateStr)) {
        return 'mat-calendar-approved-leave';
      }
      if (this.pendingLeaveDatesSet().has(dateStr)) {
        return 'mat-calendar-pending-leave';
      }
      if (this.holidayDates().includes(dateStr)) {
        return 'mat-calendar-holiday';
      }
    }
    return '';
  };

  // Material Datepicker Filter: Prevents selecting past dates and already approved leave dates
  leaveDateFilter = (date: Date | null): boolean => {
    if (!date) return true;
    const dateStr = this.formatDate(date);
    // Cannot pick dates in past
    if (dateStr < this.todayDateStr) {
      return false;
    }
    // Cannot pick dates where leave is already approved
    if (this.approvedLeaveDatesSet().has(dateStr)) {
      return false;
    }
    return true;
  };

  // Form with cross-field validation:
  // - Start date cannot be before current date
  // - End Date must be on or after Start Date
  // - Start time is optional
  leaveForm = this.fb.group({
    startDate: [null as Date | null, Validators.required],
    startTime: [''], // Optional start time (HH:mm)
    endDate: [null as Date | null, Validators.required],
    isHalfDay: [false],
    reason: ['', [Validators.required, Validators.minLength(3)]]
  }, {
    validators: (group: AbstractControl): ValidationErrors | null => {
      const s = group.get('startDate')?.value;
      const e = group.get('endDate')?.value;
      if (!s) return null;
      const sStr = this.formatDate(s);
      if (sStr && sStr < this.todayDateStr) {
        return { pastStartDate: true };
      }
      if (!e) return null;
      const eStr = this.formatDate(e);
      if (sStr && eStr && sStr > eStr) {
        return { dateOrder: true };
      }
      return null;
    }
  });

  constructor() {
    // When start date changes:
    // If end date is empty, default to start date; if end date is earlier than start date, auto-adjust to start date
    this.leaveForm.get('startDate')?.valueChanges.subscribe(s => {
      if (!s) return;
      const e = this.leaveForm.get('endDate')?.value;
      if (!e) {
        this.leaveForm.patchValue({ endDate: s });
      } else {
        const sStr = this.formatDate(s);
        const eStr = this.formatDate(e);
        if (sStr && eStr && sStr > eStr) {
          this.leaveForm.patchValue({ endDate: s });
        }
      }
    });
  }

  // Form Value Signal for Angular computed reactivity
  formValue = toSignal(this.leaveForm.valueChanges, {
    initialValue: this.leaveForm.value
  });

  // Minimum allowed End Date for datepicker selection (at least today or startDate)
  minEndDate = computed(() => {
    const s = this.formValue()?.startDate;
    if (!s) return this.todayDate;
    const sDate = s instanceof Date ? s : new Date(s);
    return sDate >= this.todayDate ? sDate : this.todayDate;
  });

  // Backward compatibility alias for template bindings
  minDate = computed(() => this.minEndDate());

  // Check if start date is in past
  isPastStartDate = computed(() => {
    const val = this.formValue();
    if (!val || !val.startDate) return false;
    const sStr = this.formatDate(val.startDate);
    return !!(sStr && sStr < this.todayDateStr);
  });

  // Live Working Days Preview
  previewDaysCounted = computed(() => {
    const val = this.formValue();
    if (!val || !val.startDate || !val.endDate) return 0;

    const sStr = this.formatDate(val.startDate);
    const eStr = this.formatDate(val.endDate);
    if (!sStr || !eStr || sStr > eStr) return 0;

    return calculateWorkingDays(sStr, eStr, !!val.isHalfDay, this.holidayDates(), this.weeklyOffs());
  });

  isEndDateBeforeStartDate = computed(() => {
    const val = this.formValue();
    if (!val || !val.startDate || !val.endDate) return false;
    const sStr = this.formatDate(val.startDate);
    const eStr = this.formatDate(val.endDate);
    return !!(sStr && eStr && sStr > eStr);
  });

  balanceAfterLeave = computed(() => {
    return Number((this.remainingDays() - this.previewDaysCounted()).toFixed(1));
  });

  isNegativeAfterLeave = computed(() => {
    return this.previewDaysCounted() > 0 && this.balanceAfterLeave() < 0;
  });

  // Live Overlap with User's OWN Approved or Pending Leaves (prevents duplicate application for same dates)
  overlappingUserLeaves = computed(() => {
    const val = this.formValue();
    if (!val || !val.startDate || !val.endDate) return [];

    const sStr = this.formatDate(val.startDate);
    const eStr = this.formatDate(val.endDate);
    if (!sStr || !eStr || sStr > eStr) return [];

    const selectedDates = getDatesInRange(sStr, eStr);
    const overlaps: { date: string; status: 'approved' | 'pending'; reason?: string }[] = [];

    const userActiveLeaves = (this.myLeaves() as LeaveRequest[]).filter(
      l => l.status === 'approved' || l.status === 'pending'
    );

    for (const l of userActiveLeaves) {
      const lDates = getDatesInRange(l.startDate, l.endDate);
      for (const d of selectedDates) {
        if (lDates.includes(d)) {
          overlaps.push({
            date: d,
            status: l.status as 'approved' | 'pending',
            reason: l.reason
          });
        }
      }
    }

    const uniqueMap = new Map<string, { date: string; status: 'approved' | 'pending'; reason?: string }>();
    for (const o of overlaps) {
      if (!uniqueMap.has(o.date) || o.status === 'approved') {
        uniqueMap.set(o.date, o);
      }
    }

    return Array.from(uniqueMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  });

  hasUserOverlap = computed(() => this.overlappingUserLeaves().length > 0);

  // Live Teammate Overlap Warning
  overlappingTeammates = computed(() => {
    const val = this.formValue();
    if (!val || !val.startDate || !val.endDate) return [];

    const sStr = this.formatDate(val.startDate);
    const eStr = this.formatDate(val.endDate);
    if (!sStr || !eStr || sStr > eStr) return [];

    const currentUid = this.auth.user()?.uid;
    const usersMap = new Map((this.allUsers() as UserProfile[]).map(u => [u.uid, u.name]));

    const overlaps = (this.teamLeaves() as LeaveRequest[]).filter(l => {
      if (l.uid === currentUid) return false;
      return sStr <= l.endDate && eStr >= l.startDate;
    });

    return overlaps.map(l => ({
      name: usersMap.get(l.uid) || l.userName || 'Teammate',
      startDate: l.startDate,
      endDate: l.endDate
    }));
  });

  // ==========================================
  // Dedicated Monthly Leave Calendar View
  // ==========================================
  calendarYear = signal(new Date().getFullYear());
  calendarMonth = signal(new Date().getMonth() + 1);

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

  calendarMonthPrefix = computed(() => {
    const m = String(this.calendarMonth()).padStart(2, '0');
    return `${this.calendarYear()}-${m}`;
  });

  calendarMonthName = computed(() => {
    const found = this.months.find(m => m.value === this.calendarMonth());
    return found ? found.name : '';
  });

  holidaysMap = computed(() => new Map(this.holidays().map(h => [h.date, h.name])));

  calendarDays = computed(() => {
    const year = this.calendarYear();
    const month = this.calendarMonth();
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDayIndex = new Date(year, month - 1, 1).getDay(); // 0 = Sun

    const days: {
      dayNumber: number;
      dateStr: string;
      isCurrentMonth: boolean;
      isWeekend: boolean;
      isHoliday: boolean;
      holidayName?: string;
      isToday: boolean;
      isPast: boolean;
      approvedLeave?: LeaveRequest;
      pendingLeave?: LeaveRequest;
      canApply: boolean;
    }[] = [];

    // Empty padding slots
    for (let i = 0; i < firstDayIndex; i++) {
      days.push({
        dayNumber: 0,
        dateStr: '',
        isCurrentMonth: false,
        isWeekend: false,
        isHoliday: false,
        isToday: false,
        isPast: true,
        canApply: false
      });
    }

    const approvedMap = new Map<string, LeaveRequest>();
    const pendingMap = new Map<string, LeaveRequest>();
    for (const l of this.myLeaves()) {
      const dates = getDatesInRange(l.startDate, l.endDate);
      for (const d of dates) {
        if (l.status === 'approved' && !approvedMap.has(d)) {
          approvedMap.set(d, l);
        } else if (l.status === 'pending' && !pendingMap.has(d)) {
          pendingMap.set(d, l);
        }
      }
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(year, month - 1, day);
      const dayOfWeek = dateObj.getDay();
      const isWeekend = this.weeklyOffs().includes(dayOfWeek);

      const dayStr = String(day).padStart(2, '0');
      const dateStr = `${this.calendarMonthPrefix()}-${dayStr}`;
      const isToday = dateStr === this.todayDateStr;
      const isPast = dateStr < this.todayDateStr;
      const isHoliday = this.holidaysMap().has(dateStr);
      const holidayName = this.holidaysMap().get(dateStr);

      const approvedLeave = approvedMap.get(dateStr);
      const pendingLeave = pendingMap.get(dateStr);
      const canApply = !isPast && !approvedLeave;

      days.push({
        dayNumber: day,
        dateStr,
        isCurrentMonth: true,
        isWeekend,
        isHoliday,
        holidayName,
        isToday,
        isPast,
        approvedLeave,
        pendingLeave,
        canApply
      });
    }

    return days;
  });

  prevMonth() {
    if (this.calendarMonth() === 1) {
      this.calendarMonth.set(12);
      this.calendarYear.update(y => y - 1);
    } else {
      this.calendarMonth.update(m => m - 1);
    }
  }

  nextMonth() {
    if (this.calendarMonth() === 12) {
      this.calendarMonth.set(1);
      this.calendarYear.update(y => y + 1);
    } else {
      this.calendarMonth.update(m => m + 1);
    }
  }

  goToToday() {
    const now = new Date();
    this.calendarYear.set(now.getFullYear());
    this.calendarMonth.set(now.getMonth() + 1);
  }

  selectDateFromCalendar(dateStr: string) {
    if (!dateStr || dateStr < this.todayDateStr || this.approvedLeaveDatesSet().has(dateStr)) return;
    const [y, m, d] = dateStr.split('-').map(Number);
    const targetDate = new Date(y, m - 1, d);
    this.leaveForm.patchValue({
      startDate: targetDate,
      endDate: targetDate
    });
    this.selectedTab.set(0); // Switch to Apply for Leave form
  }

  formatDate(d: any): string {
    if (!d) return '';
    if (typeof d === 'string') {
      if (d.includes('T')) return d.split('T')[0];
      return d;
    }
    if (d instanceof Date && !isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    try {
      const parsed = new Date(d);
      if (!isNaN(parsed.getTime())) {
        const y = parsed.getFullYear();
        const m = String(parsed.getMonth() + 1).padStart(2, '0');
        const day = String(parsed.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
    } catch {
      // ignore
    }
    return '';
  }

  formatTime(t?: string | null): string {
    if (!t) return '';
    return formatTime12h(t);
  }

  async submitLeave() {
    if (this.leaveForm.invalid || this.isSubmitting()) {
      this.leaveForm.markAllAsTouched();
      return;
    }

    const val = this.leaveForm.value;
    const sStr = this.formatDate(val.startDate);
    const eStr = this.formatDate(val.endDate);

    if (sStr < this.todayDateStr) {
      this.snackBar.open('Cannot apply: Start date cannot be earlier than today.', 'Close', {
        duration: 4000
      });
      return;
    }

    if (sStr > eStr) {
      this.snackBar.open('Cannot apply: End date cannot be earlier than start date.', 'Close', {
        duration: 4000
      });
      return;
    }

    if (this.overlappingUserLeaves().length > 0) {
      const dates = this.overlappingUserLeaves().map(o => o.date).join(', ');
      this.snackBar.open(`Cannot apply: You already have a booked leave on ${dates}. Please select different dates.`, 'Close', {
        duration: 5000
      });
      return;
    }

    const daysCount = this.previewDaysCounted();
    if (daysCount <= 0) {
      this.snackBar.open('Selected dates fall entirely on company holidays or weekly off days (0 working days).', 'Close', {
        duration: 4000
      });
      return;
    }

    this.isSubmitting.set(true);
    try {
      const user = this.auth.currentUser;
      const profile = this.auth.userProfile();
      if (!user) throw new Error('Not logged in');

      await addDoc(collection(this.firestore, 'leaveRequests'), {
        uid: user.uid,
        userName: profile?.name || user.displayName || user.email || 'Employee',
        userEmail: user.email || '',
        leaveTypeId: 'unified',
        startDate: sStr,
        startTime: val.startTime ? (val.startTime as string).trim() : null,
        endDate: eStr,
        isHalfDay: !!val.isHalfDay,
        days: daysCount,
        reason: val.reason!.trim(),
        status: 'pending',
        createdAt: new Date().toISOString()
      });

      this.snackBar.open('Leave application submitted for approval!', 'Close', { duration: 4000 });
      this.leaveForm.reset({ isHalfDay: false });
      this.selectedTab.set(1); // switch to history tab
    } catch (error: any) {
      this.snackBar.open(error.message || 'Error submitting leave request', 'Close', { duration: 4000 });
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async cancelRequest(req: LeaveRequest) {
    const confirmed = await this.confirmService.confirm({
      title: 'Cancel Leave Request',
      message: `Are you sure you want to cancel this leave application from ${req.startDate} to ${req.endDate}? Any deducted balance will be restored.`,
      confirmText: 'Yes, Cancel Leave',
      cancelText: 'Keep Request',
      isDestructive: true,
      icon: 'cancel'
    });
    if (!confirmed) return;

    this.cancellingId.set(req.id);
    try {
      const cancelFn = httpsCallable(this.functions, 'cancelLeave');
      await cancelFn({ requestId: req.id });
      this.snackBar.open('Leave request cancelled successfully. Any deducted balance is restored.', 'Close', {
        duration: 4000
      });
    } catch (e: any) {
      this.snackBar.open(e.message || 'Error cancelling leave', 'Close', { duration: 4000 });
    } finally {
      this.cancellingId.set(null);
    }
  }

  canCancel(req: LeaveRequest): boolean {
    if (req.status === 'cancelled' || req.status === 'rejected') return false;
    return true;
  }
}

