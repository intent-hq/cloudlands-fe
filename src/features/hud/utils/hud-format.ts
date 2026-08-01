/**
 * HUD digital-timer formatting — the mock's `fmt()`: zero-padded `HH:MM:SS`
 * from a seconds count (uptime ticker). Pure and NaN-safe. Digit-only output
 * (no localized words), so it is locale-neutral by construction.
 */

/** `4262` → `"01:11:02"`; negative/NaN clamp to `"00:00:00"`. */
export function formatHudTimer(totalSeconds: number): string {
  const sec = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** Mock's `ts()`: local wall-clock as zero-padded 24h `HH:MM:SS`. */
export function formatHudClock(epochMs: number): string {
  const date = new Date(Number.isFinite(epochMs) ? epochMs : 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
