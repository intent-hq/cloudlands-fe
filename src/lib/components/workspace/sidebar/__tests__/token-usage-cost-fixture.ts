import { parseTokenUsage } from '$features/token-usage/token-usage-schema';

/** Wire-valid cost-only cells, optionally alongside an unrelated token-bearing cell. */
export function costOnlyUsage(costAmount: number | undefined, mixed = false) {
  const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  const cost = costAmount === undefined ? {} : { cost: { amount: costAmount, currency: 'USD' } };
  const priced = { ...zero, ...cost };
  const tokens = { ...zero, inputTokens: 100 };
  return parseTokenUsage({
    totals: { ...(mixed ? tokens : zero), ...cost },
    byAgentId: { cost: priced, ...(mixed ? { tokens } : {}) },
    byModel: { 'cost-model': priced, ...(mixed ? { 'token-model': tokens } : {}) },
    byAgentModel: [
      {
        agentId: 'cost',
        model: 'cost-model',
        totals: priced,
        humanMessages: 0,
        agentMessages: 0,
      },
      ...(mixed
        ? [
            {
              agentId: 'tokens',
              model: 'token-model',
              totals: tokens,
              humanMessages: 0,
              agentMessages: 0,
            },
          ]
        : []),
    ],
    lastScanAt: '2026-09-22T00:00:00Z',
  });
}
