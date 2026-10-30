import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule],
  template: `
    <div class="p-6 space-y-4">
      <h2 class="text-xl font-bold text-[#1F2937] dark:text-[#f8fafc] tracking-tight">{{ data.title }}</h2>
      <div class="p-4 rounded-xl bg-soft-bg shadow-soft-well-sm border border-slate-200/50 dark:border-slate-700/50 text-sm text-[#4B5563] dark:text-[#94a3b8]">
        <p>{{ data.message }}</p>
      </div>
      <div class="flex items-center justify-end gap-3 pt-2">
        <button type="button" class="soft-btn !py-2 !px-4 text-xs font-semibold text-[#4B5563] dark:text-[#94a3b8]" [mat-dialog-close]="false">
          Cancel
        </button>
        <button type="button" class="soft-btn-primary !py-2 !px-5 text-xs font-semibold" [mat-dialog-close]="true">
          Confirm
        </button>
      </div>
    </div>
  `
})
export class ConfirmDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<ConfirmDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { title: string, message: string }
  ) {}
}
