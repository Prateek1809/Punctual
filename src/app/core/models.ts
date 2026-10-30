export type UserRole = 'employee' | 'manager' | 'admin';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  managerId?: string | null;
  joinDate: string;
  isActive: boolean;
  fcmToken?: string;
}

export type AttendanceStatus = 'present' | 'late' | 'half-day' | 'absent' | 'leave';
export type ReviewStatus = 'none' | 'pending' | 'approved' | 'rejected';

export interface PunchMeta {
  ip?: string;
  lat?: number;
  lng?: number;
  accuracy?: number;
  distanceM?: number;
  ipMatched?: boolean;
  geoMatched?: boolean;
  verified?: boolean;
  method?: string;
  userAgent?: string;
  time?: string;
}

export interface AttendanceRecord {
  id: string; // uid_YYYY-MM-DD
  uid: string;
  date: string; // YYYY-MM-DD
  checkIn: string; // ISO string
  checkOut?: string; // ISO string
  workedMinutes?: number;
  status: AttendanceStatus;
  note?: string;
  punchInMeta?: PunchMeta;
  punchOutMeta?: PunchMeta;
  reviewStatus: ReviewStatus;
}

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveRequest {
  id: string;
  uid: string;
  userName?: string;
  userEmail?: string;
  leaveTypeId: string;
  startDate: string; // YYYY-MM-DD
  startTime?: string | null; // HH:mm or time string (optional)
  endDate: string; // YYYY-MM-DD
  isHalfDay: boolean;
  halfDayType?: 'first_half' | 'second_half' | null;
  days: number;
  reason: string;
  status: LeaveStatus;
  decidedBy?: string;
  decidedByName?: string;
  managerComment?: string;
  createdAt: string;
  decidedAt?: string;
  editedBy?: string;
  editedByName?: string;
  editedAt?: string;
}

export interface LeaveBalance {
  uid: string;
  year: string;
  balances: {
    unified: {
      allotted: number;
      used: number;
    };
  };
}

export interface RegularizationRequest {
  id: string;
  uid: string;
  userName?: string;
  date: string; // YYYY-MM-DD
  requestedIn: string; // HH:mm or ISO
  requestedOut: string; // HH:mm or ISO
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy?: string;
  comment?: string;
  createdAt: string;
  decidedAt?: string;
}

export interface Holiday {
  id: string; // YYYY-MM-DD
  date: string;
  name: string;
}

export interface OfficeLocation {
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
}

export type AttendancePolicyMode = 'off' | 'ip' | 'geo' | 'either' | 'both';
export type AttendanceOnFailure = 'block' | 'flag';

export interface AttendancePolicy {
  mode: AttendancePolicyMode;
  onFailure: AttendanceOnFailure;
  allowedIps: string[];
  maxAccuracyM: number;
  offices: OfficeLocation[];
}

export interface CompanySettings {
  officeStart: string; // e.g. "10:10"
  officeEnd: string; // e.g. "19:30"
  graceMinutes: number; // e.g. 10
  weeklyOffs: number[]; // e.g. [0, 6] (Sunday, Saturday)
  halfDayMinutes: number; // e.g. 270 (4.5h)
  fullDayMinutes: number; // e.g. 540 (9h)
  yearStartMonth: number; // 1 (January)
  monthlyQuota: number; // 1.5
  attendancePolicy: AttendancePolicy;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  actorName?: string;
  action: string;
  targetId: string;
  before?: any;
  after?: any;
  timestamp: string;
}
