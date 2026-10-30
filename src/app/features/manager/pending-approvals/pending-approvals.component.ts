import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Firestore, collection, collectionData, query, where } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { toSignal } from '@angular/core/rxjs-interop';
import { LeaveRequest, RegularizationRequest, UserProfile } from '../../../core/models';
import { SettingsService, DEFAULT_SETTINGS } from '../../../core/settings.service';
import { calculateWorkingDays, formatTime12h } from '../../../core/date-utils';
import { StatusChipComponent } from '../../../shared/status-chip/status-chip.component';
import { ConfirmDialogService } from '../../../shared/confirm-dialog/confirm-dialog.component';
import { map } from 'rxjs';

@Component({
  selector: 'app-pending-approvals',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatDialogModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatInputModule,
    MatTooltipModule,
    StatusChipComponent
  ],
  templateUrl: './pending-approvals.html',
  styleUrls: ['./pending-approvals.css']
})
export class PendingApprovalsComponent {
  private firestore = inject(Firestore);
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);
  private settingsService = inject(SettingsService);
  private confirmService = inject(ConfirmDialogService);

  selectedTab = signal(0);
  processingId = signal<string | null>(null);

  // Leave sub-filter ('pending' | 'approved' | 'all') and search
  leaveFilterMode = signal<'pending' | 'approved' | 'all'>('pending');
  leaveSearchQuery = signal('');

  // Dialog state for general action (approve/reject comment)
  activeRequest = signal<{ id: string; type: 'leave' | 'reg'; action: 'approve' | 'reject'; name: string } | null>(null);
  managerComment = signal('');

  // Edit Leave Details Modal state
  editingLeave = signal<LeaveRequest | null>(null);
  editStartDate = signal('');
  editStartTime = signal('');
  editEndDate = signal('');
  editIsHalfDay = signal(false);
  editHalfDayType = signal<'first_half' | 'second_half'>('first_half');
  editManagerComment = signal('');
  editSaving = signal(false);
  editError = signal<string | null>(null);

  // Company Settings & Holidays for live working day recalculation
  companySettings = toSignal(this.settingsService.getSettings(), { initialValue: DEFAULT_SETTINGS });
  weeklyOffs = computed(() => this.companySettings()?.weeklyOffs || [0, 6]);
  holidays = toSignal(this.settingsService.getHolidays(), { initialValue: [] });
  holidayDates = computed(() => this.holidays().map(h => h.date));

  // Dynamic working days calculation inside Edit modal
  editCalculatedDays = computed(() => {
    const start = this.editStartDate();
    const end = this.editEndDate();
    const isHalf = this.editIsHalfDay();
    if (!start || !end) return 0;
    return calculateWorkingDays(start, end, isHalf, this.holidayDates(), this.weeklyOffs());
  });

  // Balance impact delta for approved leave editing
  balanceImpactDelta = computed(() => {
    const leave = this.editingLeave();
    if (!leave || leave.status !== 'approved') return 0;
    const oldDays = Number(leave.days || 1);
    const newDays = this.editCalculatedDays();
    return Number((newDays - oldDays).toFixed(1));
  });

  // 1. All Users map for displaying employee names & avatars
  allUsers$ = collectionData(collection(this.firestore, 'users'), { idField: 'uid' });
  allUsers = toSignal(this.allUsers$, { initialValue: [] });

  getUserName(uid: string, fallback?: string): string {
    const u = (this.allUsers() as UserProfile[]).find(x => x.uid === uid);
    return u?.name || fallback || 'Employee';
  }

  getUserEmail(uid: string, fallback?: string): string {
    const u = (this.allUsers() as UserProfile[]).find(x => x.uid === uid);
    return u?.email || fallback || '';
  }

  getUserInitials(uid: string, fallback?: string): string {
    const name = this.getUserName(uid, fallback);
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  // 2. Pending Leaves
  pendingLeaves$ = collectionData(
    query(collection(this.firestore, 'leaveRequests'), where('status', '==', 'pending')),
    { idField: 'id' }
  ).pipe(
    map(list => {
      const arr = list as LeaveRequest[];
      return arr.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    })
  );
  pendingLeaves = toSignal(this.pendingLeaves$, { initialValue: [] });

  // 3. All Leaves (for history & approved leave editing)
  allLeaves$ = collectionData(
    collection(this.firestore, 'leaveRequests'),
    { idField: 'id' }
  ).pipe(
    map(list => {
      const arr = list as LeaveRequest[];
      return arr.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    })
  );
  allLeaves = toSignal(this.allLeaves$, { initialValue: [] });

  approvedLeaves = computed(() => this.allLeaves().filter(l => l.status === 'approved'));

  // 4. Filtered Leaves List based on active tab & search query
  displayedLeaves = computed(() => {
    const mode = this.leaveFilterMode();
    const queryStr = this.leaveSearchQuery().toLowerCase().trim();

    let list: LeaveRequest[] = [];
    if (mode === 'pending') {
      list = this.pendingLeaves();
    } else if (mode === 'approved') {
      list = this.approvedLeaves();
    } else {
      list = this.allLeaves();
    }

    if (!queryStr) return list;

    return list.filter(l => {
      const name = this.getUserName(l.uid, l.userName).toLowerCase();
      const email = this.getUserEmail(l.uid, l.userEmail).toLowerCase();
      const reason = (l.reason || '').toLowerCase();
      const dateRange = `${l.startDate} ${l.endDate}`;
      return name.includes(queryStr) || email.includes(queryStr) || reason.includes(queryStr) || dateRange.includes(queryStr);
    });
  });

  // 5. Pending Regularizations
  pendingRegs$ = collectionData(
    query(collection(this.firestore, 'regularizations'), where('status', '==', 'pending')),
    { idField: 'id' }
  ).pipe(
    map(list => {
      const arr = list as RegularizationRequest[];
      return arr.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    })
  );
  pendingRegs = toSignal(this.pendingRegs$, { initialValue: [] });

  formatDisplayTime(timeStr?: string | null): string {
    if (!timeStr) return '';
    return formatTime12h(timeStr);
  }

  // --- Edit Leave Details Actions ---
  openEditLeave(leave: LeaveRequest) {
    this.editingLeave.set(leave);
    this.editStartDate.set(leave.startDate);
    this.editStartTime.set(leave.startTime || '');
    this.editEndDate.set(leave.endDate);
    this.editIsHalfDay.set(!!leave.isHalfDay);
    this.editHalfDayType.set((leave.halfDayType as any) || 'first_half');
    this.editManagerComment.set(leave.managerComment || '');
    this.editError.set(null);
  }

  closeEditLeave() {
    this.editingLeave.set(null);
    this.editError.set(null);
  }

  onStartDateChange(newDate: string) {
    this.editStartDate.set(newDate);
    // If half day or endDate is before new startDate, sync endDate
    if (this.editIsHalfDay() || this.editEndDate() < newDate) {
      this.editEndDate.set(newDate);
    }
  }

  onIsHalfDayToggle(checked: boolean) {
    this.editIsHalfDay.set(checked);
    if (checked) {
      this.editEndDate.set(this.editStartDate());
    }
  }

  clearStartTime() {
    this.editStartTime.set('');
  }

  async saveLeaveEdits(approveAfter: boolean = false) {
    const leave = this.editingLeave();
    if (!leave) return;

    const start = this.editStartDate();
    const end = this.editEndDate();
    if (!start || !end) {
      this.editError.set('Please select valid start and end dates.');
      return;
    }
    if (start > end) {
      this.editError.set('Start date cannot be after end date.');
      return;
    }

    this.editSaving.set(true);
    this.editError.set(null);

    try {
      const callable = httpsCallable(this.functions, 'updateLeaveDetails');
      await callable({
        requestId: leave.id,
        startDate: start,
        endDate: end,
        startTime: this.editStartTime() ? this.editStartTime() : null,
        isHalfDay: this.editIsHalfDay(),
        halfDayType: this.editIsHalfDay() ? this.editHalfDayType() : null,
        days: this.editCalculatedDays(),
        managerComment: this.editManagerComment().trim(),
        approveAfterUpdate: approveAfter
      });

      const message = approveAfter
        ? 'Leave details updated & approved successfully.'
        : 'Leave details updated successfully.';
      this.snackBar.open(message, 'Close', { duration: 3500 });
      this.closeEditLeave();
    } catch (e: any) {
      this.editError.set(e.message || 'Error updating leave details');
      this.snackBar.open(e.message || 'Error updating leave details', 'Close', { duration: 4000 });
    } finally {
      this.editSaving.set(false);
    }
  }

  async cancelApprovedLeave(leave: LeaveRequest) {
    const userName = this.getUserName(leave.uid, leave.userName);
    const confirmed = await this.confirmService.confirm({
      title: 'Revoke Approved Leave',
      message: `Are you sure you want to cancel the approved leave for ${userName}? The leave duration of ${leave.days} working day(s) will be refunded back to their balance.`,
      confirmText: 'Yes, Revoke Leave',
      cancelText: 'Keep Leave',
      isDestructive: true,
      icon: 'cancel'
    });
    if (!confirmed) return;

    this.processingId.set(leave.id);
    try {
      const callable = httpsCallable(this.functions, 'cancelLeave');
      await callable({ requestId: leave.id });
      this.snackBar.open('Leave request cancelled and quota refunded.', 'Close', { duration: 3500 });
    } catch (e: any) {
      this.snackBar.open(e.message || 'Error cancelling leave', 'Close', { duration: 4000 });
    } finally {
      this.processingId.set(null);
    }
  }

  // --- General Approve/Reject Actions ---
  promptAction(id: string, type: 'leave' | 'reg', action: 'approve' | 'reject', name: string) {
    this.activeRequest.set({ id, type, action, name });
    this.managerComment.set('');
  }

  closeActionDialog() {
    this.activeRequest.set(null);
    this.managerComment.set('');
  }

  async confirmAction() {
    const req = this.activeRequest();
    if (!req) return;

    this.processingId.set(req.id);
    const comment = this.managerComment().trim();

    try {
      if (req.type === 'leave') {
        const fnName = req.action === 'approve' ? 'approveLeave' : 'rejectLeave';
        const callable = httpsCallable(this.functions, fnName);
        await callable({ requestId: req.id, comment });
        this.snackBar.open(`Leave request ${req.action}d successfully.`, 'Close', { duration: 3500 });
      } else {
        const callable = httpsCallable(this.functions, 'reviewRegularization');
        await callable({ regularizationId: req.id, action: req.action, comment });
        this.snackBar.open(`Regularization request ${req.action}d successfully.`, 'Close', { duration: 3500 });
      }
      this.closeActionDialog();
    } catch (e: any) {
      this.snackBar.open(e.message || 'Error executing action', 'Close', { duration: 4000 });
    } finally {
      this.processingId.set(null);
    }
  }
}
