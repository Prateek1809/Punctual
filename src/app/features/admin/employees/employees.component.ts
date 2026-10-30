import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Firestore, collection, collectionData } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { toSignal } from '@angular/core/rxjs-interop';
import { UserProfile, UserRole } from '../../../core/models';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-employees',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatDialogModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatTooltipModule
  ],
  templateUrl: './employees.html'
})
export class EmployeesComponent {
  private fb = inject(FormBuilder);
  private firestore = inject(Firestore);
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);

  searchQuery = signal('');
  roleFilter = signal<string>('all');

  showAddModal = signal(false);
  isCreating = signal(false);

  editingUser = signal<UserProfile | null>(null);
  isUpdating = signal(false);
  togglingUid = signal<string | null>(null);

  // All Users
  users$ = collectionData(collection(this.firestore, 'users'), { idField: 'uid' }) as Observable<UserProfile[]>;
  users = toSignal(this.users$, { initialValue: [] });

  // Managers for dropdown
  managers = computed(() => {
    return this.users().filter(u => u.role === 'manager' || u.role === 'admin');
  });

  // Filtered Users
  filteredUsers = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const role = this.roleFilter();

    return this.users().filter(u => {
      const matchesSearch =
        !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
      const matchesRole = role === 'all' || u.role === role;
      return matchesSearch && matchesRole;
    });
  });

  // Form for Adding New Employee
  addForm = this.fb.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    role: ['employee' as UserRole, Validators.required],
    managerId: ['']
  });

  // Form for Editing Employee
  editForm = this.fb.group({
    name: ['', Validators.required],
    role: ['employee' as UserRole, Validators.required],
    managerId: ['']
  });

  openAddModal() {
    this.addForm.reset({ role: 'employee', managerId: '' });
    this.showAddModal.set(true);
  }

  closeAddModal() {
    this.showAddModal.set(false);
  }

  async submitCreateEmployee() {
    if (this.addForm.invalid || this.isCreating()) return;

    this.isCreating.set(true);
    try {
      const createFn = httpsCallable(this.functions, 'createEmployee');
      await createFn(this.addForm.value);
      this.snackBar.open('Employee account created successfully!', 'Close', { duration: 4000 });
      this.closeAddModal();
    } catch (e: any) {
      this.snackBar.open(e.message || 'Error creating employee', 'Close', { duration: 4000 });
    } finally {
      this.isCreating.set(false);
    }
  }

  openEditModal(user: UserProfile) {
    this.editingUser.set(user);
    this.editForm.patchValue({
      name: user.name,
      role: user.role,
      managerId: user.managerId || ''
    });
  }

  closeEditModal() {
    this.editingUser.set(null);
  }

  async submitUpdateEmployee() {
    const u = this.editingUser();
    if (!u || this.editForm.invalid || this.isUpdating()) return;

    this.isUpdating.set(true);
    try {
      const updateFn = httpsCallable(this.functions, 'updateEmployee');
      await updateFn({
        uid: u.uid,
        ...this.editForm.value
      });
      this.snackBar.open('Employee profile updated!', 'Close', { duration: 3500 });
      this.closeEditModal();
    } catch (e: any) {
      this.snackBar.open(e.message || 'Error updating employee', 'Close', { duration: 4000 });
    } finally {
      this.isUpdating.set(false);
    }
  }

  async toggleUserActive(user: UserProfile) {
    const action = user.isActive ? 'deactivate' : 'activate';
    if (!confirm(`Are you sure you want to ${action} ${user.name}?`)) return;

    this.togglingUid.set(user.uid);
    try {
      const updateFn = httpsCallable(this.functions, 'updateEmployee');
      await updateFn({
        uid: user.uid,
        isActive: !user.isActive
      });
      this.snackBar.open(`Employee has been ${action}d.`, 'Close', { duration: 3500 });
    } catch (e: any) {
      this.snackBar.open(e.message || 'Error updating status', 'Close', { duration: 4000 });
    } finally {
      this.togglingUid.set(null);
    }
  }

  getManagerName(managerId?: string | null): string {
    if (!managerId) return '—';
    const m = this.users().find(u => u.uid === managerId);
    return m ? m.name : '—';
  }
}
