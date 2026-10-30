import { Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { inject } from '@angular/core';
import { CanActivateFn, Router, ActivatedRouteSnapshot } from '@angular/router';

export const roleGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  const auth = inject(Auth);
  const router = inject(Router);

  await auth.authStateReady();
  const user = auth.currentUser;

  if (!user) {
    router.navigate(['/login']);
    return false;
  }

  const idTokenResult = await user.getIdTokenResult();
  const role = idTokenResult.claims['role'];

  const expectedRole = route.data['role'];
  if (expectedRole === 'employee') {
    if (role !== 'employee') {
      router.navigate(['/dashboard']);
      return false;
    }
  } else if (expectedRole && expectedRole !== role && role !== 'admin') {
    router.navigate(['/dashboard']);
    return false;
  }

  return true;
};
