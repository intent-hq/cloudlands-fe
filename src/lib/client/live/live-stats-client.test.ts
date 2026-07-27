/**
 * Wire-contract tests for the live stats domain (`stats.getUsage`).
 *
 * Asserts (a) the exact JSON-RPC request the client emits for each period
 * mode — `key` present for month/year, omitted for 24h; `tzOffsetMinutes`
 * always sent (Spec D8) — and (b) the daemon-shaped result passes through
 * untransformed. Errors are NOT folded: the overlay renders an explicit
 * error state.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: 'sub-1' })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
}));

import { backendRequest } from './backend-transport';
import { LiveStatsClient } from './live-stats-client';

const mockedRequest = vi.mocked(backendRequest);

/** Daemon-canonical `stats.getUsage` result shape (usage_stats_read.rs). */
const USAGE_RESULT = {
  totals: { inputTokens: 100, outputTokens: 40, cacheReadTokens: 10, cacheCreationTokens: 5 },
  runs: 12,
  sessions: 3,
  longestRunMs: 8_040_000,
  linesAdded: 4821,
  linesDeleted: 1790,
  byModel: [
    {
      model: 'claude-sonnet-4.5',
      runs: 12,
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
    },
  ],
  byProvider: [
    {
      provider: 'claude-code',
      runs: 12,
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
    },
  ],
  byHourOfDay: Array.from({ length: 24 }, (_, hour) => ({
    hour,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  })),
  byMonth: Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  })),
  availablePeriods: { months: ['2026-06', '2026-07'], years: ['2026'] },
};

describe('LiveStatsClient (fake transport)', () => {
  afterEach(() => vi.clearAllMocks());

  it('getUsage forwards stats.getUsage with period/key/tzOffsetMinutes for month', async () => {
    mockedRequest.mockResolvedValueOnce(USAGE_RESULT);
    const client = new LiveStatsClient();

    const result = await client.getUsage('month', '2026-07', -420);

    expect(mockedRequest).toHaveBeenCalledWith('stats.getUsage', {
      period: 'month',
      key: '2026-07',
      tzOffsetMinutes: -420,
    });
    expect(result).toEqual(USAGE_RESULT);
  });

  it('getUsage sends the year key for period year', async () => {
    mockedRequest.mockResolvedValueOnce(USAGE_RESULT);
    const client = new LiveStatsClient();

    await client.getUsage('year', '2026', 60);

    expect(mockedRequest).toHaveBeenCalledWith('stats.getUsage', {
      period: 'year',
      key: '2026',
      tzOffsetMinutes: 60,
    });
  });

  it('getUsage omits key entirely for the 24h rolling window (Spec D11)', async () => {
    mockedRequest.mockResolvedValueOnce(USAGE_RESULT);
    const client = new LiveStatsClient();

    await client.getUsage('24h', undefined, 0);

    expect(mockedRequest).toHaveBeenCalledWith('stats.getUsage', {
      period: '24h',
      tzOffsetMinutes: 0,
    });
    const params = mockedRequest.mock.calls[0][1] as Record<string, unknown>;
    expect('key' in params).toBe(false);
  });

  it('propagates transport/daemon errors (overlay renders an error state)', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('uds boom'));
    const client = new LiveStatsClient();

    await expect(client.getUsage('month', '2026-07', 0)).rejects.toThrow('uds boom');
  });

  it('rejects a result missing a required rollup with a descriptive error', async () => {
    const { byModel: _omitted, ...malformed } = USAGE_RESULT;
    mockedRequest.mockResolvedValueOnce(malformed);
    const client = new LiveStatsClient();

    await expect(client.getUsage('month', '2026-07', 0)).rejects.toThrow(/byModel/);
  });
});
