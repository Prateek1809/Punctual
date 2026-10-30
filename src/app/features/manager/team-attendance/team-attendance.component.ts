import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Firestore, collection, collectionData, query, where } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';
import { UserProfile, AttendanceRecord, LeaveRequest } from '../../../core/models';
import { getISTDateString, formatTime12h, formatDuration } from '../../../core/date-utils';
import { StatusChipComponent } from '../../../shared/status-chip/status-chip.component';
import { map, Observable } from 'rxjs';

interface MemberTodayStatus {
  user: UserProfile;
  attendance?: AttendanceRecord;
  status: 'present' | 'late' | 'half-day' | 'leave' | 'absent' | 'not_punched';
  statusLabel: string;
  checkInTime?: string;
  checkOutTime?: string;
  workedDuration?: string;
  isFlagged: boolean;
}

@Component({
  selector: 'app-team-attendance',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatFormFieldModule,
    MatTooltipModule,
    StatusChipComponent
  ],
  templateUrl: './team-attendance.html'
})
export class TeamAttendanceComponent {
  private firestore = inject(Firestore);

  todayDateStr = getISTDateString();
  selectedMonth = signal(new Date().getMonth() + 1);
  selectedYear = signal(new Date().getFullYear());

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

  // 1. All Active Employees typed
  users$ = (collectionData(
    query(collection(this.firestore, 'users'), where('isActive', '==', true)),
    { idField: 'uid' }
  ) as Observable<UserProfile[]>).pipe(
    map(list => list.filter(u => u.role === 'employee'))
  );
  users = toSignal(this.users$, { initialValue: [] });

  // 2. Today's Attendance records for all team members
  todayAttendance$ = collectionData(
    query(collection(this.firestore, 'attendance'), where('date', '==', this.todayDateStr)),
    { idField: 'id' }
  ) as Observable<AttendanceRecord[]>;
  todayAttendance = toSignal(this.todayAttendance$, { initialValue: [] });

  // 3. Approved Leaves active today
  activeLeavesToday$ = collectionData(
    query(
      collection(this.firestore, 'leaveRequests'),
      where('status', '==', 'approved'),
      where('startDate', '<=', this.todayDateStr)
    )
  ) as Observable<LeaveRequest[]>;
  activeLeavesToday = toSignal(this.activeLeavesToday$, { initialValue: [] });

  // 4. Monthly Attendance for matrix table
  monthPrefix = computed(() => {
    const m = String(this.selectedMonth()).padStart(2, '0');
    return `${this.selectedYear()}-${m}`;
  });

  monthlyRecords$ = collectionData(
    query(
      collection(this.firestore, 'attendance'),
      where('date', '>=', `${this.monthPrefix()}-01`),
      where('date', '<=', `${this.monthPrefix()}-31`)
    ),
    { idField: 'id' }
  ) as Observable<AttendanceRecord[]>;
  monthlyRecords = toSignal(this.monthlyRecords$, { initialValue: [] });

  // Days in selected month for matrix header
  daysInMonth = computed(() => {
    const total = new Date(this.selectedYear(), this.selectedMonth(), 0).getDate();
    return Array.from({ length: total }, (_, i) => i + 1);
  });

  // Today's Live Board calculation
  todayBoard = computed(() => {
    const userList = this.users();
    const attMap = new Map(this.todayAttendance().map(a => [a.uid, a]));
    const onLeaveSet = new Set(
      this.activeLeavesToday()
        .filter(l => l.endDate >= this.todayDateStr)
        .map(l => l.uid)
    );

    const result: MemberTodayStatus[] = [];

    for (const u of userList) {
      const att = attMap.get(u.uid);
      const onLeave = onLeaveSet.has(u.uid);

      let status: MemberTodayStatus['status'] = 'not_punched';
      let statusLabel = 'Not Punched In';

      if (onLeave) {
        status = 'leave';
        statusLabel = 'On Leave';
      } else if (att) {
        status = att.status;
        statusLabel = att.status;
      }

      result.push({
        user: u,
        attendance: att,
        status,
        statusLabel,
        checkInTime: att?.checkIn ? formatTime12h(att.checkIn) : undefined,
        checkOutTime: att?.checkOut ? formatTime12h(att.checkOut) : undefined,
        workedDuration: att?.workedMinutes ? formatDuration(att.workedMinutes) : undefined,
        isFlagged: att?.reviewStatus === 'pending'
      });
    }

    return result;
  });

  todaySummary = computed(() => {
    const list = this.todayBoard();
    const present = list.filter(m => m.status === 'present' || m.status === 'late' || m.status === 'half-day').length;
    const late = list.filter(m => m.status === 'late').length;
    const onLeave = list.filter(m => m.status === 'leave').length;
    const notIn = list.filter(m => m.status === 'not_punched').length;
    const flagged = list.filter(m => m.isFlagged).length;

    return { total: list.length, present, late, onLeave, notIn, flagged };
  });

  getUserInitials(name: string): string {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  // Matrix cell lookup: uid + day
  getMatrixCell(uid: string, day: number): { char: string; colorClass: string; title: string } {
    const dayStr = String(day).padStart(2, '0');
    const dateStr = `${this.monthPrefix()}-${dayStr}`;
    const dateObj = new Date(this.selectedYear(), this.selectedMonth() - 1, day);
    const dayOfWeek = dateObj.getDay();

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return { char: '—', colorClass: 'text-slate-300 bg-slate-50', title: 'Weekend' };
    }

    if (dateStr > this.todayDateStr) {
      return { char: '·', colorClass: 'text-slate-200', title: 'Future' };
    }

    const rec = this.monthlyRecords().find(
      r => r.uid === uid && r.date === dateStr
    );

    if (!rec) {
      return { char: 'A', colorClass: 'text-rose-600 font-bold bg-rose-50', title: 'Absent' };
    }

    switch (rec.status) {
      case 'present':
        return { char: 'P', colorClass: 'text-emerald-700 font-bold bg-emerald-50', title: 'Present' };
      case 'late':
        return { char: 'L', colorClass: 'text-amber-800 font-bold bg-amber-50', title: 'Late' };
      case 'half-day':
        return { char: 'H', colorClass: 'text-orange-700 font-bold bg-orange-50', title: 'Half Day' };
      case 'leave':
        return { char: 'LV', colorClass: 'text-blue-700 font-bold bg-blue-50', title: 'Leave' };
      default:
        return { char: 'A', colorClass: 'text-rose-600 font-bold bg-rose-50', title: 'Absent' };
    }
  }
}
