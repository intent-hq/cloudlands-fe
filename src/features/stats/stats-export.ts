/**
 * PNG export for the usage-stats cards.
 *
 * Mirrors the design reference's `exp()`: `html-to-image` renders the 360×640
 * card node at `pixelRatio: 3` (→ a 1080×1920 "story" PNG) and the data URL is
 * downloaded via a transient anchor — the browser download path, which works
 * inside Electron. Filenames follow `intent-<card>-<key>.png` where the key is
 * the period key, or `24h` in 24H mode (Spec D11 addendum).
 */
import { toPng } from 'html-to-image';
import type { StatsMode } from './stats-period';

/** Card identifiers used in export filenames (match `data-stats-card`). */
export type StatsCardName = 'passport' | 'models' | 'by-hour' | 'by-month';

/** Export dimensions from the design reference: 360×640 at 3× = 1080×1920. */
export const EXPORT_OPTIONS = { pixelRatio: 3, width: 360, height: 640 } as const;

/** Period key used in export filenames: `24h` in 24H mode (Spec D11). */
export function exportPeriodKey(mode: StatsMode, periodKey: string | null): string {
  if (mode === '24h') return '24h';
  return periodKey ?? mode;
}

/** `intent-<card>-<key>.png` per the task's Definition of Done. */
export function exportFileName(card: StatsCardName, key: string): string {
  return `intent-${card}-${key}.png`;
}

/**
 * Render `node` to a 1080×1920 PNG and trigger a download as `fileName`.
 * Rejects on render failure — callers surface the error non-fatally.
 */
export async function exportCardPng(node: HTMLElement, fileName: string): Promise<void> {
  const url = await toPng(node, EXPORT_OPTIONS);
  const anchor = document.createElement('a');
  anchor.download = fileName;
  anchor.href = url;
  anchor.click();
}
