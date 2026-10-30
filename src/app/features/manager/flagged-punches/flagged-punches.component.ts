import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatInputModule } from '@angular/material/input';
import { Firestore, collection, collectionData, query, where } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { toSignal } from '@angular/core/rxjs-interop';
import { AttendanceRecord, UserProfile } from '../../../core/models';
import { formatTime12h } from '../../../core/date-utils';
import { map, Observable } from 'rxjs';

@Component({
  selector: 'app-flagged-punches',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatInputModule
  ],
  templateUrl: './flagged-punches.html'
})
export class FlaggedPunchesComponent {
  private firestore = inject(Firestore);
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);

  processingId = signal<string | null>(null);
  activePunch = signal<{ id: string; action: 'approve' | 'reject'; name: string } | null>(null);
  managerComment = signal('');

  // 1. All Users
  allUsers$ = collectionData(collection(this.firestore, 'users'), { idField: 'uid' }) as Observable<UserProfile[]>;
  allUsers = toSignal(this.allUsers$, { initialValue: [] });

  getUser(uid: string): UserProfile | undefined {
    return this.allUsers().find(u => u.uid === uid);
  }

  // 2. Flagged Punches (reviewStatus == 'pending')
  flaggedPunches$ = collectionData(
    query(collection(this.firestore, 'attendance'), where('reviewStatus', '==', 'pending')),
    { idField: 'id' }
  ).pipe(
    map(list => {
      const arr = list as AttendanceRecord[];
      return arr.sort((a, b) => (b.checkIn || '').localeCompare(a.checkIn || ''));
    })
  ) as Observable<AttendanceRecord[]>;
  flaggedPunches = toSignal(this.flaggedPunches$, { initialValue: [] });

  promptDecision(id: string, action: 'approve' | 'reject', name: string) {
    this.activePunch.set({ id, action, name });
    this.managerComment.set('');
  }

  closeDialog() {
    this.activePunch.set(null);
    this.managerComment.set('');
  }

  async confirmDecision() {
    const punch = this.activePunch();
    if (!punch) return;

    this.processingId.set(punch.id);
    const comment = this.managerComment().trim();

    try {
      const reviewFn = httpsCallable(this.functions, 'reviewPunch');
      await reviewFn({
        attendanceId: punch.id,
        action: punch.action,
        comment
      });
      this.snackBar.open(`Punch ${punch.action}d successfully.`, 'Close', { duration: 3500 });
      this.closeDialog();
    } catch (e: any) {
      this.snackBar.open(e.message || 'Error processing punch', 'Close', { duration: 4000 });
    } finally {
      this.processingId.set(null);
    }
  }

  formatTime(iso?: string): string {
    return formatTime12h(iso);
  }
}
