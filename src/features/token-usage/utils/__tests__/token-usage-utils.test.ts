// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  addTotals,
  createEmptyTotals,
  extractAgentSessionInfo,
  mergeByModel,
  sumSessionTokenUsage,
  UNKNOWN_MODEL,
} from '../token-usage-utils';

describe('extractAgentSessionInfo', () => {
  it('prefers acpSessionId over backendSessionId and returns last message id', () => {
    const agent = {
      acpSessionId: 'acp-1',
      backendSessionId: 'backend-1',
      messages: [{ id: 'msg-1' }, { id: 'msg-2' }],
    };
    expect(extractAgentSessionInfo(agent)).toEqual({ sessionId: 'acp-1', lastMessageId: 'msg-2' });
  });

  it('falls back to backendSessionId and chatHistory', () => {
    const agent = { backendSessionId: 'backend-1', chatHistory: [{ id: 'msg-9' }] };
    expect(extractAgentSessionInfo(agent)).toEqual({
      sessionId: 'backend-1',
      lastMessageId: 'msg-9',
    });
  });

  it('returns nulls for missing fields, empty messages, and non-object input', () => {
    expect(extractAgentSessionInfo({ messages: [] })).toEqual({
      sessionId: null,
      lastMessageId: null,
    });
    expect(extractAgentSessionInfo(null)).toEqual({ sessionId: null, lastMessageId: null });
    expect(extractAgentSessionInfo('garbage')).toEqual({ sessionId: null, lastMessageId: null });
    expect(extractAgentSessionInfo({ acpSessionId: 's', messages: ['bad'] })).toEqual({
      sessionId: 's',
      lastMessageId: null,
    });
  });
});

describe('sumSessionTokenUsage', () => {
  it('sums type 10 token nodes and tolerates null token_usage', () => {
    const session = {
      chatHistory: [
        {
          exchange: {
            response_nodes: [
              { type: 0, token_usage: null },
              {
                type: 9,
                token_usage: { input_tokens: 999, output_tokens: 999 },
              },
              {
                type: 10,
                token_usage: {
                  input_tokens: 2,
                  output_tokens: 167,
                  cache_read_input_tokens: 22789,
                  cache_creation_input_tokens: 18610,
                  max_context_tokens: 1_000_000,
                },
              },
              { type: 10, token_usage: null },
            ],
          },
        },
        {
          exchange: {
            response_nodes: [
              {
                type: 10,
                token_usage: { input_tokens: 1, output_tokens: 10 },
              },
            ],
          },
        },
      ],
    };
    expect(sumSessionTokenUsage(session).totals).toEqual({
      inputTokens: 3,
      outputTokens: 177,
      cacheReadTokens: 22789,
      cacheCreationTokens: 18610,
    });
  });

  it('attributes token nodes to the effective_model_name of the type 9 node in the same exchange', () => {
    // Real session files (verified 2026-06-12): each exchange carries one
    // type-9 billing_metadata node (with effective_model_name) followed by
    // one type-10 token_usage node. Type-10 nodes themselves carry no model.
    const session = {
      chatHistory: [
        {
          exchange: {
            response_nodes: [
              { type: 9, billing_metadata: { effective_model_name: 'model-a' } },
              { type: 10, token_usage: { input_tokens: 1, output_tokens: 10 } },
            ],
          },
        },
        {
          exchange: {
            response_nodes: [
              { type: 9, billing_metadata: { effective_model_name: 'model-b' } },
              {
                type: 10,
                token_usage: {
                  input_tokens: 2,
                  output_tokens: 20,
                  cache_read_input_tokens: 200,
                  cache_creation_input_tokens: 30,
                },
              },
            ],
          },
        },
        {
          exchange: {
            response_nodes: [
              { type: 9, billing_metadata: { effective_model_name: 'model-a' } },
              { type: 10, token_usage: { input_tokens: 4, output_tokens: 40 } },
            ],
          },
        },
      ],
    };
    const { totals, byModel } = sumSessionTokenUsage(session);
    expect(byModel).toEqual({
      'model-a': {
        inputTokens: 5,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      'model-b': {
        inputTokens: 2,
        outputTokens: 20,
        cacheReadTokens: 200,
        cacheCreationTokens: 30,
      },
    });
    // Per-model sums add up to the session totals.
    expect(totals).toEqual({
      inputTokens: 7,
      outputTokens: 70,
      cacheReadTokens: 200,
      cacheCreationTokens: 30,
    });
  });

  it('buckets token nodes without a resolvable model name under "unknown"', () => {
    const session = {
      chatHistory: [
        {
          // No type-9 node at all.
          exchange: {
            response_nodes: [
              { type: 10, token_usage: { input_tokens: 1, output_tokens: 10 } },
            ],
          },
        },
        {
          // type-9 node present but effective_model_name is null.
          exchange: {
            response_nodes: [
              { type: 9, billing_metadata: { effective_model_name: null } },
              { type: 10, token_usage: { input_tokens: 2, output_tokens: 20 } },
            ],
          },
        },
      ],
    };
    expect(sumSessionTokenUsage(session).byModel).toEqual({
      [UNKNOWN_MODEL]: {
        inputTokens: 3,
        outputTokens: 30,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    });
  });

  it('attributes a token node preceding its billing node to the exchange model', () => {
    const session = {
      chatHistory: [
        {
          exchange: {
            response_nodes: [
              { type: 10, token_usage: { input_tokens: 1, output_tokens: 10 } },
              { type: 9, billing_metadata: { effective_model_name: 'model-late' } },
            ],
          },
        },
      ],
    };
    expect(sumSessionTokenUsage(session).byModel).toEqual({
      'model-late': {
        inputTokens: 1,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    });
  });

  it('returns zeros for malformed input', () => {
    expect(sumSessionTokenUsage(null)).toEqual({ totals: createEmptyTotals(), byModel: {} });
    expect(sumSessionTokenUsage({})).toEqual({ totals: createEmptyTotals(), byModel: {} });
    expect(sumSessionTokenUsage({ chatHistory: 'nope' })).toEqual({
      totals: createEmptyTotals(),
      byModel: {},
    });
    expect(sumSessionTokenUsage({ chatHistory: [{ exchange: null }, 'bad', {}] })).toEqual({
      totals: createEmptyTotals(),
      byModel: {},
    });
  });
});

describe('addTotals', () => {
  it('accumulates into the target', () => {
    const target = createEmptyTotals();
    addTotals(target, {
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheCreationTokens: 4,
    });
    addTotals(target, {
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheCreationTokens: 40,
    });
    expect(target).toEqual({
      inputTokens: 11,
      outputTokens: 22,
      cacheReadTokens: 33,
      cacheCreationTokens: 44,
    });
  });
});

describe('mergeByModel', () => {
  it('sums per model key and adds new models without mutating the delta', () => {
    const target = {
      'model-a': { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 },
    };
    const delta = {
      'model-a': { inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheCreationTokens: 40 },
      'model-b': { inputTokens: 5, outputTokens: 6, cacheReadTokens: 7, cacheCreationTokens: 8 },
    };
    const result = mergeByModel(target, delta);
    expect(result).toBe(target);
    expect(result).toEqual({
      'model-a': {
        inputTokens: 11,
        outputTokens: 22,
        cacheReadTokens: 33,
        cacheCreationTokens: 44,
      },
      'model-b': { inputTokens: 5, outputTokens: 6, cacheReadTokens: 7, cacheCreationTokens: 8 },
    });
    expect(delta['model-a']).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheCreationTokens: 40,
    });
  });
});

