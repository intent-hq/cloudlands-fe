import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUsage: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('$lib/client', () => ({ appClient: { stats: { getUsage: mocks.getUsage } } }));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ warn: mocks.warn }),
}));

import type { UsageStatsResult } from '$lib/client/app-client';
import { m } from '$shared/paraglide/messages.js';
import { loadUsageStatsRequested } from '../stats-slice';
import { statsReadSaga } from './stats-read-saga';

const usageResult: UsageStatsResult = {
  totals: {
    inputTokens: 130,
    outputTokens: 45,
    cacheReadTokens: 8,
    cacheCreationTokens: 3,
  },
  runs: 3,
  sessions: 1,
  longestRunMs: 9_000,
  linesAdded: 10,
  linesDeleted: 3,
  byModel: [
    {
      model: 'Opus 4.8',
      runs: 3,
      inputTokens: 130,
      outputTokens: 45,
      cacheReadTokens: 8,
      cacheCreationTokens: 3,
    },
  ],
  byProvider: [
    {
      provider: 'claude-code',
      runs: 3,
      inputTokens: 130,
      outputTokens: 45,
      cacheReadTokens: 8,
      cacheCreationTokens: 3,
    },
  ],
  byHourOfDay: [
    {
      hour: 13,
      inputTokens: 130,
      outputTokens: 45,
      cacheReadTokens: 8,
      cacheCreationTokens: 3,
    },
  ],
  byMonth: [
    {
      month: 7,
      inputTokens: 130,
      outputTokens: 45,
      cacheReadTokens: 8,
      cacheCreationTokens: 3,
    },
  ],
  availablePeriods: { months: ['2026-06', '2026-07'], years: ['2026'] },
};

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function harness() {
  const channel = stdChannel();
  const dispatched: unknown[] = [];
  const task = runSaga({ channel, dispatch: (action) => dispatched.push(action) }, statsReadSaga);
  return { channel, dispatched, task };
}

describe('statsReadSaga', () => {
  afterEach(() => vi.clearAllMocks());

  it('requests a keyed month and dispatches the complete protocol-shaped result', async () => {
    mocks.getUsage.mockResolvedValue(usageResult);
    const { channel, dispatched, task } = harness();

    channel.put(loadUsageStatsRequested('month', '2026-07', -420));
    await settle();

    expect(mocks.getUsage.mock.calls).toEqual([['month', '2026-07', -420]]);
    expect(dispatched).toEqual([
      {
        type: 'stats/usageStatsLoaded',
        payload: ['month', '2026-07', usageResult],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('omits the key argument for the 24h rolling window', async () => {
    mocks.getUsage.mockResolvedValue(usageResult);
    const { channel, dispatched, task } = harness();

    channel.put(loadUsageStatsRequested('24h', 'ignored', 0));
    await settle();

    expect(mocks.getUsage.mock.calls).toEqual([['24h', undefined, 0]]);
    expect(dispatched).toEqual([
      {
        type: 'stats/usageStatsLoaded',
        payload: ['24h', 'ignored', usageResult],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('dispatches an Error message and preserves mode/key correlation', async () => {
    mocks.getUsage.mockRejectedValue(new Error('uds unavailable'));
    const { channel, dispatched, task } = harness();

    channel.put(loadUsageStatsRequested('year', '2026', 60));
    await settle();

    expect(mocks.getUsage.mock.calls).toEqual([['year', '2026', 60]]);
    expect(dispatched).toEqual([
      {
        type: 'stats/usageStatsFailed',
        payload: ['year', '2026', 'uds unavailable'],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('uses the localized fallback for a non-Error rejection', async () => {
    mocks.getUsage.mockRejectedValue({ code: -32603 });
    const { channel, dispatched, task } = harness();

    channel.put(loadUsageStatsRequested('month', null, 0));
    await settle();

    expect(dispatched).toEqual([
      {
        type: 'stats/usageStatsFailed',
        payload: ['month', null, m.stats_readService_loadFailed_error()],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('cancels a stale request and emits only the latest correlated result', async () => {
    const stale = deferred<UsageStatsResult>();
    mocks.getUsage.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(usageResult);
    const { channel, dispatched, task } = harness();

    channel.put(loadUsageStatsRequested('month', '2026-06', -420));
    await settle();
    channel.put(loadUsageStatsRequested('month', '2026-07', -420));
    await settle();
    stale.resolve(usageResult);
    await settle();

    expect(mocks.getUsage.mock.calls).toEqual([
      ['month', '2026-06', -420],
      ['month', '2026-07', -420],
    ]);
    expect(dispatched).toEqual([
      {
        type: 'stats/usageStatsLoaded',
        payload: ['month', '2026-07', usageResult],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('does not dispatch a terminal action after root cancellation', async () => {
    const pending = deferred<UsageStatsResult>();
    mocks.getUsage.mockReturnValue(pending.promise);
    const { channel, dispatched, task } = harness();

    channel.put(loadUsageStatsRequested('year', '2026', 0));
    await settle();
    task.cancel();
    await task.toPromise();
    pending.resolve(usageResult);
    await settle();

    expect(mocks.getUsage.mock.calls).toEqual([['year', '2026', 0]]);
    expect(dispatched).toEqual([]);
  });
});
