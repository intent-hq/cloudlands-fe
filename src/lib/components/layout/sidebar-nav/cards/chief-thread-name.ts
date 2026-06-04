const MONTH_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'long' });

export function getOrdinalSuffix(day: number): string {
  const lastTwoDigits = day % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) return 'th';

  switch (day % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

export function formatChiefThreadName(date: Date): string {
  const month = MONTH_FORMATTER.format(date);
  const day = date.getDate();
  return `New thread ${month} ${day}${getOrdinalSuffix(day)}`;
}
