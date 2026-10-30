import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LocationService {
  getPosition(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
    return new Promise(resolve => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  }
}
