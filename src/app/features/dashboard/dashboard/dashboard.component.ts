import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Firestore, doc, docData, collection, collectionData, query, where } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthService } from '../../../core/auth.service';
import { LocationService } from '../../../core/location.service';
import { SettingsService } from '../../../core/settings.service';
import { AttendanceRecord, LeaveBalance, LeaveRequest, Holiday, UserProfile } from '../../../core/models';
import { getISTDateString, getISTTimeString, formatTime12h, formatDuration } from '../../../core/date-utils';
import { StatusChipComponent } from '../../../shared/status-chip/status-chip.component';
import { of, switchMap, map } from 'rxjs';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    StatusChipComponent,
    RouterModule,
  ],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.css']
})
export class DashboardComponent {
  public auth = inject(AuthService);
  private firestore = inject(Firestore);
  private functions = inject(Functions);
  private location = inject(LocationService);
  private settingsService = inject(SettingsService);
  private snackBar = inject(MatSnackBar);

  userProfile = this.auth.userProfile;
  todayDateStr = getISTDateString();
  currentTime = signal(getISTTimeString());
  isPunching = signal(false);

  // Live timer for elapsed worked time
  elapsedMinutes = signal(0);

  // 1. Today's Attendance Document
  todayAttendance$ = this.auth.userProfile$.pipe(
    switchMap(profile => {
      if (!profile) return of(null);
      const attRef = doc(this.firestore, `attendance/${profile.uid}_${this.todayDateStr}`);
      return docData(attRef).pipe(
        map(data => (data ? ({ id: `${profile.uid}_${this.todayDateStr}`, ...data } as AttendanceRecord) : null))
      );
    })
  );
  todayAttendance = toSignal(this.todayAttendance$, { initialValue: null });

  // 2. Current Year Leave Balance
  currentYear = this.todayDateStr.split('-')[0];
  leaveBalance$ = this.auth.userProfile$.pipe(
    switchMap(profile => {
      if (!profile) return of(null);
      const balRef = doc(this.firestore, `leaveBalances/${profile.uid}_${this.currentYear}`);
      return docData(balRef).pipe(map(data => (data ? (data as LeaveBalance) : null)));
    })
  );
  leaveBalance = toSignal(this.leaveBalance$, { initialValue: null });

  // 3. Current Month Attendance Records for KPI calculation
  currentMonthPrefix = this.todayDateStr.slice(0, 7); // e.g. "2026-10"
  monthlyAttendance$ = this.auth.userProfile$.pipe(
    switchMap(profile => {
      if (!profile) return of([]);
      const colRef = collection(this.firestore, 'attendance');
      const q = query(
        colRef,
        where('uid', '==', profile.uid),
        where('date', '>=', `${this.currentMonthPrefix}-01`),
        where('date', '<=', `${this.currentMonthPrefix}-31`)
      );
      return collectionData(q) as unknown as import('rxjs').Observable<AttendanceRecord[]>;
    })
  );
  monthlyAttendance = toSignal(this.monthlyAttendance$, { initialValue: [] });

  // KPIs
  daysPresentThisMonth = computed(() => {
    return this.monthlyAttendance().filter(
      r => r.status === 'present' || r.status === 'late' || r.status === 'half-day'
    ).length;
  });

  lateMarksThisMonth = computed(() => {
    return this.monthlyAttendance().filter(r => r.status === 'late').length;
  });

  remainingLeaveDays = computed(() => {
    const bal = this.leaveBalance();
    if (!bal || !bal.balances?.unified) return 18;
    return Math.max(0, bal.balances.unified.allotted - bal.balances.unified.used);
  });

  allottedLeaveDays = computed(() => {
    return this.leaveBalance()?.balances?.unified?.allotted || 18;
  });

  leaveProgressPercentage = computed(() => {
    const remaining = this.remainingLeaveDays();
    const total = this.allottedLeaveDays();
    return total > 0 ? Math.round((remaining / total) * 100) : 0;
  });

