/**
 * Token Usage Utils
 *
 * Pure, dependency-light helpers for the daemon-owned token usage surface
 * (PROTOCOL §5.23). The local session-file scanning helpers were deleted with
 * the main-process scanner pipeline — usage accounting is daemon-internal.
 * No stores, services, or side effects.
 */

import type {
  TokenUsageCost,
  TokenUsageCrossFilterRow,
  TokenUsageTotals,
} from '../token-usage-types';

/** Bucket for token totals whose model name cannot be resolved. */
export const UNKNOWN_MODEL = 'unknown';

export function createEmptyTotals(): TokenUsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}

export type TokenUsageCategory = 'cached' | 'input' | 'output' | 'reasoning';

export interface TokenUsageCrossFilterSummary {
  totals: TokenUsageTotals;
  humanMessages: number;
  agentMessages: number;
}

function reducedCost(rows: TokenUsageCrossFilterRow[]): TokenUsageCost | undefined {
  const amounts = new Map<string, number>();
  for (const row of rows) {
    const cost = row.totals.cost;
    if (!cost) continue;
    amounts.set(cost.currency, (amounts.get(cost.currency) ?? 0) + cost.amount);
  }
  const winner = [...amounts.entries()].sort(
    ([currencyA, amountA], [currencyB, amountB]) =>
      amountB - amountA || currencyA.localeCompare(currencyB),
  )[0];
  return winner ? { currency: winner[0], amount: winner[1] } : undefined;
}

/** Reduce daemon-owned cells without deriving any missing cells or message origins. */
export function summarizeCrossFilterRows(
  rows: TokenUsageCrossFilterRow[],
  category?: TokenUsageCategory,
): TokenUsageCrossFilterSummary {
  const totals = createEmptyTotals();
  let thoughtTokens = 0;
  let humanMessages = 0;
  let agentMessages = 0;

  for (const row of rows) {
    humanMessages += row.humanMessages;
    agentMessages += row.agentMessages;
    if (!category || category === 'input') totals.inputTokens += row.totals.inputTokens;
    if (!category || category === 'output') totals.outputTokens += row.totals.outputTokens;
    if (!category || category === 'cached') {
      totals.cacheReadTokens += row.totals.cacheReadTokens;
      totals.cacheCreationTokens += row.totals.cacheCreationTokens;
    }
    if (!category || category === 'reasoning') thoughtTokens += row.totals.thoughtTokens ?? 0;
  }

  if (thoughtTokens > 0) totals.thoughtTokens = thoughtTokens;
  const cost = reducedCost(rows);
  if (cost) totals.cost = cost;
  return { totals, humanMessages, agentMessages };
}
