import { Injectable, inject, signal } from '@angular/core';
import {
  Auth,
  authState,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  User
} from '@angular/fire/auth';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, of, switchMap, map } from 'rxjs';
import { UserProfile, UserRole } from './models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private firestore = inject(Firestore);

  // Raw Firebase User
  user = toSignal(authState(this.auth));

  // User Profile from Firestore
  userProfile$: Observable<UserProfile | null> = authState(this.auth).pipe(
    switchMap(u => {
      if (!u) return of(null);
      const userRef = doc(this.firestore, `users/${u.uid}`);
      return docData(userRef).pipe(
        map(data => {
          if (!data) return null;
          return { uid: u.uid, ...data } as UserProfile;
        })
      );
    })
  );

  userProfile = toSignal(this.userProfile$, { initialValue: null });
  currentRole = signal<UserRole>('employee');

  constructor() {
    // Keep currentRole in sync
    authState(this.auth).subscribe(async u => {
      if (u) {
        try {
          const idToken = await u.getIdTokenResult(true);
          const claimRole = idToken.claims['role'] as UserRole;
          if (claimRole) {
            this.currentRole.set(claimRole);
          }
        } catch {
          // fallback
        }
      }
    });

    this.userProfile$.subscribe(profile => {
      if (profile && profile.role) {
        this.currentRole.set(profile.role);
      }
    });
  }

  async login(email: string, pass: string) {
    return signInWithEmailAndPassword(this.auth, email, pass);
  }

  async sendPasswordReset(email: string) {
    return sendPasswordResetEmail(this.auth, email);
  }

  logout() {
    return signOut(this.auth);
  }

  get currentUser(): User | null {
    return this.auth.currentUser;
  }
}
