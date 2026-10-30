import { Routes } from '@angular/router';
import { roleGuard } from './core/role.guard';
import { setupGuard } from './core/setup.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'setup',
    canActivate: [setupGuard],
    loadComponent: () =>
      import('./features/setup/setup-wizard.component').then(m => m.SetupWizardComponent),
  },
  {
    path: 'login',
    canActivate: [setupGuard],
    loadComponent: () =>
      import('./features/auth/login/login.component').then(m => m.LoginComponent),
  },
  {
    path: '',
    loadComponent: () =>
      import('./features/layout/shell/shell.component').then(m => m.ShellComponent),
    canActivate: [roleGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard/dashboard.component').then(m => m.DashboardComponent),
      },
      {
        path: 'attendance',
        loadComponent: () =>
          import('./features/attendance/my-attendance/my-attendance.component').then(
            m => m.MyAttendanceComponent
          ),
        data: { role: 'employee' },
      },
      {
        path: 'leaves',
        loadComponent: () =>
          import('./features/leaves/apply-leave/apply-leave.component').then(
            m => m.ApplyLeaveComponent
          ),
        data: { role: 'employee' },
      },

      // Manager Routes
      {
        path: 'manager/approvals',
        loadComponent: () =>
          import('./features/manager/pending-approvals/pending-approvals.component').then(
            m => m.PendingApprovalsComponent
          ),
        data: { role: 'manager' },
      },
      {
        path: 'manager/team-attendance',
        loadComponent: () =>
          import('./features/manager/team-attendance/team-attendance.component').then(
            m => m.TeamAttendanceComponent
          ),
        data: { role: 'manager' },
      },
      {
        path: 'manager/team-calendar',
        loadComponent: () =>
          import('./features/manager/team-calendar/team-calendar.component').then(
            m => m.TeamCalendarComponent
          ),
        data: { role: 'manager' },
      },
      {
        path: 'manager/flagged-punches',
        loadComponent: () =>
          import('./features/manager/flagged-punches/flagged-punches.component').then(
            m => m.FlaggedPunchesComponent
          ),
        data: { role: 'manager' },
      },
      {
        path: 'manager/reports',
        loadComponent: () =>
          import('./features/manager/reports/reports.component').then(
            m => m.ReportsComponent
          ),
        data: { role: 'manager' },
      },

      // Admin Routes
      {
        path: 'admin/employees',
        loadComponent: () =>
          import('./features/admin/employees/employees.component').then(
            m => m.EmployeesComponent
          ),
        data: { role: 'admin' },
      },
      {
        path: 'admin/add-employee',
        redirectTo: 'admin/employees',
        pathMatch: 'full',
      },
      {
        path: 'admin/attendance-policy',
        loadComponent: () =>
          import('./features/admin/attendance-policy/attendance-policy.component').then(
            m => m.AttendancePolicyComponent
          ),
        data: { role: 'admin' },
      },
      {
        path: 'admin/settings',
        loadComponent: () =>
          import('./features/admin/company-settings/company-settings.component').then(
            m => m.CompanySettingsComponent
          ),
        data: { role: 'admin' },
      },
      {
        path: 'admin/holidays',
        loadComponent: () =>
          import('./features/admin/holidays/holidays.component').then(
            m => m.HolidaysComponent
          ),
        data: { role: 'admin' },
      },
      {
        path: 'admin/corrections',
        loadComponent: () =>
          import('./features/admin/corrections/corrections.component').then(
            m => m.CorrectionsComponent
          ),
        data: { role: 'admin' },
      },
      {
        path: 'admin/audit-logs',
        loadComponent: () =>
          import('./features/admin/audit-logs/audit-logs.component').then(
            m => m.AuditLogsComponent
          ),
        data: { role: 'admin' },
      },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
