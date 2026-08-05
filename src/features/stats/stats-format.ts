/**
 * Pure display formatting + model ranking for the usage-stats cards.
 *
 * `formatTokens` mirrors the design's `fmt()` (B with 1–2 decimals, integer
 * M below 1B) and extends it downward (K / raw count) so small real-world
 * counts degrade gracefully instead of rendering "0M". All helpers are pure
 * and NaN-safe: a zero-data period renders zeroes, never NaN.
 */
import { selectProviderCatalogEntry } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { store as appStore } from '$store/renderer/store';
import type {
  UsageModelStats,
  UsageProviderStats,
  UsageTokenTotals,
} from '$lib/client/app-client';
import { formatInteger, formatNumber } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';

/** Sum of the 4 separate token counters (Spec D6). */
export function totalTokens(t: UsageTokenTotals): number {
  return t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheCreationTokens;
}

/** Abbreviate a raw token count like the design's fmt(): 12.3B / 2.41B / 241M / 12K. */
export function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '0';
  const b = count / 1e9;
  if (b >= 10) return `${b.toFixed(1)}B`;
  if (b >= 1) return `${b.toFixed(2)}B`;
  const m = Math.round(count / 1e6);
  if (m >= 1000) return `${b.toFixed(2)}B`;
  if (m >= 1) return `${m}M`;
  if (count >= 1000) {
    const k = Math.round(count / 1e3);
    return k >= 1000 ? '1M' : `${k}K`;
  }
  return String(Math.round(count));
}

/** "2h 14m" / "42m" longest-run duration (design's h/m format, padded minutes). */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return m.stats_format_durationMinutes_label({ minutes: 0 });
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return m.stats_format_durationMinutes_label({ minutes });
  return m.stats_format_durationHoursMinutes_label({
    hours,
    minutes: String(minutes).padStart(2, '0'),
  });
}

/** Thousands-separated integer in the active locale. */
export function formatInt(n: number): string {
  return formatInteger(n);
}

/** "61%" share label for a 0..1 fraction. */
export function formatShare(share: number): string {
  const value = Number.isFinite(share) && share > 0 ? share : 0;
  return formatNumber(value, { style: 'percent', maximumFractionDigits: 0 });
}

/** Share-bar / rank palette from the design (1st → 4th). */
export const MODEL_BAR_COLORS = [
  'hsl(158 100% 30%)',
  'hsl(158 60% 45%)',
  'hsl(158 35% 62%)',
  'hsl(240 5% 40%)',
] as const;

export interface RankedModel {
  model: string;
  /** Sum of the model's 4 token counters. */
  tokens: number;
  /** Fraction of the grand total across ALL models (not just the top 4). */
  share: number;
  runs: number;
}

/**
 * Top `limit` normalized models by total tokens (Spec D3). The daemon already
 * sorts `byModel` desc by total tokens; re-sorting here keeps the cards
 * correct regardless. Zero-token models are dropped so a short list degrades
 * gracefully; shares are fractions of the grand total across all models.
 */
export function rankModels(byModel: UsageModelStats[], limit = 4): RankedModel[] {
  const totals = byModel.map((m) => ({ model: m.model, runs: m.runs, tokens: totalTokens(m) }));
  const grand = totals.reduce((acc, m) => acc + m.tokens, 0);
  return totals
    .filter((m) => m.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, limit)
    .map((m) => ({ ...m, share: grand > 0 ? m.tokens / grand : 0 }));
}

export interface RankedProvider {
  /** Raw provider id as sent on the wire (`claude-code`, `codex`, …). */
  provider: string;
  /** Sum of the provider's 4 token counters. */
  tokens: number;
  /** Fraction of the grand total across ALL providers (not just the top 4). */
  share: number;
  runs: number;
}

/**
 * Top `limit` providers by total tokens — same total/share/sort semantics as
 * `rankModels` over the `byProvider` rollup. The daemon already sorts
 * `byProvider` desc by total tokens; re-sorting here keeps the card correct
 * regardless. Zero-token providers are dropped; shares are fractions of the
 * grand total across all providers.
 */
export function rankProviders(byProvider: UsageProviderStats[], limit = 4): RankedProvider[] {
  const totals = byProvider.map((p) => ({
    provider: p.provider,
    runs: p.runs,
    tokens: totalTokens(p),
  }));
  const grand = totals.reduce((acc, p) => acc + p.tokens, 0);
  return totals
    .filter((p) => p.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, limit)
    .map((p) => ({ ...p, share: grand > 0 ? p.tokens / grand : 0 }));
}

/**
 * Pretty-print a raw provider id (`claude-code` → "Claude Code") using the
 * daemon catalog's `shortName` (single source of truth), so new providers
 * pick up a short name automatically; `unknown` covers
 * pre-migration/unattributable usage and unrecognized ids pass through as-is.
 */
export function providerDisplayName(providerId: string): string {
  if (providerId === 'unknown') return 'Unknown';
  return (
    selectProviderCatalogEntry.select(appStore.state, providerId)?.shortName ?? providerId
  );
}
