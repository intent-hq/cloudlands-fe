/**
 * Compact number formatting (e.g. 1234 → "1.2K", 9264137 → "9.3M").
 * Pure utility — no stores, services, or side effects.
 */

const UNITS: Array<{ threshold: number; suffix: string }> = [
  { threshold: 1_000_000_000, suffix: 'B' },
  { threshold: 1_000_000, suffix: 'M' },
  { threshold: 1_000, suffix: 'K' },
];

/**
 * Format a number compactly with K/M/B suffixes.
 * Trailing ".0" is trimmed (98000 → "98K"); non-finite values format as "0".
 */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  for (let i = 0; i < UNITS.length; i++) {
    const { threshold, suffix } = UNITS[i];
    if (abs < threshold) continue;
    const rounded = (abs / threshold).toFixed(1);
    // Rounding can carry into the next order of magnitude (999_950 →
    // "1000.0K"); promote to the larger unit so it matches the rounded value.
    if (Number(rounded) >= 1000 && i > 0) {
      const larger = UNITS[i - 1];
      return `${sign}${(abs / larger.threshold).toFixed(1).replace(/\.0$/, '')}${larger.suffix}`;
    }
    return `${sign}${rounded.replace(/\.0$/, '')}${suffix}`;
  }
  return `${sign}${Math.round(abs)}`;
}

