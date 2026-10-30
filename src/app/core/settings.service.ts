import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docData, collection, collectionData, setDoc, deleteDoc } from '@angular/fire/firestore';
import { Observable, map, of } from 'rxjs';
import { CompanySettings, Holiday } from './models';

export const DEFAULT_SETTINGS: CompanySettings = {
  officeStart: '10:10',
  officeEnd: '19:30',
  graceMinutes: 10,
  weeklyOffs: [0, 6], // Sunday, Saturday
  halfDayMinutes: 270, // 4.5 hours
  fullDayMinutes: 540, // 9 hours
  yearStartMonth: 1,
  monthlyQuota: 1.5,
  attendancePolicy: {
    mode: 'either',
    onFailure: 'flag',
    allowedIps: ['127.0.0.1'],
    maxAccuracyM: 300,
    offices: [
      {
        name: 'Head Office',
        lat: 19.0760,
        lng: 72.8777,
        radiusM: 200
      }
    ]
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

  async seedStandardHolidays(year: number = new Date().getFullYear()): Promise<void> {
    const holidays = [
      { date: `${year}-01-26`, name: 'Republic Day' },
      { date: `${year}-03-25`, name: 'Holi' },
      { date: `${year}-04-14`, name: 'Ambedkar Jayanti' },
      { date: `${year}-05-01`, name: 'Maharashtra Day / May Day' },
      { date: `${year}-08-15`, name: 'Independence Day' },
      { date: `${year}-10-02`, name: 'Gandhi Jayanti' },
      { date: `${year}-10-20`, name: 'Dussehra' },
      { date: `${year}-11-01`, name: 'Diwali' },
      { date: `${year}-12-25`, name: 'Christmas Day' },
    ];

    for (const h of holidays) {
      await this.addHoliday(h.date, h.name);
    }
  }
}
