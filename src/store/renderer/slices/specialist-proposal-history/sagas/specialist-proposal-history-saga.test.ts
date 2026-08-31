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
  hydrateSpecialistProposalHistory,
  SPECIALIST_PROPOSAL_HISTORY_RETENTION_MS,
} from '../specialist-proposal-history-slice';
import type { SpecialistProposalHistoryEntry } from '../specialist-proposal-history-types';
import {
  hydrateSpecialistProposalHistorySaga,
  persistSpecialistProposalHistorySaga,
  SPECIALIST_PROPOSAL_HISTORY_STORAGE_KEY,
  validateSpecialistProposalHistoryEntries,
} from './specialist-proposal-history-saga';

function deleteEntry(appliedAt: number): SpecialistProposalHistoryEntry {
  return { appliedAt, reverse: { kind: 'delete', id: 'my-specialist', scope: 'user' } };
}

const saveEntry: SpecialistProposalHistoryEntry = {
  appliedAt: 5,
  reverse: {
    kind: 'save',
    specialist: {
      id: 'my-specialist',
      name: 'My Specialist',
      description: 'Does things',
      behaviorPrompt: 'Be helpful',
      scope: 'user',
    },
  },
};

async function run(
  saga: (...args: never[]) => Generator,
  entries: Record<string, SpecialistProposalHistoryEntry>,
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
      getState: () => ({ specialistProposalHistory: { entries } }),
    },
    saga as never,
  );
  await task.toPromise();
  return dispatched;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('validateSpecialistProposalHistoryEntries', () => {
  it('keeps delete and save reverse actions with valid fields', () => {
    const valid = deleteEntry(5);
    expect(
      validateSpecialistProposalHistoryEntries({
        entries: {
          'p-1': valid,
          'p-2': saveEntry,
          'p-3': { appliedAt: 5, reverse: { kind: 'delete', id: 7, scope: 'user' } },
          'p-4': { appliedAt: 5, reverse: { kind: 'save', specialist: { id: 'x' } } },
          'p-5': { appliedAt: 5, reverse: { kind: 'other' } },
          'p-6': null,
        },
      }),
    ).toEqual({ 'p-1': valid, 'p-2': saveEntry });
  });

  it('returns an empty map for malformed storage payloads', () => {
    expect(validateSpecialistProposalHistoryEntries(null)).toEqual({});
    expect(validateSpecialistProposalHistoryEntries({ entries: [] })).toEqual({});
    expect(validateSpecialistProposalHistoryEntries('nope')).toEqual({});
  });
});

describe('hydrateSpecialistProposalHistorySaga', () => {
  it('hydrates pruned entries from localStorage', async () => {
    const fresh = deleteEntry(Date.now());
    const stale = deleteEntry(Date.now() - SPECIALIST_PROPOSAL_HISTORY_RETENTION_MS - 1000);
    mocks.getJSON.mockReturnValue({ entries: { 'p-new': fresh, 'p-old': stale } });

    const dispatched = await run(hydrateSpecialistProposalHistorySaga, {});

    expect(mocks.getJSON).toHaveBeenCalledWith(SPECIALIST_PROPOSAL_HISTORY_STORAGE_KEY);
    expect(dispatched.map((a) => a.type)).toEqual([hydrateSpecialistProposalHistory.type]);
    const hydrate = dispatched[0] as ReturnType<typeof hydrateSpecialistProposalHistory>;
    expect(hydrate.payload[0]).toEqual({ 'p-new': fresh });
  });
});

describe('persistSpecialistProposalHistorySaga', () => {
  it('writes pruned entries under the storage key', async () => {
    const fresh = deleteEntry(Date.now());
    const stale = deleteEntry(Date.now() - SPECIALIST_PROPOSAL_HISTORY_RETENTION_MS - 1000);

    await run(persistSpecialistProposalHistorySaga, { 'p-new': fresh, 'p-old': stale });

    expect(mocks.setJSON).toHaveBeenCalledWith(SPECIALIST_PROPOSAL_HISTORY_STORAGE_KEY, {
      entries: { 'p-new': fresh },
    });
  });
});
