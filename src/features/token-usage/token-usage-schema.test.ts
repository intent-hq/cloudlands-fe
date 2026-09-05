import { describe, expect, it } from 'vitest';
import { TokenUsageSchema } from './token-usage-schema';

const totals = {
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 3,
  cacheCreationTokens: 4,
};

function usageWith(byAgentModel?: unknown) {
  return {
    byAgentId: { 'agent-a': totals },
    totals,
    byModel: { 'model-a': totals },
    ...(byAgentModel === undefined ? {} : { byAgentModel }),
    lastScanAt: '2026-08-24T00:00:00Z',
  };
}

describe('TokenUsageSchema', () => {
  it('accepts the exact optional cross-filter row shape', () => {
    const row = {
      agentId: 'agent-a',
      model: 'model-a',
      totals: { ...totals, cost: { amount: 0.5, currency: 'USD' } },
      humanMessages: 3,
      agentMessages: 4,
    };

    expect(TokenUsageSchema.parse(usageWith([row])).byAgentModel).toEqual([row]);
  });

  it('preserves legacy absence instead of inventing an empty matrix', () => {
    expect(TokenUsageSchema.parse(usageWith())).not.toHaveProperty('byAgentModel');
    expect(TokenUsageSchema.parse(usageWith([]))).toHaveProperty('byAgentModel', []);
  });

  it('rejects malformed, duplicate, or unsorted cross-filter rows', () => {
    const row = {
      agentId: 'agent-a',
      model: 'model-b',
      totals,
      humanMessages: 0,
      agentMessages: 1,
    };
    expect(() => TokenUsageSchema.parse(usageWith([{ ...row, humanMessages: -1 }]))).toThrow();
    expect(() => TokenUsageSchema.parse(usageWith([row, row]))).toThrow();
    expect(() => TokenUsageSchema.parse(usageWith([row, { ...row, model: 'model-a' }]))).toThrow();
  });
});
