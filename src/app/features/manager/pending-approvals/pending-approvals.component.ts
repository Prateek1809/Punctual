import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatInputModule } from '@angular/material/input';
import { Firestore, collection, collectionData, query, where } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { toSignal } from '@angular/core/rxjs-interop';
import { LeaveRequest, RegularizationRequest, UserProfile } from '../../../core/models';
import { StatusChipComponent } from '../../../shared/status-chip/status-chip.component';
import { map } from 'rxjs';

@Component({
  selector: 'app-pending-approvals',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatDialogModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatInputModule
  ],
  templateUrl: './pending-approvals.html',
  styleUrls: ['./pending-approvals.css']
})
export class PendingApprovalsComponent {
  private firestore = inject(Firestore);
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);

  selectedTab = signal(0);
  processingId = signal<string | null>(null);

  // Dialog state for comment
  activeRequest = signal<{ id: string; type: 'leave' | 'reg'; action: 'approve' | 'reject'; name: string } | null>(null);
  managerComment = signal('');

  // 1. All Users map for displaying employee names & avatars
  allUsers$ = collectionData(collection(this.firestore, 'users'), { idField: 'uid' });
  allUsers = toSignal(this.allUsers$, { initialValue: [] });

  getUserName(uid: string, fallback?: string): string {
    const u = (this.allUsers() as UserProfile[]).find(x => x.uid === uid);
    return u?.name || fallback || 'Employee';
  }

  getUserInitials(uid: string, fallback?: string): string {
    const name = this.getUserName(uid, fallback);
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  // 2. Pending Leaves
  pendingLeaves$ = collectionData(
    query(collection(this.firestore, 'leaveRequests'), where('status', '==', 'pending')),
    { idField: 'id' }
  ).pipe(
    map(list => {
      const arr = list as LeaveRequest[];
      return arr.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    })
  );
  pendingLeaves = toSignal(this.pendingLeaves$, { initialValue: [] });

  // 3. Pending Regularizations
  pendingRegs$ = collectionData(
    query(collection(this.firestore, 'regularizations'), where('status', '==', 'pending')),
    { idField: 'id' }
  ).pipe(
    map(list => {
      const arr = list as RegularizationRequest[];
      return arr.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    })
  );
  pendingRegs = toSignal(this.pendingRegs$, { initialValue: [] });

  promptAction(id: string, type: 'leave' | 'reg', action: 'approve' | 'reject', name: string) {
    this.activeRequest.set({ id, type, action, name });
    this.managerComment.set('');
  }

  closeActionDialog() {
    this.activeRequest.set(null);
    this.managerComment.set('');
  }

  async confirmAction() {
    const req = this.activeRequest();
    if (!req) return;

    this.processingId.set(req.id);
    const comment = this.managerComment().trim();

    try {
      if (req.type === 'leave') {
        const fnName = req.action === 'approve' ? 'approveLeave' : 'rejectLeave';
        const callable = httpsCallable(this.functions, fnName);
        await callable({ requestId: req.id, comment });
        this.snackBar.open(`Leave request ${req.action}d successfully.`, 'Close', { duration: 3500 });
      } else {
        const callable = httpsCallable(this.functions, 'reviewRegularization');
        await callable({ regularizationId: req.id, action: req.action, comment });
        this.snackBar.open(`Regularization request ${req.action}d successfully.`, 'Close', { duration: 3500 });
      }
      this.closeActionDialog();
    } catch (e: any) {
      this.snackBar.open(e.message || 'Error executing action', 'Close', { duration: 4000 });
    } finally {
      this.processingId.set(null);
    }
  }
}
