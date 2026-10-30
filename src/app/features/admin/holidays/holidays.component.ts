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
import { SettingsService } from '../../../core/settings.service';
import { Holiday } from '../../../core/models';
import { toSignal } from '@angular/core/rxjs-interop';

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
    MatProgressSpinnerModule
  ],
  templateUrl: './holidays.html'
})
export class HolidaysComponent {
  private fb = inject(FormBuilder);
  private settingsService = inject(SettingsService);
  private snackBar = inject(MatSnackBar);

  selectedYear = signal(new Date().getFullYear());
  isSeeding = signal(false);
  isAdding = signal(false);
  deletingId = signal<string | null>(null);

  // Holidays from Firestore
  holidays$ = this.settingsService.getHolidays();
  holidays = toSignal(this.holidays$, { initialValue: [] });

  filteredHolidays = computed(() => {
    const yStr = String(this.selectedYear());
    const list = this.holidays().filter(h => h.date.startsWith(yStr));
    return list.sort((a, b) => a.date.localeCompare(b.date));
  });

  holidayForm = this.fb.group({
    date: ['', Validators.required],
    name: ['', [Validators.required, Validators.minLength(2)]]
  });

  async addHoliday() {
    if (this.holidayForm.invalid || this.isAdding()) return;

    this.isAdding.set(true);
    try {
      const { date, name } = this.holidayForm.value;
      await this.settingsService.addHoliday(date!, name!.trim());
      this.snackBar.open(`Holiday "${name}" added successfully.`, 'Close', { duration: 3000 });
      this.holidayForm.reset();
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
    } catch (e: any) {
      this.snackBar.open(e.message || 'Error removing holiday', 'Close', { duration: 4000 });
    } finally {
      this.deletingId.set(null);
    }
  }

  async seedHolidays() {
    this.isSeeding.set(true);
    try {
      await this.settingsService.seedStandardHolidays(this.selectedYear());
      this.snackBar.open(`Standard holidays seeded for ${this.selectedYear()}!`, 'Close', { duration: 3500 });
    } catch (e: any) {
      this.snackBar.open(e.message || 'Error seeding holidays', 'Close', { duration: 4000 });
    } finally {
      this.isSeeding.set(false);
    }
  }
}
