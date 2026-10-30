import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SettingsService, DEFAULT_SETTINGS } from '../../../core/settings.service';
import { CompanySettings } from '../../../core/models';

@Component({
  selector: 'app-company-settings',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatCheckboxModule,
    MatSnackBarModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './company-settings.html'
})
export class CompanySettingsComponent implements OnInit {
  private fb = inject(FormBuilder);
  private settingsService = inject(SettingsService);
  private snackBar = inject(MatSnackBar);

  isSaving = signal(false);

  daysOfWeek = [
    { value: 0, label: 'Sunday' },
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' },
  ];

  selectedWeeklyOffs = signal<number[]>([0, 6]); // Sunday, Saturday

  settingsForm = this.fb.group({
    officeStart: ['10:10', Validators.required],
    officeEnd: ['19:30', Validators.required],
    graceMinutes: [10, [Validators.required, Validators.min(0)]],
    halfDayMinutes: [270, [Validators.required, Validators.min(60)]],
    fullDayMinutes: [540, [Validators.required, Validators.min(120)]],
    monthlyQuota: [1.5, [Validators.required, Validators.min(0)]],
    yearStartMonth: [1, [Validators.required, Validators.min(1), Validators.max(12)]]
  });

  ngOnInit() {
    this.settingsService.getSettings().subscribe(s => {
      this.settingsForm.patchValue({
        officeStart: s.officeStart || '10:10',
        officeEnd: s.officeEnd || '19:30',
        graceMinutes: s.graceMinutes ?? 10,
        halfDayMinutes: s.halfDayMinutes || 270,
        fullDayMinutes: s.fullDayMinutes || 540,
        monthlyQuota: s.monthlyQuota || 1.5,
        yearStartMonth: s.yearStartMonth || 1
      });

      this.selectedWeeklyOffs.set(s.weeklyOffs || [0, 6]);
    });
  }

  toggleDay(dayValue: number) {
    this.selectedWeeklyOffs.update(current => {
      if (current.includes(dayValue)) {
        return current.filter(d => d !== dayValue);
      } else {
        return [...current, dayValue].sort();
      }
    });
  }

  isDaySelected(dayValue: number): boolean {
    return this.selectedWeeklyOffs().includes(dayValue);
  }

  async saveSettings() {
    if (this.settingsForm.invalid || this.isSaving()) return;

    this.isSaving.set(true);
    try {
      const val = this.settingsForm.value;
      await this.settingsService.updateSettings({
        officeStart: val.officeStart!,
        officeEnd: val.officeEnd!,
        graceMinutes: Number(val.graceMinutes),
        halfDayMinutes: Number(val.halfDayMinutes),
        fullDayMinutes: Number(val.fullDayMinutes),
        monthlyQuota: Number(val.monthlyQuota),
        yearStartMonth: Number(val.yearStartMonth),
        weeklyOffs: this.selectedWeeklyOffs()
      });

      this.snackBar.open('Company attendance & leave settings saved!', 'Close', { duration: 3500 });
    } catch (e: any) {
      this.snackBar.open(e.message || 'Error saving settings', 'Close', { duration: 4000 });
    } finally {
      this.isSaving.set(false);
    }
  }
}
