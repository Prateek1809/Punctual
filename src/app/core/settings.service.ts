import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docData, collection, collectionData, setDoc, deleteDoc } from '@angular/fire/firestore';
import { Observable, map, of } from 'rxjs';
import { CompanySettings, Holiday } from './models';

export const DEFAULT_SETTINGS: CompanySettings = {
  officeStart: '',
  officeEnd: '',
  graceMinutes: 0,
  weeklyOffs: [0, 6], // Sunday, Saturday
  halfDayMinutes: 240, // 4 hours
  fullDayMinutes: 480, // 8 hours
  yearStartMonth: 1,
  monthlyQuota: 1.5,
  attendancePolicy: {
    mode: 'either',
    onFailure: 'flag',
    allowedIps: [],
    maxAccuracyM: 300,
    offices: []
  }
};

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private firestore = inject(Firestore);

  getSettings(): Observable<CompanySettings> {
    const docRef = doc(this.firestore, 'settings/company');
    return docData(docRef).pipe(
      map(data => {
        if (!data) return DEFAULT_SETTINGS;
        return {
          ...DEFAULT_SETTINGS,
          ...data,
          attendancePolicy: {
            ...DEFAULT_SETTINGS.attendancePolicy,
            ...(data['attendancePolicy'] || {})
          }
        } as CompanySettings;
      })
    );
  }

  async updateSettings(settings: Partial<CompanySettings>): Promise<void> {
    const docRef = doc(this.firestore, 'settings/company');
    await setDoc(docRef, settings, { merge: true });
  }

  getHolidays(): Observable<Holiday[]> {
    const colRef = collection(this.firestore, 'holidays');
    return collectionData(colRef, { idField: 'id' }) as Observable<Holiday[]>;
  }

  async addHoliday(date: string, name: string): Promise<void> {
    const docRef = doc(this.firestore, `holidays/${date}`);
    await setDoc(docRef, { date, name });
  }

  async deleteHoliday(dateId: string): Promise<void> {
    const docRef = doc(this.firestore, `holidays/${dateId}`);
    await deleteDoc(docRef);
  }
}
