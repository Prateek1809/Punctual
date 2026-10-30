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
import * as XLSX from 'xlsx';

export interface CalendarHolidayDay {
  dayNumber: number;
  dateStr: string;
  isCurrentMonth: boolean;
  isWeekend: boolean;
  isToday: boolean;
  isHoliday: boolean;
  holidayName?: string;
}

function parseExcelDate(val: any): string | null {
  if (val === null || val === undefined || val === '') return null;

  // Case 1: Numeric serial number (e.g. 46048 for 2026-01-26)
  if (typeof val === 'number') {
    const utcMs = Math.round((val - 25569) * 86400 * 1000);
    const d = new Date(utcMs);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // Case 2: Date object
  if (val instanceof Date) {
    const yyyy = val.getFullYear();
    const mm = String(val.getMonth() + 1).padStart(2, '0');
    const dd = String(val.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // Case 3: String
  const str = String(val).trim();
  if (/^\d{5}$/.test(str)) {
    const num = Number(str);
    const utcMs = Math.round((num - 25569) * 86400 * 1000);
    const d = new Date(utcMs);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const dmyMatch = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmyMatch) {
    const dd = dmyMatch[1].padStart(2, '0');
    const mm = dmyMatch[2].padStart(2, '0');
    const yyyy = dmyMatch[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

function resolveHolidayRow(row: any): { name: string; date: string } | null {
  if (!row || typeof row !== 'object') return null;

  let name = '';
  let dateRaw: any = null;

  for (const key of Object.keys(row)) {
    const k = key.toLowerCase().trim();
    if (k.includes('holiday') || k.includes('occasion') || k.includes('festival') || k.includes('event')) {
      name = String(row[key] || '').trim();
    } else if (k.includes('date')) {
      dateRaw = row[key];
    } else if (!name && (k.includes('name') || k.includes('title'))) {
      name = String(row[key] || '').trim();
    }
  }

  if (!name || dateRaw === null || dateRaw === undefined) {
    const values = Object.values(row);
    if (!name && typeof values[0] === 'string' && isNaN(Number(values[0]))) {
      name = String(values[0]).trim();
    }
    if (dateRaw === null && values[1] !== undefined) {
      dateRaw = values[1];
    }
  }

  const date = parseExcelDate(dateRaw);
  return (name && date) ? { name, date } : null;
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

  // Excel Import Signals
  showImportModal = signal(false);
  importedHolidays = signal<{ name: string; date: string }[]>([]);
  isImporting = signal(false);
  importFileName = signal('');

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
    if (!day.isCurrentMonth || (day.isWeekend && !day.isHoliday)) return;
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

  // Excel (.xlsx) Import Handling
  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    this.importFileName.set(file.name);

    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const buffer = e.target.result;
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rawRows = XLSX.utils.sheet_to_json(sheet);

        const parsedList: { name: string; date: string }[] = [];
        for (const row of rawRows) {
          const item = resolveHolidayRow(row);
          if (item && item.name && item.date) {
            parsedList.push(item);
          }
        }

        if (parsedList.length === 0) {
          this.snackBar.open(
            'No valid holidays found. Please verify column headers: "Holiday / Occasion" and "Date".',
            'Close',
            { duration: 5000 }
          );
          input.value = '';
          return;
        }

        // Sort by date ascending
        parsedList.sort((a, b) => a.date.localeCompare(b.date));

        this.importedHolidays.set(parsedList);
        this.showImportModal.set(true);
      } catch (err: any) {
        this.snackBar.open('Failed to read Excel file: ' + (err.message || 'Invalid format'), 'Close', {
          duration: 4000
        });
      } finally {
        input.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  }

  closeImportModal() {
    this.showImportModal.set(false);
    this.importedHolidays.set([]);
  }

  async confirmImport() {
    const list = this.importedHolidays();
    if (list.length === 0 || this.isImporting()) return;

    this.isImporting.set(true);
    try {
      let importedCount = 0;
      let sampleYear = this.selectedYear();

      for (const h of list) {
        await this.settingsService.addHoliday(h.date, h.name);
        importedCount++;
        const y = Number(h.date.split('-')[0]);
        if (!isNaN(y)) sampleYear = y;
      }

      this.selectedYear.set(sampleYear);
      this.snackBar.open(`Successfully imported ${importedCount} holidays!`, 'Close', { duration: 4000 });
      this.closeImportModal();
    } catch (e: any) {
      this.snackBar.open(e.message || 'Error importing holidays', 'Close', { duration: 4000 });
    } finally {
      this.isImporting.set(false);
    }
  }
}
