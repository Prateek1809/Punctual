import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
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
import { switchMap, of, map } from 'rxjs';

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
  settings$ = this.settingsService.getSettings();
  settings = toSignal(this.settings$, { initialValue: null });

  holidays$ = this.settingsService.getHolidays();
  holidays = toSignal(this.holidays$, { initialValue: [] });

  holidayDates = computed(() => this.holidays().map(h => h.date));
  weeklyOffs = computed(() => this.settings()?.weeklyOffs || [0, 6]);

  // 2. User Leave Balance
  leaveBalance$ = this.auth.userProfile$.pipe(
    switchMap(profile => {
      if (!profile) return of(null);
      const balRef = doc(this.firestore, `leaveBalances/${profile.uid}_${this.currentYear}`);
      return docData(balRef).pipe(map(data => (data ? (data as LeaveBalance) : null)));
    })
  );
  leaveBalance = toSignal(this.leaveBalance$, { initialValue: null });

  remainingDays = computed(() => {
    const bal = this.leaveBalance();
    if (!bal || !bal.balances?.unified) return 18;
    return Math.max(0, bal.balances.unified.allotted - bal.balances.unified.used);
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
        })
      );
    })
  );
  myLeaves = toSignal(this.myLeaves$, { initialValue: [] });

  // 4. Teammates Approved Leaves (for overlap check)
  allUsers$ = collectionData(collection(this.firestore, 'users'), { idField: 'uid' });
  allUsers = toSignal(this.allUsers$, { initialValue: [] });

  teamLeaves$ = collectionData(
    query(
      collection(this.firestore, 'leaveRequests'),
      where('status', '==', 'approved')
    )
  );
  teamLeaves = toSignal(this.teamLeaves$, { initialValue: [] });

  // Form
  leaveForm = this.fb.group({
    startDate: [null as Date | null, Validators.required],
    endDate: [null as Date | null, Validators.required],
    isHalfDay: [false],
    reason: ['', [Validators.required, Validators.minLength(3)]]
  });

  // Live Working Days Preview
  previewDaysCounted = computed(() => {
    const sDate = this.leaveForm.get('startDate')?.value;
    const eDate = this.leaveForm.get('endDate')?.value;
    const isHalfDay = this.leaveForm.get('isHalfDay')?.value || false;

    if (!sDate || !eDate) return 0;

    const sStr = this.formatDate(sDate);
    const eStr = this.formatDate(eDate);

    return calculateWorkingDays(sStr, eStr, isHalfDay, this.holidayDates(), this.weeklyOffs());
  });

  balanceAfterLeave = computed(() => {
    return Math.max(0, Number((this.remainingDays() - this.previewDaysCounted()).toFixed(1)));
  });

  isInsufficientBalance = computed(() => {
    return this.previewDaysCounted() > this.remainingDays();
  });

  // Live Teammate Overlap Warning
  overlappingTeammates = computed(() => {
    const sDate = this.leaveForm.get('startDate')?.value;
    const eDate = this.leaveForm.get('endDate')?.value;
    if (!sDate || !eDate) return [];

    const sStr = this.formatDate(sDate);
    const eStr = this.formatDate(eDate);
    const currentUid = this.auth.user()?.uid;
    const usersMap = new Map((this.allUsers() as UserProfile[]).map(u => [u.uid, u.name]));

    const overlaps = (this.teamLeaves() as LeaveRequest[]).filter(l => {
      if (l.uid === currentUid) return false;
      // Date range overlap formula: sStr <= l.endDate && eStr >= l.startDate
      return sStr <= l.endDate && eStr >= l.startDate;
    });

    return overlaps.map(l => ({
      name: usersMap.get(l.uid) || l.userName || 'Teammate',
      startDate: l.startDate,
      endDate: l.endDate
    }));
  });

  private formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  async submitLeave() {
    if (this.leaveForm.invalid || this.isSubmitting()) return;

    if (this.isInsufficientBalance()) {
      this.snackBar.open('Cannot apply: Requested days exceed your remaining leave balance.', 'Close', {
        duration: 4000
      });
      return;
    }

    const daysCount = this.previewDaysCounted();
    if (daysCount <= 0) {
      this.snackBar.open('Selected dates fall entirely on holidays or weekly offs. 0 working days.', 'Close', {
        duration: 4000
      });
      return;
    }

    this.isSubmitting.set(true);
    try {
      const user = this.auth.currentUser;
      const profile = this.auth.userProfile();
      if (!user) throw new Error('Not logged in');

      const val = this.leaveForm.value;
      const sStr = this.formatDate(val.startDate!);
      const eStr = this.formatDate(val.endDate!);

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
