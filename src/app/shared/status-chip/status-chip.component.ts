import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-status-chip',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide capitalize shadow-soft-surface-sm border transition-all" [ngClass]="colorClass">
      <span class="w-1.5 h-1.5 mr-1.5 rounded-full" [ngClass]="dotClass"></span>
      {{ label }}
    </span>
  `
})
export class StatusChipComponent {
  @Input() status: string = '';

  get label(): string {
    if (!this.status) return 'None';
    if (this.status === 'half-day') return 'Half Day';
    if (this.status === 'pending_review') return 'Under Review';
    return this.status.replace('_', ' ');
  }

  get colorClass(): string {
    switch (this.status?.toLowerCase()) {
      case 'present':
        return 'bg-emerald-50/80 dark:bg-emerald-950/40 text-[#15803D] dark:text-emerald-400 border-emerald-200/80 dark:border-emerald-800/60';
      case 'late':
        return 'bg-amber-50/80 dark:bg-amber-950/40 text-[#C2410C] dark:text-amber-400 border-amber-200/80 dark:border-amber-800/60';
      case 'half-day':
        return 'bg-orange-50/80 dark:bg-orange-950/40 text-[#C2410C] dark:text-orange-400 border-orange-200/80 dark:border-orange-800/60';
      case 'absent':
        return 'bg-rose-50/80 dark:bg-rose-950/40 text-rose-800 dark:text-rose-400 border-rose-200/80 dark:border-rose-800/60';
      case 'leave':
        return 'bg-blue-50/80 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border-blue-200/80 dark:border-blue-800/60';
      case 'holiday':
        return 'bg-purple-50/80 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400 border-purple-200/80 dark:border-purple-800/60';
      case 'pending':
      case 'pending_review':
        return 'bg-amber-50/80 dark:bg-amber-950/40 text-[#C2410C] dark:text-amber-400 border-amber-200/80 dark:border-amber-800/60';
      case 'approved':
        return 'bg-emerald-50/80 dark:bg-emerald-950/40 text-[#15803D] dark:text-emerald-400 border-emerald-200/80 dark:border-emerald-800/60';
      case 'rejected':
        return 'bg-rose-50/80 dark:bg-rose-950/40 text-rose-800 dark:text-rose-400 border-rose-200/80 dark:border-rose-800/60';
      case 'cancelled':
        return 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200/80 dark:border-slate-700';
      default:
        return 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200/80 dark:border-slate-700';
    }
  }

  get dotClass(): string {
    switch (this.status?.toLowerCase()) {
      case 'present': return 'bg-emerald-500';
      case 'late': return 'bg-amber-500';
      case 'half-day': return 'bg-orange-500';
      case 'absent': return 'bg-rose-500';
      case 'leave': return 'bg-blue-500';
      case 'holiday': return 'bg-purple-500';
      case 'pending':
      case 'pending_review': return 'bg-amber-500';
      case 'approved': return 'bg-emerald-500';
      case 'rejected': return 'bg-rose-500';
      case 'cancelled': return 'bg-slate-400';
      default: return 'bg-slate-400';
    }
  }
}
