import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
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
import { getISTDateString, calculateWorkingDays } from '../../../core/date-utils';
import { StatusChipComponent } from '../../../shared/status-chip/status-chip.component';
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

  selectedTab = signal(0);
  isSubmitting = signal(false);
  cancellingId = signal<string | null>(null);

  todayDateStr = getISTDateString();
  currentYear = this.todayDateStr.split('-')[0];

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
      return Math.max(0, bal.balances.unified.allotted - bal.balances.unified.used);
    }
    const quota = this.settings()?.monthlyQuota ?? 1.5;
    return Number((quota * 12).toFixed(1));
  });

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

  // Form with cross-field validation: End Date must be on or after Start Date
  leaveForm = this.fb.group({
    startDate: [null as Date | null, Validators.required],
    endDate: [null as Date | null, Validators.required],
    isHalfDay: [false],
    reason: ['', [Validators.required, Validators.minLength(3)]]
  }, {
    validators: (group: AbstractControl): ValidationErrors | null => {
      const s = group.get('startDate')?.value;
      const e = group.get('endDate')?.value;
      if (!s || !e) return null;
      const sStr = this.formatDate(s);
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

  // Minimum allowed End Date for datepicker selection
  minDate = computed(() => {
    const s = this.formValue()?.startDate;
    if (!s) return null;
    return s instanceof Date ? s : new Date(s);
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
    return Math.max(0, Number((this.remainingDays() - this.previewDaysCounted()).toFixed(1)));
  });

  isInsufficientBalance = computed(() => {
    const days = this.previewDaysCounted();
    const remaining = this.remainingDays();
    return days > 0 && days > remaining;
  });

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

  async submitLeave() {
    if (this.leaveForm.invalid || this.isSubmitting()) {
      this.leaveForm.markAllAsTouched();
      return;
    }

    const val = this.leaveForm.value;
    const sStr = this.formatDate(val.startDate);
    const eStr = this.formatDate(val.endDate);

    if (sStr > eStr) {
      this.snackBar.open('Cannot apply: End date cannot be earlier than start date.', 'Close', {
        duration: 4000
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

    if (this.isInsufficientBalance()) {
      this.snackBar.open(`Cannot apply: Requested ${daysCount} working days exceed your remaining balance (${this.remainingDays()} days).`, 'Close', {
        duration: 5000
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
    if (confirm(`Are you sure you want to cancel this leave from ${req.startDate} to ${req.endDate}?`)) {
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
  }

  canCancel(req: LeaveRequest): boolean {
    if (req.status === 'cancelled' || req.status === 'rejected') return false;
    return true;
  }
}
