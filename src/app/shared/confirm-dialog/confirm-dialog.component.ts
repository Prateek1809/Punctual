import { Component, Inject, Injectable, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';

export interface ConfirmDialogData {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  icon?: string;
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="p-6 sm:p-7 space-y-5 animate-in fade-in zoom-in-95 max-w-md select-none">
      <!-- Icon & Header -->
      <div class="flex items-start gap-4">
        <div 
          class="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-soft-surface-sm border transition-all"
          [ngClass]="data.isDestructive 
            ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border-rose-200/80 dark:border-rose-900/60' 
            : 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border-blue-200/80 dark:border-blue-900/60'">
          <mat-icon class="!w-6 !h-6 !text-[24px]">
            {{ data.icon || (data.isDestructive ? 'warning' : 'help_outline') }}
          </mat-icon>
        </div>

        <div class="space-y-1.5 flex-1">
          <h2 class="text-lg sm:text-xl font-extrabold text-[#1F2937] dark:text-[#f8fafc] tracking-tight">
            {{ data.title || (data.isDestructive ? 'Confirm Action' : 'Please Confirm') }}
          </h2>
          <p class="text-xs sm:text-sm text-[#4B5563] dark:text-[#94a3b8] leading-relaxed">
            {{ data.message }}
          </p>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex items-center justify-end gap-3 pt-3 border-t border-slate-200/60 dark:border-slate-800">
        <button 
          type="button" 
          class="soft-btn !py-2.5 !px-4 text-xs font-semibold text-[#4B5563] dark:text-[#94a3b8] hover:text-[#1F2937]" 
          [mat-dialog-close]="false">
          {{ data.cancelText || 'Cancel' }}
        </button>

        <button 
          type="button" 
          class="soft-btn-primary !py-2.5 !px-5 text-xs font-bold" 
          [ngClass]="data.isDestructive ? '!bg-rose-600 hover:!bg-rose-700 shadow-rose-200 dark:shadow-none' : ''"
          [mat-dialog-close]="true">
          {{ data.confirmText || (data.isDestructive ? 'Yes, Proceed' : 'Confirm') }}
        </button>
      </div>
    </div>
  `
})
export class ConfirmDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<ConfirmDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ConfirmDialogData
  ) {}
}

@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  private dialog = inject(MatDialog);

  async confirm(options: ConfirmDialogData | string): Promise<boolean> {
    const data: ConfirmDialogData = typeof options === 'string'
      ? { message: options }
      : options;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data,
      width: '450px',
      maxWidth: '92vw',
      panelClass: 'confirm-dialog-panel',
      autoFocus: false,
      restoreFocus: true
    });

    return (await firstValueFrom(dialogRef.afterClosed())) ?? false;
  }
}
