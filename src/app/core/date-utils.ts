/**
 * Utility functions for IST (Asia/Kolkata) date/time calculations
 */

export function getISTNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

export function getISTDateString(date: Date = new Date()): string {
  const istDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const year = istDate.getFullYear();
  const month = String(istDate.getMonth() + 1).padStart(2, '0');
  const day = String(istDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getISTDateFormatted(date: Date = new Date()): string {
  const istDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  return istDate.toLocaleDateString('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
}

export function getISTTimeString(date: Date = new Date()): string {
  const istDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const hours24 = istDate.getHours();
  const ampm = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  const hoursStr = String(hours12).padStart(2, '0');
  const minutes = String(istDate.getMinutes()).padStart(2, '0');
  return `${hoursStr}:${minutes} ${ampm}`;
}

export function formatTime12h(isoOrTimeStr?: string): string {
  if (!isoOrTimeStr) return '--:--';
  let date: Date;
  if (isoOrTimeStr.includes('T') || isoOrTimeStr.includes('-')) {
    date = new Date(isoOrTimeStr);
  } else if (isoOrTimeStr.includes(':')) {
    const [h, m] = isoOrTimeStr.split(':').map(Number);
    date = new Date();
    date.setHours(h, m, 0, 0);
  } else {
    return isoOrTimeStr;
  }

  return date.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

export function formatDuration(minutes: number = 0): string {
  if (minutes <= 0) return '0h 0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

/**
 * Calculates working days between startDate and endDate (inclusive),
 * skipping configured weeklyOffs (0=Sun, 6=Sat) and holidays (list of YYYY-MM-DD).
 * If isHalfDay is true and working day count is >= 1, subtracts 0.5.
 */
export function calculateWorkingDays(
  startDateStr: string,
  endDateStr: string,
  isHalfDay: boolean = false,
  holidays: string[] = [],
  weeklyOffs: number[] = [0, 6] // Sun, Sat
): number {
  if (!startDateStr || !endDateStr) return 0;

  const start = new Date(startDateStr);
  const end = new Date(endDateStr);

  if (start > end) return 0;

  const holidaySet = new Set(holidays);
  let workingDays = 0;

  const curr = new Date(start);
  while (curr <= end) {
    const dayOfWeek = curr.getDay();
    const dateStr = curr.toISOString().split('T')[0];

    // Check if weekend or holiday
    const isWeekend = weeklyOffs.includes(dayOfWeek);
    const isHoliday = holidaySet.has(dateStr);

    if (!isWeekend && !isHoliday) {
      workingDays++;
    }

    curr.setDate(curr.getDate() + 1);
  }

  if (isHalfDay && workingDays > 0) {
    return Math.max(0.5, workingDays - 0.5);
  }

  return workingDays;
}

/**
 * Returns an array of YYYY-MM-DD date strings between startStr and endStr inclusive.
 */
export function getDatesInRange(startStr: string, endStr: string): string[] {
  const dates: string[] = [];
  if (!startStr || !endStr) return dates;
  const [sy, sm, sd] = startStr.split('-').map(Number);
  const [ey, em, ed] = endStr.split('-').map(Number);
  const curr = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  while (curr <= end) {
    const y = curr.getFullYear();
    const m = String(curr.getMonth() + 1).padStart(2, '0');
    const d = String(curr.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    curr.setDate(curr.getDate() + 1);
  }
  return dates;
}

