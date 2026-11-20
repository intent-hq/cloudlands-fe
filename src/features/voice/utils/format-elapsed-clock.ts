import { formatNumber } from '$lib/i18n/format';

/** m:ss (h:mm:ss from one hour) with the canonical locale-aware number formatter. */
export function formatElapsedClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const two = (value: number) =>
    formatNumber(value, { minimumIntegerDigits: 2, useGrouping: false });
  const rest = two(seconds % 60);
  if (seconds < 3600)
    return `${formatNumber(Math.floor(seconds / 60), { useGrouping: false })}:${rest}`;
  const hours = formatNumber(Math.floor(seconds / 3600), { useGrouping: false });
  return `${hours}:${two(Math.floor(seconds / 60) % 60)}:${rest}`;
}
