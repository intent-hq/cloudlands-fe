import { describe, expect, it } from 'vitest';
import type { StoreState } from '../../types';
import type { TokenUsage } from '../../../../features/token-usage/token-usage-types';
import { TokenUsageSchema } from '../../../../features/token-usage/token-usage-schema';
import {
  selectWorkspaceTokenUsage,
  selectWorkspaceTokenUsageCrossFilterRows,
} from './token-usage-selectors';
import { emptyWorkspaceTokenUsageState } from './token-usage-types';
import {
  clearWorkspaceTokenUsage,
  initialState,
  tokenUsageReceived,
  tokenUsageReducer,
} from './token-usage-slice';

const totals = { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 };
const snapshot: TokenUsage = { byAgentId: {}, byModel: {}, totals, lastScanAt: null };
const root = (tokenUsage: ReturnType<typeof tokenUsageReducer>) => ({ tokenUsage }) as StoreState;

describe('token-usage-selectors', () => {
  it('distinguishes unknown, legacy, empty, and cleared workspace matrices', () => {
    expect(selectWorkspaceTokenUsage.select(root(initialState), 'missing')).toBe(
      emptyWorkspaceTokenUsageState,
    );
    expect(
      selectWorkspaceTokenUsageCrossFilterRows.select(root(initialState), 'missing'),
    ).toBeUndefined();
    const legacy = tokenUsageReducer(initialState, tokenUsageReceived('legacy', snapshot));
    const empty = tokenUsageReducer(
      legacy,
      tokenUsageReceived('empty', { ...snapshot, byAgentModel: [] }),
    );
    expect(selectWorkspaceTokenUsageCrossFilterRows.select(root(empty), 'legacy')).toBeUndefined();
    expect(selectWorkspaceTokenUsageCrossFilterRows.select(root(empty), 'empty')).toEqual([]);
    const cleared = tokenUsageReducer(empty, clearWorkspaceTokenUsage('empty'));
    expect(selectWorkspaceTokenUsageCrossFilterRows.select(root(cleared), 'empty')).toBeUndefined();
    expect(selectWorkspaceTokenUsage.select(root(cleared), 'legacy')).toBe(
      legacy.byWorkspaceId.legacy,
    );
  });

  it('returns exact rows in producer order with collision-safe tuple identities', () => {
    const row = {
      agentId: 'agent-a',
      model: '\0model',
      totals,
      humanMessages: 0,
      agentMessages: 1,
    };
    const rows = [
      row,
      {
        ...row,
        model: '\uE000',
        totals: { ...totals, thoughtTokens: 5, cost: { amount: 0, currency: 'USD' } },
      },
      { ...row, model: '\u{10000}', humanMessages: 2 },
      { ...row, agentId: 'agent-a\0', model: 'model' },
    ];
    const wire = TokenUsageSchema.parse({ ...snapshot, byAgentModel: rows });
    const state = tokenUsageReducer(initialState, tokenUsageReceived('ws', wire));
    const selected = selectWorkspaceTokenUsageCrossFilterRows.select(root(state), 'ws');
    expect(selected).toEqual(rows);
    expect(state.byWorkspaceId.ws.byAgentModel!.ids).toHaveLength(4);
    selected!.forEach((item, index) => expect(item).toBe(wire.byAgentModel![index]));
    expect(selected![0].totals).not.toHaveProperty('thoughtTokens');
    expect(selected![0].totals).not.toHaveProperty('cost');
    expect(selected![0]).not.toHaveProperty('id');
    expect(wire.byAgentModel).toEqual(rows);
  });
});
