import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Functions, httpsCallable } from '@angular/fire/functions';

export const setupGuard: CanActivateFn = async (route) => {
  const functions = inject(Functions);
  const router = inject(Router);

  try {
    const checkFn = httpsCallable(functions, 'checkSetupRequired');
    const res = await checkFn();
    const data = res.data as { setupRequired: boolean };

    const isSetupRoute = route.routeConfig?.path === 'setup';

    if (data.setupRequired) {
      if (!isSetupRoute) {
        router.navigate(['/setup']);
        return false;
      }
      return true;
    } else {
      if (isSetupRoute) {
        router.navigate(['/login']);
        return false;
      }
      return true;
    }
  } catch {
    // If offline or check fails, allow access to normal routes
    return true;
  }
};