  // 4. Upcoming Holiday
  holidays$ = this.settingsService.getHolidays();
  holidays = toSignal(this.holidays$, { initialValue: [] });

  nextHoliday = computed(() => {
    const list = this.holidays().filter(h => h.date >= this.todayDateStr);
    list.sort((a, b) => a.date.localeCompare(b.date));
    if (list.length === 0) return null;
    const h = list[0];
    const diffDays = Math.ceil(
      (new Date(h.date).getTime() - new Date(this.todayDateStr).getTime()) / (1000 * 3600 * 24)
    );
    return {
      ...h,
      daysAwayText: diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : `in ${diffDays} days`
    };
  });

  // 5. Teammates on leave today
  allUsers$ = collectionData(collection(this.firestore, 'users'), { idField: 'uid' });
  allUsers = toSignal(this.allUsers$, { initialValue: [] });

  activeLeavesToday$ = collectionData(
    query(
      collection(this.firestore, 'leaveRequests'),
      where('status', '==', 'approved'),
      where('startDate', '<=', this.todayDateStr)
    )
  );
  activeLeaves = toSignal(this.activeLeavesToday$, { initialValue: [] });

  teammatesOnLeaveToday = computed(() => {
    const currentUid = this.auth.user()?.uid;
    const leaves = (this.activeLeaves() as LeaveRequest[]).filter(
      l => l.endDate >= this.todayDateStr && l.uid !== currentUid
    );
    const usersMap = new Map((this.allUsers() as UserProfile[]).map(u => [u.uid, u.name]));

    return leaves.map(l => {
      const name = usersMap.get(l.uid) || l.userName || 'Teammate';
      const initials = name
        .split(' ')
        .map(n => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
      return {
        uid: l.uid,
        name,
        initials,
        isHalfDay: l.isHalfDay,
        reason: l.reason
      };
    });
  });

  // Role helpers
  isEmployee = computed(() => this.auth.currentRole() === 'employee');
  isManagerOrAdmin = computed(() => this.auth.currentRole() === 'manager' || this.auth.currentRole() === 'admin');
  isAdmin = computed(() => this.auth.currentRole() === 'admin');

  // Team metrics for Manager/Admin Dashboard
  todayAllAttendance$ = collectionData(
    query(collection(this.firestore, 'attendance'), where('date', '==', this.todayDateStr)),
    { idField: 'id' }
  );
  todayAllAttendance = toSignal(this.todayAllAttendance$, { initialValue: [] });

  pendingApprovals$ = collectionData(
    query(collection(this.firestore, 'leaveRequests'), where('status', '==', 'pending'))
  );
  pendingApprovals = toSignal(this.pendingApprovals$, { initialValue: [] });

  flaggedPunches$ = collectionData(
    query(collection(this.firestore, 'attendance'), where('reviewStatus', '==', 'pending'))
  );
  flaggedPunches = toSignal(this.flaggedPunches$, { initialValue: [] });

  activeEmployeesCount = computed(() => {
    return (this.allUsers() as UserProfile[]).filter(u => u.isActive !== false && u.role === 'employee').length;
  });

  presentEmployeesCount = computed(() => {
    const employees = new Set((this.allUsers() as UserProfile[]).filter(u => u.role === 'employee').map(u => u.uid));
    return (this.todayAllAttendance() as AttendanceRecord[]).filter(
      r => employees.has(r.uid) && (r.status === 'present' || r.status === 'late' || r.status === 'half-day')
    ).length;
  });

  onLeaveEmployeesCount = computed(() => {
    return (this.activeLeaves() as LeaveRequest[]).filter(l => l.endDate >= this.todayDateStr).length;
  });

  todayPunchList = computed(() => {
    const usersMap = new Map((this.allUsers() as UserProfile[]).map(u => [u.uid, u]));
    const atts = (this.todayAllAttendance() as AttendanceRecord[]).filter(r => {
      const u = usersMap.get(r.uid);
      return u && u.role === 'employee' && r.checkIn;
    });
    return atts.map(r => {
      const u = usersMap.get(r.uid);
      return {
        ...r,
        userName: u?.name || 'Employee',
        userEmail: u?.email || '',
        checkInTime: r.checkIn ? formatTime12h(r.checkIn.slice(11, 16)) : '--'
      };
    }).sort((a, b) => (b.checkIn || '').localeCompare(a.checkIn || ''));
  });

  // Status helpers (for employees)
  isPunchedIn = computed(() => {
    const att = this.todayAttendance();
    return !!(att && att.checkIn && !att.checkOut);
  });

  isCompletedForToday = computed(() => {
    const att = this.todayAttendance();
    return !!(att && att.checkIn && att.checkOut);
  });

  punchButtonLabel = computed(() => {
    if (this.isCompletedForToday()) return 'Completed for Today';
    if (this.isPunchedIn()) return 'Check Out';
    return 'Check In';
  });

  checkInFormatted = computed(() => {
    const att = this.todayAttendance();
    return att?.checkIn ? formatTime12h(att.checkIn) : '--:--';
  });

  checkOutFormatted = computed(() => {
    const att = this.todayAttendance();
    return att?.checkOut ? formatTime12h(att.checkOut) : '--:--';
  });

  workedDurationText = computed(() => {
    const att = this.todayAttendance();
    if (!att || !att.checkIn) return '0h 0m';
    if (att.workedMinutes !== undefined) {
      return formatDuration(att.workedMinutes);
    }
    return formatDuration(this.elapsedMinutes());
  });

  constructor() {
    // Timer interval
    setInterval(() => {
      this.currentTime.set(getISTTimeString());
      const att = this.todayAttendance();
      if (att && att.checkIn && !att.checkOut) {
        const inTime = new Date(att.checkIn).getTime();
        const diffM = Math.max(0, Math.floor((Date.now() - inTime) / 60000));
        this.elapsedMinutes.set(diffM);
      }
    }, 1000);
  }

  async handlePunch() {
    if (this.isCompletedForToday()) {
      this.snackBar.open('You have already completed attendance for today.', 'OK', { duration: 3000 });
      return;
    }

    if (this.isPunching()) return;

    this.isPunching.set(true);

    try {
      if (this.isPunchedIn()) {
        // PUNCH OUT
        this.snackBar.open('Recording Check Out...', '', { duration: 2000 });
        const pos = await this.location.getPosition();
        const punchOutFn = httpsCallable(this.functions, 'punchOut');
        const res = await punchOutFn({
          lat: pos?.lat || 0,
          lng: pos?.lng || 0,
          accuracy: pos?.accuracy || 9999
        });
        const data = res.data as { workedMinutes: number; status: string };
        this.snackBar.open(`Checked out successfully! Total worked: ${formatDuration(data.workedMinutes)}`, 'Close', {
          duration: 4000
        });
      } else {
        // PUNCH IN
        this.snackBar.open('Checking location and verifying...', '', { duration: 2500 });
        const pos = await this.location.getPosition();

        const punchInFn = httpsCallable(this.functions, 'punchIn');
        const res = await punchInFn({
          lat: pos?.lat || 0,
          lng: pos?.lng || 0,
          accuracy: pos?.accuracy || 9999
        });
        const data = res.data as { status: string; verified: boolean; reviewStatus: string };

        if (data.verified) {
          this.snackBar.open('Checked in successfully at office! Have a productive day.', 'Close', {
            duration: 4000
          });
        } else {
          this.snackBar.open('Checked in outside office. Punch has been flagged for manager review.', 'Close', {
            duration: 5000
          });
        }
      }
    } catch (error: any) {
      this.snackBar.open(error.message || 'Error recording attendance', 'Close', { duration: 4000 });
    } finally {
      this.isPunching.set(false);
    }
  }
}
