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
import { AuthService } from '../../../core/auth.service';
import { ConfirmDialogService } from '../../../shared/confirm-dialog/confirm-dialog.component';
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
  public auth = inject(AuthService);
  private confirmService = inject(ConfirmDialogService);

  searchQuery = signal('');
  roleFilter = signal<string>('all');
  statusFilter = signal<string>('all');

  currentUid = computed(() => this.auth.user()?.uid);
  currentUserRole = computed(() => this.auth.currentRole() || this.auth.userProfile()?.role || 'employee');
  isAdmin = computed(() => this.currentUserRole() === 'admin');
  isManager = computed(() => this.currentUserRole() === 'manager');

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

  // Filtered Users:
  // - Admin ko Manager aur Employees dikhenge (Admin accounts & khud excluded)
  // - Manager ko Admin aur vo khud nahi dikhenge (sirf Employees dikhenge)
  filteredUsers = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const status = this.statusFilter();
    const role = this.roleFilter();
    const myUid = this.currentUid();
    const myRole = this.currentUserRole();

    return this.users()
      .filter(u => {
        // Khud ko kabhi nahi dikhana
        if (u.uid === myUid) return false;

        if (myRole === 'admin') {
          // Admin ko manager aur employees dikhenge (admin accounts excluded)
          return u.role === 'employee' || u.role === 'manager';
        } else if (myRole === 'manager') {
          // Manager ko admin aur khud nahi dikhenge (sirf employees dikhenge)
          return u.role === 'employee';
        } else {
          return u.role === 'employee';
        }
      })
      .filter(u => {
        const matchesSearch =
          !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
        const matchesStatus =
          status === 'all' || (status === 'active' ? u.isActive !== false : u.isActive === false);
        const matchesRole =
          role === 'all' || u.role === role;
        return matchesSearch && matchesStatus && matchesRole;
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
    this.addForm.reset({ 
      role: 'employee', 
      managerId: this.isManager() ? (this.currentUid() || '') : '' 
    });
    this.showAddModal.set(true);
  }

  closeAddModal() {
    this.showAddModal.set(false);
  }

  async submitCreateEmployee() {
    if (this.addForm.invalid || this.isCreating()) return;

    this.isCreating.set(true);
    try {
      const formVal = this.addForm.value;
      const payload: any = {
        name: formVal.name,
        email: formVal.email,
        password: formVal.password,
        role: this.isAdmin() ? (formVal.role || 'employee') : 'employee',
        managerId: this.isAdmin() 
          ? (formVal.managerId || null) 
          : (formVal.managerId || this.currentUid() || null)
      };

      const createFn = httpsCallable(this.functions, 'createEmployee');
      await createFn(payload);
      this.snackBar.open('Employee account created successfully!', 'Close', { duration: 4000 });
      this.closeAddModal();
    } catch (e: any) {
      this.snackBar.open(e.message || 'Error creating employee', 'Close', { duration: 4000 });
    } finally {
      this.isCreating.set(false);
    }
  }

  openEditModal(user: UserProfile) {
    if (this.isManager() && user.role !== 'employee') {
      this.snackBar.open('Managers can only edit employee profiles.', 'Close', { duration: 3000 });
      return;
    }
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
      const formVal = this.editForm.value;
      const payload: any = {
        uid: u.uid,
        name: formVal.name,
        managerId: formVal.managerId || null
      };

      if (this.isAdmin()) {
        payload.role = formVal.role;
      } else {
        payload.role = 'employee';
      }

      const updateFn = httpsCallable(this.functions, 'updateEmployee');
      await updateFn(payload);
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
    const isDestructive = user.isActive;
    const confirmed = await this.confirmService.confirm({
      title: `${user.isActive ? 'Deactivate' : 'Activate'} Employee`,
      message: `Are you sure you want to ${action} ${user.name}? ${user.isActive ? 'They will no longer be able to log in or mark attendance.' : 'Their account access will be restored.'}`,
      confirmText: user.isActive ? 'Yes, Deactivate' : 'Yes, Activate',
      cancelText: 'Cancel',
      isDestructive,
      icon: user.isActive ? 'person_off' : 'person'
    });
    if (!confirmed) return;

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
