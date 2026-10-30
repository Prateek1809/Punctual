import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-add-employee',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatInputModule, MatButtonModule],
  templateUrl: './add-employee.html',
  styleUrls: ['./add-employee.css']
})
export class AddEmployeeComponent {
  private fb = inject(FormBuilder);
  private functions = inject(Functions);
  private snackBar = inject(MatSnackBar);

  employeeForm = this.fb.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  async onSubmit() {
    if (this.employeeForm.valid) {
      try {
        const createEmpFn = httpsCallable(this.functions, 'createEmployee');
        await createEmpFn(this.employeeForm.value);
        this.snackBar.open('Employee created successfully', 'Close', { duration: 3000 });
        this.employeeForm.reset();
      } catch (e: any) {
        this.snackBar.open(e.message, 'Close', { duration: 3000 });
      }
    }
  }
}
