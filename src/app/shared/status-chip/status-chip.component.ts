import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-status-chip',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium tracking-wide capitalize" [ngClass]="colorClass">
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
        return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
      case 'late':
        return 'bg-amber-50 text-amber-700 border border-amber-200';
      case 'half-day':
        return 'bg-orange-50 text-orange-700 border border-orange-200';
      case 'absent':
        return 'bg-rose-50 text-rose-700 border border-rose-200';
      case 'leave':
        return 'bg-blue-50 text-blue-700 border border-blue-200';
      case 'holiday':
        return 'bg-slate-100 text-slate-700 border border-slate-200';
      case 'pending':
      case 'pending_review':
        return 'bg-yellow-50 text-yellow-800 border border-yellow-200';
      case 'approved':
        return 'bg-teal-50 text-teal-700 border border-teal-200';
      case 'rejected':
        return 'bg-red-50 text-red-700 border border-red-200';
      case 'cancelled':
        return 'bg-gray-100 text-gray-600 border border-gray-200';
      default:
        return 'bg-gray-50 text-gray-700 border border-gray-200';
    }
  }

  get dotClass(): string {
    switch (this.status?.toLowerCase()) {
      case 'present': return 'bg-emerald-500';
      case 'late': return 'bg-amber-500';
      case 'half-day': return 'bg-orange-500';
      case 'absent': return 'bg-rose-500';
      case 'leave': return 'bg-blue-500';
      case 'holiday': return 'bg-slate-400';
      case 'pending':
      case 'pending_review': return 'bg-yellow-500';
      case 'approved': return 'bg-teal-500';
      case 'rejected': return 'bg-red-500';
      case 'cancelled': return 'bg-gray-400';
      default: return 'bg-gray-400';
    }
  }
}
