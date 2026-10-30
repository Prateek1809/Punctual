import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { AuthService } from '../../../core/auth.service';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatBadgeModule } from '@angular/material/badge';
import { Firestore, collection, collectionData, query, where } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';
import { getISTTimeString, getISTDateFormatted } from '../../../core/date-utils';
import { filter } from 'rxjs';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatIconModule,
    MatButtonModule,
    MatSidenavModule,
    MatListModule,
    MatMenuModule,
    MatTooltipModule,
    MatBadgeModule
  ],
  templateUrl: './shell.html',
  styleUrls: ['./shell.css']
})
export class ShellComponent {
  public authService = inject(AuthService);
  private router = inject(Router);
  private firestore = inject(Firestore);

  sidebarOpen = signal(true);
  isDarkMode = signal(false);
  currentTime = signal(getISTTimeString());
  currentDateFormatted = signal(getISTDateFormatted());

  userProfile = this.authService.userProfile;
  currentRole = this.authService.currentRole;

  isManagerOrAdmin = computed(() => {
    const r = this.currentRole();
    return r === 'manager' || r === 'admin';
  });

  isAdmin = computed(() => this.currentRole() === 'admin');
  isManager = computed(() => this.currentRole() === 'manager');
  isEmployee = computed(() => this.currentRole() === 'employee');

  // Pending leave requests count for manager badge
  private pendingLeaves$ = collectionData(
    query(collection(this.firestore, 'leaveRequests'), where('status', '==', 'pending'))
  );
  pendingLeavesCount = toSignal(this.pendingLeaves$, { initialValue: [] });

  // Flagged punches count for manager badge
  private flaggedPunches$ = collectionData(
    query(collection(this.firestore, 'attendance'), where('reviewStatus', '==', 'pending'))
  );
  flaggedPunchesCount = toSignal(this.flaggedPunches$, { initialValue: [] });

  userInitials = computed(() => {
    const name = this.userProfile()?.name || this.authService.user()?.displayName || 'User';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  });

  constructor() {
    // Theme initialization
    const savedTheme = localStorage.getItem('punctual_theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
    if (isDark) {
      this.isDarkMode.set(true);
      document.documentElement.classList.add('dark');
      document.body.classList.add('dark');
    } else {
      this.isDarkMode.set(false);
      document.documentElement.classList.remove('dark');
      document.body.classList.remove('dark');
    }

    // Clock update interval
    setInterval(() => {
      this.currentTime.set(getISTTimeString());
      this.currentDateFormatted.set(getISTDateFormatted());
    }, 1000);

    // Auto collapse sidebar on mobile route change
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      if (window.innerWidth < 1024) {
        this.sidebarOpen.set(false);
      }
    });

    if (window.innerWidth < 1024) {
      this.sidebarOpen.set(false);
    }
  }

  toggleSidebar() {
    this.sidebarOpen.update(v => !v);
  }

  toggleDarkMode() {
    this.isDarkMode.update(v => !v);
    if (this.isDarkMode()) {
      document.documentElement.classList.add('dark');
      document.body.classList.add('dark');
      localStorage.setItem('punctual_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.body.classList.remove('dark');
      localStorage.setItem('punctual_theme', 'light');
    }
  }

  async logout() {
    await this.authService.logout();
    this.router.navigate(['/login']);
  }
}
