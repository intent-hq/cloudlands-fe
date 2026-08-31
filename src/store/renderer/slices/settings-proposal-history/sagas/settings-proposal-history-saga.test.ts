import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({ getJSON: vi.fn(), setJSON: vi.fn() }));

vi.mock('$lib/utils/safe-storage', () => ({
  safeLocalStorage: {
    getJSON: mocks.getJSON,
    setJSON: mocks.setJSON,
    getItem: vi.fn(),
    getItemWithStatus: vi.fn(() => ({ value: null, hadError: false })),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    keysWithPrefix: vi.fn(() => []),
  },
}));

import {
  hydrateProposalHistory,
  SETTINGS_PROPOSAL_HISTORY_RETENTION_MS,
} from '../settings-proposal-history-slice';
import type { SettingsProposalHistoryEntry } from '../settings-proposal-history-types';
import {
  hydrateSettingsProposalHistorySaga,
  persistSettingsProposalHistorySaga,
  SETTINGS_PROPOSAL_HISTORY_STORAGE_KEY,
  validateProposalHistoryEntries,
} from './settings-proposal-history-saga';

const reverseChanges = [
  {
    path: 'theme.activePresetId',
    value: null,
    apply: { kind: 'redux-action' as const, action: 'theme/selectThemePreset' },
  },
];

function entry(appliedAt: number): SettingsProposalHistoryEntry {
  return { appliedAt, reverseChanges } as SettingsProposalHistoryEntry;
}

async function run(
  saga: (...args: never[]) => Generator,
  entries: Record<string, SettingsProposalHistoryEntry>,
) {
  const channel = stdChannel();
  const dispatched: Array<{ type: string; payload?: unknown }> = [];
  const task = runSaga(
    {
      channel,
      dispatch: (a: { type: string }) => {
        dispatched.push(a);
        return a;
      },
      getState: () => ({ settingsProposalHistory: { entries } }),
    },
    saga as never,
  );
  await task.toPromise();
  return dispatched;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('validateProposalHistoryEntries', () => {
  it('keeps only well-formed entries', () => {
    const valid = entry(5);
    expect(
      validateProposalHistoryEntries({
        entries: {
          'p-1': valid,
          'p-2': { appliedAt: 'nope', reverseChanges },
          'p-3': { appliedAt: 5, reverseChanges: [{ path: 7 }] },
          'p-4': null,
        },
      }),
    ).toEqual({ 'p-1': valid });
  });

  it('returns an empty map for malformed storage payloads', () => {
    expect(validateProposalHistoryEntries(null)).toEqual({});
    expect(validateProposalHistoryEntries({ entries: [] })).toEqual({});
    expect(validateProposalHistoryEntries('nope')).toEqual({});
  });
});

describe('hydrateSettingsProposalHistorySaga', () => {
  it('hydrates pruned entries from localStorage', async () => {
    const fresh = entry(Date.now());
    const stale = entry(Date.now() - SETTINGS_PROPOSAL_HISTORY_RETENTION_MS - 1000);
    mocks.getJSON.mockReturnValue({ entries: { 'p-new': fresh, 'p-old': stale } });

    const dispatched = await run(hydrateSettingsProposalHistorySaga, {});

    expect(mocks.getJSON).toHaveBeenCalledWith(SETTINGS_PROPOSAL_HISTORY_STORAGE_KEY);
    expect(dispatched.map((a) => a.type)).toEqual([hydrateProposalHistory.type]);
    const hydrate = dispatched[0] as ReturnType<typeof hydrateProposalHistory>;
    expect(hydrate.payload[0]).toEqual({ 'p-new': fresh });
  });
});

describe('persistSettingsProposalHistorySaga', () => {
  it('writes pruned entries under the storage key', async () => {
    const fresh = entry(Date.now());
    const stale = entry(Date.now() - SETTINGS_PROPOSAL_HISTORY_RETENTION_MS - 1000);

    await run(persistSettingsProposalHistorySaga, { 'p-new': fresh, 'p-old': stale });

    expect(mocks.setJSON).toHaveBeenCalledWith(SETTINGS_PROPOSAL_HISTORY_STORAGE_KEY, {
      entries: { 'p-new': fresh },
    });
  });
});
