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
import { LeaveRequest, UserProfile, Holiday } from '../../../core/models';
import { SettingsService } from '../../../core/settings.service';
import { getISTDateString } from '../../../core/date-utils';
import { Observable } from 'rxjs';

interface DayLeaveMember {
  uid: string;
  name: string;
  initials: string;
  isHalfDay: boolean;
  reason: string;
}

interface CalendarDay {
  dayNumber: number;
  dateStr: string;
  isCurrentMonth: boolean;
  isWeekend: boolean;
  isHoliday: boolean;
  holidayName?: string;
  leaves: DayLeaveMember[];
  isCrowded: boolean; // >= 2 people off
}

@Component({
  selector: 'app-team-calendar',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatFormFieldModule,
    MatTooltipModule
  ],
  templateUrl: './team-calendar.html'
})
export class TeamCalendarComponent {
  private firestore = inject(Firestore);
  private settingsService = inject(SettingsService);

  todayDateStr = getISTDateString();
  selectedYear = signal(new Date().getFullYear());
  selectedMonth = signal(new Date().getMonth() + 1);

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

  // 1. All Users map
  allUsers$ = collectionData(collection(this.firestore, 'users'), { idField: 'uid' }) as Observable<UserProfile[]>;
  allUsers = toSignal(this.allUsers$, { initialValue: [] });

  // 2. Holidays
  holidays$ = this.settingsService.getHolidays();
  holidays = toSignal(this.holidays$, { initialValue: [] });
  holidaysMap = computed(() => new Map(this.holidays().map(h => [h.date, h.name])));

  // 3. Approved Leaves for month
  monthPrefix = computed(() => {
    const m = String(this.selectedMonth()).padStart(2, '0');
    return `${this.selectedYear()}-${m}`;
  });

  approvedLeaves$ = collectionData(
    query(
      collection(this.firestore, 'leaveRequests'),
      where('status', '==', 'approved')
    ),
    { idField: 'id' }
  ) as Observable<LeaveRequest[]>;
  approvedLeaves = toSignal(this.approvedLeaves$, { initialValue: [] });

  // Calendar Days Grid
  calendarDays = computed(() => {
    const year = this.selectedYear();
    const month = this.selectedMonth();
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDayIndex = new Date(year, month - 1, 1).getDay();

    const usersMap = new Map(this.allUsers().map(u => [u.uid, u.name]));
    const leavesList = this.approvedLeaves();

    const days: CalendarDay[] = [];

    // Padding for days before 1st of month
    for (let i = 0; i < firstDayIndex; i++) {
      days.push({
        dayNumber: 0,
        dateStr: '',
        isCurrentMonth: false,
        isWeekend: false,
        isHoliday: false,
        leaves: [],
        isCrowded: false
      });
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(year, month - 1, day);
      const dayOfWeek = dateObj.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      const dayStr = String(day).padStart(2, '0');
      const dateStr = `${this.monthPrefix()}-${dayStr}`;

      const isHoliday = this.holidaysMap().has(dateStr);
      const holidayName = this.holidaysMap().get(dateStr);

      // Check leaves active on this day
      const dayLeaves = leavesList.filter(l => l.startDate <= dateStr && l.endDate >= dateStr);
      const leaveMembers: DayLeaveMember[] = dayLeaves.map(l => {
        const name = usersMap.get(l.uid) || l.userName || 'Employee';
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

      const isCrowded = leaveMembers.length >= 2;

      days.push({
        dayNumber: day,
        dateStr,
        isCurrentMonth: true,
        isWeekend,
        isHoliday,
        holidayName,
        leaves: leaveMembers,
        isCrowded
      });
    }

    return days;
  });

  // Crowded Days for Warning Banner
  crowdedDays = computed(() => {
    return this.calendarDays().filter(d => d.isCurrentMonth && d.isCrowded);
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
  }
}
