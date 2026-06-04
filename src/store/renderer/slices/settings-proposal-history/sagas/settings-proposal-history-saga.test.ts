import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectSaga, testSaga } from 'redux-saga-test-plan';
import * as sagaEffects from 'redux-saga/effects';

vi.mock('typed-redux-saga', () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  delay: function* (ms: number) {
    return yield sagaEffects.delay(ms);
  },
  debounce: function* (ms: number, pattern: any, worker: any) {
    return yield sagaEffects.debounce(ms, pattern, worker);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  takeLatest: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeLatest(pattern, worker);
  },
}));

import { getLocalStorageJSON, setLocalStorageJSON } from '$store/renderer/utils/safe-local-storage-saga';
import {
  clearProposalApplied,
  hydrateProposalHistory,
  recordProposalApplied,
  SETTINGS_PROPOSAL_HISTORY_RETENTION_MS,
} from '../settings-proposal-history-slice';
import { selectSettingsProposalHistoryEntries } from '../settings-proposal-history-selectors';
import {
  hydrateSettingsProposalHistorySaga,
  persistSettingsProposalHistorySaga,
  SETTINGS_PROPOSAL_HISTORY_MAX_PERSISTED_ENTRIES,
  SETTINGS_PROPOSAL_HISTORY_PERSIST_DEBOUNCE_MS,
  SETTINGS_PROPOSAL_HISTORY_STORAGE_KEY,
  validateProposalHistoryEntries,
  watchSettingsProposalHistoryPersistenceSaga,
} from './settings-proposal-history-saga';

const reverseChanges = [
  {
    path: 'theme.activePresetId',
    value: null,
    apply: { kind: 'redux-action', action: 'theme/selectThemePreset' } as const,
  },
];

describe('settingsProposalHistorySaga', () => {
  afterEach(() => vi.useRealTimers());

  it('writes pruned and capped history entries to localStorage', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T12:00:00Z'));
    const now = Date.now();
    const entries = Object.fromEntries(
      Array.from({ length: 205 }, (_, index) => [
        `proposal-${index}`,
        { appliedAt: now - index, reverseChanges },
      ]),
    );
    entries.stale = { appliedAt: now - SETTINGS_PROPOSAL_HISTORY_RETENTION_MS - 1, reverseChanges };
    const expectedEntries = Object.fromEntries(
      Array.from({ length: SETTINGS_PROPOSAL_HISTORY_MAX_PERSISTED_ENTRIES }, (_, index) => [
        `proposal-${index}`,
        entries[`proposal-${index}`],
      ]),
    );

    testSaga(persistSettingsProposalHistorySaga)
      .next()
      .select(selectSettingsProposalHistoryEntries.select)
      .next(entries)
      .call(setLocalStorageJSON, SETTINGS_PROPOSAL_HISTORY_STORAGE_KEY, {
        entries: expectedEntries,
      })
      .next()
      .isDone();
  });

  it('writes the history slice to localStorage', () => {
    const entries = { 'proposal-1': { appliedAt: Date.now(), reverseChanges } };

    testSaga(persistSettingsProposalHistorySaga)
      .next()
      .select(selectSettingsProposalHistoryEntries.select)
      .next(entries)
      .call(setLocalStorageJSON, SETTINGS_PROPOSAL_HISTORY_STORAGE_KEY, { entries })
      .next()
      .isDone();
  });

  it('debounces rapid sequential record dispatches into one localStorage write', async () => {
    const entries = { 'proposal-1': { appliedAt: Date.now(), reverseChanges } };
    const persistCalls: unknown[][] = [];

    await expectSaga(watchSettingsProposalHistoryPersistenceSaga)
      .withState({ settingsProposalHistory: { entries } })
      .provide({
        call(effect, next) {
          if (effect.fn === setLocalStorageJSON) {
            persistCalls.push(effect.args);
            return undefined;
          }
          return next();
        },
      })
      .dispatch(recordProposalApplied({ proposalId: 'proposal-1', appliedAt: 1, reverseChanges }))
      .dispatch(recordProposalApplied({ proposalId: 'proposal-2', appliedAt: 2, reverseChanges }))
      .dispatch(recordProposalApplied({ proposalId: 'proposal-3', appliedAt: 3, reverseChanges }))
      .silentRun(SETTINGS_PROPOSAL_HISTORY_PERSIST_DEBOUNCE_MS + 100);

    expect(persistCalls).toEqual([[SETTINGS_PROPOSAL_HISTORY_STORAGE_KEY, { entries }]]);
  });

  it('debounces rapid clear dispatches into one localStorage write', async () => {
    const entries = { 'proposal-1': { appliedAt: Date.now(), reverseChanges } };
    const persistCalls: unknown[][] = [];

    await expectSaga(watchSettingsProposalHistoryPersistenceSaga)
      .withState({ settingsProposalHistory: { entries } })
      .provide({
        call(effect, next) {
          if (effect.fn === setLocalStorageJSON) {
            persistCalls.push(effect.args);
            return undefined;
          }
          return next();
        },
      })
      .dispatch(clearProposalApplied('proposal-1'))
      .dispatch(clearProposalApplied('proposal-2'))
      .dispatch(clearProposalApplied('proposal-3'))
      .silentRun(SETTINGS_PROPOSAL_HISTORY_PERSIST_DEBOUNCE_MS + 100);

    expect(persistCalls).toHaveLength(1);
  });

  it('hydrates valid localStorage and drops entries older than 30 days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T12:00:00Z'));
    const now = Date.now();
    const fresh = { appliedAt: now - 1_000, reverseChanges };
    const stale = { appliedAt: now - SETTINGS_PROPOSAL_HISTORY_RETENTION_MS - 1, reverseChanges };

    testSaga(hydrateSettingsProposalHistorySaga)
      .next()
      .call(getLocalStorageJSON, SETTINGS_PROPOSAL_HISTORY_STORAGE_KEY)
      .next({ entries: { fresh, stale } })
      .put(hydrateProposalHistory({ fresh }))
      .next()
      .isDone();
  });

  it('treats invalid JSON shapes as empty history', () => {
    expect(validateProposalHistoryEntries(null)).toEqual({});
    expect(validateProposalHistoryEntries({ entries: [] })).toEqual({});
    expect(validateProposalHistoryEntries({ entries: { bad: { appliedAt: 'nope' } } })).toEqual({});
  });
});
