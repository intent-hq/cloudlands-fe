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
  clearSpecialistApplied,
  hydrateSpecialistProposalHistory,
  recordSpecialistApplied,
  SPECIALIST_PROPOSAL_HISTORY_RETENTION_MS,
} from '../specialist-proposal-history-slice';
import { selectSpecialistProposalHistoryEntries } from '../specialist-proposal-history-selectors';
import {
  hydrateSpecialistProposalHistorySaga,
  persistSpecialistProposalHistorySaga,
  SPECIALIST_PROPOSAL_HISTORY_MAX_PERSISTED_ENTRIES,
  SPECIALIST_PROPOSAL_HISTORY_PERSIST_DEBOUNCE_MS,
  SPECIALIST_PROPOSAL_HISTORY_STORAGE_KEY,
  validateSpecialistProposalHistoryEntries,
  watchSpecialistProposalHistoryPersistenceSaga,
} from './specialist-proposal-history-saga';
import type { SpecialistReverseAction } from '../specialist-proposal-history-types';

const reverse: SpecialistReverseAction = { kind: 'delete', id: 'review-buddy', scope: 'user' };

describe('specialistProposalHistorySaga', () => {
  afterEach(() => vi.useRealTimers());

  it('writes pruned and capped history entries to localStorage', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T12:00:00Z'));
    const now = Date.now();
    const entries = Object.fromEntries(
      Array.from({ length: 205 }, (_, index) => [
        `proposal-${index}`,
        { appliedAt: now - index, reverse },
      ]),
    );
    entries.stale = { appliedAt: now - SPECIALIST_PROPOSAL_HISTORY_RETENTION_MS - 1, reverse };
    const expectedEntries = Object.fromEntries(
      Array.from({ length: SPECIALIST_PROPOSAL_HISTORY_MAX_PERSISTED_ENTRIES }, (_, index) => [
        `proposal-${index}`,
        entries[`proposal-${index}`],
      ]),
    );

    testSaga(persistSpecialistProposalHistorySaga)
      .next()
      .select(selectSpecialistProposalHistoryEntries.select)
      .next(entries)
      .call(setLocalStorageJSON, SPECIALIST_PROPOSAL_HISTORY_STORAGE_KEY, {
        entries: expectedEntries,
      })
      .next()
      .isDone();
  });

  it('writes the history slice to localStorage', () => {
    const entries = { 'proposal-1': { appliedAt: Date.now(), reverse } };

    testSaga(persistSpecialistProposalHistorySaga)
      .next()
      .select(selectSpecialistProposalHistoryEntries.select)
      .next(entries)
      .call(setLocalStorageJSON, SPECIALIST_PROPOSAL_HISTORY_STORAGE_KEY, { entries })
      .next()
      .isDone();
  });

  it('debounces rapid sequential record dispatches into one localStorage write', async () => {
    const entries = { 'proposal-1': { appliedAt: Date.now(), reverse } };
    const persistCalls: unknown[][] = [];

    await expectSaga(watchSpecialistProposalHistoryPersistenceSaga)
      .withState({ specialistProposalHistory: { entries } })
      .provide({
        call(effect, next) {
          if (effect.fn === setLocalStorageJSON) {
            persistCalls.push(effect.args);
            return undefined;
          }
          return next();
        },
      })
      .dispatch(recordSpecialistApplied({ proposalId: 'proposal-1', appliedAt: 1, reverse }))
      .dispatch(recordSpecialistApplied({ proposalId: 'proposal-2', appliedAt: 2, reverse }))
      .dispatch(recordSpecialistApplied({ proposalId: 'proposal-3', appliedAt: 3, reverse }))
      .silentRun(SPECIALIST_PROPOSAL_HISTORY_PERSIST_DEBOUNCE_MS + 100);

    expect(persistCalls).toEqual([[SPECIALIST_PROPOSAL_HISTORY_STORAGE_KEY, { entries }]]);
  });

  it('debounces rapid clear dispatches into one localStorage write', async () => {
    const entries = { 'proposal-1': { appliedAt: Date.now(), reverse } };
    const persistCalls: unknown[][] = [];

    await expectSaga(watchSpecialistProposalHistoryPersistenceSaga)
      .withState({ specialistProposalHistory: { entries } })
      .provide({
        call(effect, next) {
          if (effect.fn === setLocalStorageJSON) {
            persistCalls.push(effect.args);
            return undefined;
          }
          return next();
        },
      })
      .dispatch(clearSpecialistApplied('proposal-1'))
      .dispatch(clearSpecialistApplied('proposal-2'))
      .dispatch(clearSpecialistApplied('proposal-3'))
      .silentRun(SPECIALIST_PROPOSAL_HISTORY_PERSIST_DEBOUNCE_MS + 100);

    expect(persistCalls).toHaveLength(1);
  });

  it('hydrates valid localStorage and drops entries older than 30 days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T12:00:00Z'));
    const now = Date.now();
    const fresh = { appliedAt: now - 1_000, reverse };
    const stale = { appliedAt: now - SPECIALIST_PROPOSAL_HISTORY_RETENTION_MS - 1, reverse };

    testSaga(hydrateSpecialistProposalHistorySaga)
      .next()
      .call(getLocalStorageJSON, SPECIALIST_PROPOSAL_HISTORY_STORAGE_KEY)
      .next({ entries: { fresh, stale } })
      .put(hydrateSpecialistProposalHistory({ fresh }))
      .next()
      .isDone();
  });

  it('treats invalid JSON shapes as empty history', () => {
    expect(validateSpecialistProposalHistoryEntries(null)).toEqual({});
    expect(validateSpecialistProposalHistoryEntries({ entries: [] })).toEqual({});
    expect(
      validateSpecialistProposalHistoryEntries({ entries: { bad: { appliedAt: 'nope' } } }),
    ).toEqual({});
  });
});
