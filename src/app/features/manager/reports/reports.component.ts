import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Firestore, collection, collectionData, query, where } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';
import { UserProfile, AttendanceRecord } from '../../../core/models';
import { Observable } from 'rxjs';
import * as XLSX from 'xlsx';

interface EmployeeReportRow {
  uid: string;
  name: string;
  email: string;
  presentDays: number;
  lateDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
  totalWorkedMinutes: number;
  totalWorkedHours: string;
  avgHoursPerDay: string;
}

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatFormFieldModule,
    MatSnackBarModule
  ],
  templateUrl: './reports.html'
})
export class ReportsComponent {
  private firestore = inject(Firestore);
  private snackBar = inject(MatSnackBar);

  selectedYear = signal(new Date().getFullYear());
  selectedMonth = signal(new Date().getMonth() + 1);
  selectedEmployeeUid = signal<string>('all');

  months = [
    { value: 1, name: 'January' },
    { value: 2, name: 'February' },
    { value: 3, name: 'March' },
    { value: 4, name: 'April' },
    { value: 5, name: 'May' },
    { value: 6, name: 'June' },
    { value: 7, name: 'July' },
    { value: 8, name: 'August' },
    { value: 9, name: 'September' },
    { value: 10, name: 'October' },
    { value: 11, name: 'November' },
    { value: 12, name: 'December' },
  ];

  // 1. All Users explicitly typed
  allUsers$ = collectionData(collection(this.firestore, 'users'), { idField: 'uid' }) as Observable<UserProfile[]>;
  allUsers = toSignal(this.allUsers$, { initialValue: [] });

  monthPrefix = computed(() => {
    const m = String(this.selectedMonth()).padStart(2, '0');
    return `${this.selectedYear()}-${m}`;
  });

  // 2. Monthly Attendance Records
  monthlyRecords$ = collectionData(
    query(
      collection(this.firestore, 'attendance'),
      where('date', '>=', `${this.monthPrefix()}-01`),
      where('date', '<=', `${this.monthPrefix()}-31`)
    ),
    { idField: 'id' }
  ) as Observable<AttendanceRecord[]>;
  monthlyRecords = toSignal(this.monthlyRecords$, { initialValue: [] });

  // 3. Compiled Table Rows
  reportRows = computed(() => {
    const users = this.allUsers().filter(u => u.isActive !== false && u.role === 'employee');
    const filterUid = this.selectedEmployeeUid();
    const targetUsers = filterUid === 'all' ? users : users.filter(u => u.uid === filterUid);

    const records = this.monthlyRecords();
    const rows: EmployeeReportRow[] = [];

    for (const u of targetUsers) {
      const uRecords = records.filter(r => r.uid === u.uid);

      let presentDays = 0;
      let lateDays = 0;
      let halfDays = 0;
      let absentDays = 0;
      let leaveDays = 0;
      let totalMins = 0;

      for (const r of uRecords) {
        if (r.status === 'present') presentDays++;
        else if (r.status === 'late') {
          lateDays++;
          presentDays++;
        } else if (r.status === 'half-day') halfDays++;
        else if (r.status === 'absent') absentDays++;
        else if (r.status === 'leave') leaveDays++;

        if (r.workedMinutes) totalMins += r.workedMinutes;
      }

      const totalH = (totalMins / 60).toFixed(1);
      const effectiveDays = presentDays + halfDays * 0.5;
      const avgH = effectiveDays > 0 ? (totalMins / 60 / effectiveDays).toFixed(1) : '0.0';

      rows.push({
        uid: u.uid,
        name: u.name,
        email: u.email,
        presentDays,
        lateDays,
        halfDays,
        absentDays,
        leaveDays,
        totalWorkedMinutes: totalMins,
        totalWorkedHours: `${totalH} hrs`,
        avgHoursPerDay: `${avgH} hrs`
      });
    }

    return rows;
  });

  // Summary Totals
  summaryTotals = computed(() => {
    const rows = this.reportRows();
    const totalPresent = rows.reduce((acc, r) => acc + r.presentDays, 0);
    const totalLate = rows.reduce((acc, r) => acc + r.lateDays, 0);
    const totalLeave = rows.reduce((acc, r) => acc + r.leaveDays, 0);
    const totalHoursNum = rows.reduce((acc, r) => acc + (r.totalWorkedMinutes / 60), 0);

    return {
      employeesCount: rows.length,
      totalPresent,
      totalLate,
      totalLeave,
      totalHours: totalHoursNum.toFixed(1)
    };
  });

  exportToExcel() {
    const rows = this.reportRows().map(r => ({
      'Employee Name': r.name,
      'Email': r.email,
      'Days Present': r.presentDays,
      'Late Marks': r.lateDays,
      'Half Days': r.halfDays,
      'Unexcused Absent': r.absentDays,
      'Leaves Taken': r.leaveDays,
      'Total Worked Hours': r.totalWorkedHours,
      'Avg Daily Hours': r.avgHoursPerDay
    }));

    if (rows.length === 0) {
      this.snackBar.open('No records to export', 'Close', { duration: 3000 });
      return;
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Attendance_${this.monthPrefix()}`);

    const fileName = `Punctual_Attendance_Report_${this.monthPrefix()}.xlsx`;
    XLSX.writeFile(wb, fileName);
    this.snackBar.open(`Exported report to ${fileName}`, 'Close', { duration: 3500 });
  }

  exportToCsv() {
    const rows = this.reportRows().map(r => ({
      'Employee Name': r.name,
      'Email': r.email,
      'Days Present': r.presentDays,
      'Late Marks': r.lateDays,
      'Half Days': r.halfDays,
      'Unexcused Absent': r.absentDays,
      'Leaves Taken': r.leaveDays,
      'Total Worked Hours': r.totalWorkedHours,
      'Avg Daily Hours': r.avgHoursPerDay
    }));

    if (rows.length === 0) {
      this.snackBar.open('No records to export', 'Close', { duration: 3000 });
      return;
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const csvOutput = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csvOutput], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Punctual_Attendance_Report_${this.monthPrefix()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.snackBar.open('CSV export downloaded.', 'Close', { duration: 3000 });
  }
}
