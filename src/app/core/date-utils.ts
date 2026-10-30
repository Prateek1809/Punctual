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

export function getISTTimeString(date: Date = new Date()): string {
  const istDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const hours = String(istDate.getHours()).padStart(2, '0');
  const minutes = String(istDate.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
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
