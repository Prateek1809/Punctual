import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Firestore, collection, collectionData, query, orderBy, limit } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuditLog } from '../../../core/models';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-audit-logs',
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
  templateUrl: './audit-logs.html'
})
export class AuditLogsComponent {
  private firestore = inject(Firestore);

  actionFilter = signal<string>('all');
  searchQuery = signal<string>('');

  // Audit logs query
  auditLogs$ = collectionData(
    query(
      collection(this.firestore, 'auditLogs'),
      orderBy('timestamp', 'desc'),
      limit(200)
    ),
    { idField: 'id' }
  ) as Observable<AuditLog[]>;
  auditLogs = toSignal(this.auditLogs$, { initialValue: [] });

  filteredLogs = computed(() => {
    const action = this.actionFilter();
    const q = this.searchQuery().toLowerCase().trim();

    return this.auditLogs().filter(log => {
      const matchesAction = action === 'all' || log.action === action;
      const matchesSearch =
        !q ||
        (log.actorName && log.actorName.toLowerCase().includes(q)) ||
        log.action.toLowerCase().includes(q) ||
        (log.targetId && log.targetId.toLowerCase().includes(q));

      return matchesAction && matchesSearch;
    });
  });

  getActionClass(action: string): string {
    switch (action) {
      case 'APPROVE_LEAVE':
      case 'APPROVE_REGULARIZATION':
      case 'APPROVE_FLAGGED_PUNCH':
        return 'bg-emerald-50 text-emerald-800 border-emerald-200';
      case 'REJECT_LEAVE':
      case 'REJECT_REGULARIZATION':
      case 'REJECT_FLAGGED_PUNCH':
        return 'bg-rose-50 text-rose-800 border-rose-200';
      case 'CANCEL_LEAVE':
        return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'ADMIN_CORRECT_ATTENDANCE':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'CREATE_EMPLOYEE':
      case 'UPDATE_EMPLOYEE':
        return 'bg-indigo-50 text-indigo-800 border-indigo-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  }

  formatJson(data: any): string {
    if (!data) return '—';
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }
}
