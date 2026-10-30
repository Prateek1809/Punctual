import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SettingsService } from '../../../core/settings.service';
import { AuthService } from '../../../core/auth.service';
import { Holiday } from '../../../core/models';
import { getISTDateString } from '../../../core/date-utils';
import { toSignal } from '@angular/core/rxjs-interop';

export interface CalendarHolidayDay {
  dayNumber: number;
  dateStr: string;
  isCurrentMonth: boolean;
  isWeekend: boolean;
  isToday: boolean;
  isHoliday: boolean;
  holidayName?: string;
}

@Component({
  selector: 'app-holidays',
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
    MatTooltipModule
  ],
  templateUrl: './holidays.html'
})
export class HolidaysComponent {
  private fb = inject(FormBuilder);
  private settingsService = inject(SettingsService);
  private snackBar = inject(MatSnackBar);
  public auth = inject(AuthService);

  todayDateStr = getISTDateString();
  selectedYear = signal(new Date().getFullYear());
  selectedMonth = signal(new Date().getMonth() + 1);

  selectedDay = signal<CalendarHolidayDay | null>(null);
  showEventModal = signal(false);
  showAddModal = signal(false);

  isAdding = signal(false);
  deletingId = signal<string | null>(null);

  isAdmin = computed(() => {
    const role = this.auth.currentRole() || this.auth.userProfile()?.role;
    return role === 'admin';
  });

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

  selectedMonthName = computed(() => {
    const m = this.months.find(m => m.value === this.selectedMonth());
    return m ? m.name : '';
  });

  // Holidays from Firestore
  holidays$ = this.settingsService.getHolidays();
  holidays = toSignal(this.holidays$, { initialValue: [] });
  holidaysMap = computed(() => new Map(this.holidays().map(h => [h.date, h.name])));

  // All holidays in the selected year, sorted chronologically
  yearHolidays = computed(() => {
    const yStr = String(this.selectedYear());
    return this.holidays()
      .filter(h => h.date.startsWith(yStr))
      .sort((a, b) => a.date.localeCompare(b.date));
  });

  // Holidays in the currently selected month
  monthHolidays = computed(() => {
    const mStr = String(this.selectedMonth()).padStart(2, '0');
    const prefix = `${this.selectedYear()}-${mStr}`;
    return this.yearHolidays().filter(h => h.date.startsWith(prefix));
  });

  // Calendar Days Grid matching Team Calendar architecture
  calendarDays = computed(() => {
    const year = this.selectedYear();
    const month = this.selectedMonth();
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDayIndex = new Date(year, month - 1, 1).getDay();

    const holidaysMap = this.holidaysMap();
    const today = this.todayDateStr;
    const days: CalendarHolidayDay[] = [];

    // Padding for days before 1st of month
    for (let i = 0; i < firstDayIndex; i++) {
      days.push({
        dayNumber: 0,
        dateStr: '',
        isCurrentMonth: false,
        isWeekend: false,
        isToday: false,
        isHoliday: false
      });
    }

    const mStr = String(month).padStart(2, '0');
    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(year, month - 1, day);
      const dayOfWeek = dateObj.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      const dayStr = String(day).padStart(2, '0');
      const dateStr = `${year}-${mStr}-${dayStr}`;

      const isHoliday = holidaysMap.has(dateStr);
      const holidayName = holidaysMap.get(dateStr);

      days.push({
        dayNumber: day,
        dateStr,
        isCurrentMonth: true,
        isWeekend,
        isToday: dateStr === today,
        isHoliday,
        holidayName
      });
    }

    return days;
  });

  holidayForm = this.fb.group({
    date: ['', Validators.required],
    name: ['', [Validators.required, Validators.minLength(2)]]
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

  onDayClick(day: CalendarHolidayDay) {
    if (!day.isCurrentMonth) return;
    this.selectedDay.set(day);
    this.showEventModal.set(true);
  }

  closeEventModal() {
    this.showEventModal.set(false);
  }

  openAddModal(presetDate?: string) {
    this.holidayForm.reset({
      date: presetDate || '',
      name: ''
    });
    this.showAddModal.set(true);
  }

  closeAddModal() {
    this.showAddModal.set(false);
  }

  scheduleFromEventModal() {
    const day = this.selectedDay();
    this.closeEventModal();
    this.openAddModal(day?.dateStr);
  }

  async addHoliday() {
    if (this.holidayForm.invalid || this.isAdding()) return;

    this.isAdding.set(true);
    try {
      const { date, name } = this.holidayForm.value;
      await this.settingsService.addHoliday(date!, name!.trim());
      this.snackBar.open(`Holiday "${name}" added successfully.`, 'Close', { duration: 3000 });
      this.closeAddModal();
    } catch (e: any) {
      this.snackBar.open(e.message || 'Error adding holiday', 'Close', { duration: 4000 });
    } finally {
      this.isAdding.set(false);
    }
  }

  async deleteHoliday(dateId: string, name: string) {
    if (!confirm(`Are you sure you want to remove "${name}" on ${dateId}?`)) return;

    this.deletingId.set(dateId);
    try {
      await this.settingsService.deleteHoliday(dateId);
      this.snackBar.open('Holiday removed.', 'Close', { duration: 2500 });
      if (this.selectedDay()?.dateStr === dateId) {
        this.closeEventModal();
      }
    } catch (e: any) {
      this.snackBar.open(e.message || 'Error removing holiday', 'Close', { duration: 4000 });
    } finally {
      this.deletingId.set(null);
    }
  }
}
