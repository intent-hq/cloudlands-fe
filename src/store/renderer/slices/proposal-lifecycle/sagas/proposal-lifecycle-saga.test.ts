import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectSaga } from 'redux-saga-test-plan';
import * as matchers from 'redux-saga-test-plan/matchers';
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
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
  takeLatest: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeLatest(pattern, worker);
  },
  delay: function* (ms: number) {
    return yield sagaEffects.delay(ms);
  },
}));

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  getState: vi.fn(() => ({})),
  toastError: vi.fn(),
  track: vi.fn(),
}));

vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: () => ({ dispatch: mocks.dispatch, getState: mocks.getState }),
}));

vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: mocks.dispatch,
    get state() { return mocks.getState(); },
    createSelector: vi.fn((fn) => ({
      select: fn,
      effect: function* (...args: any[]) {
        // In sagas, use redux-saga select to get state from the test's provided state
        const state = yield sagaEffects.select((s: any) => s);
        return fn(state, ...args);
      },
    })),
  },
}));

vi.mock('svelte-sonner', () => ({ toast: { error: mocks.toastError } }));
vi.mock('$lib/services/analytics', () => ({ track: mocks.track }));

import {
  applyProposalRequested,
  proposalApplyStarted,
  proposalApplySucceeded,
  proposalFailed,
  hydrateProposalLifecycle,
  proposalUndoStarted,
  proposalUndoSucceeded,
  undoProposalRequested,
} from '../proposal-lifecycle-slice';
import {
  handleApplyProposal,
  handleUndoProposal,
  hydrateProposalLifecycleSaga,
  persistProposalLifecycleSaga,
  PROPOSAL_LIFECYCLE_PERSIST_DEBOUNCE_MS,
  PROPOSAL_LIFECYCLE_STORAGE_KEY,
  validateProposalLifecycleEntries,
  watchProposalLifecyclePersistenceSaga,
} from './proposal-lifecycle-saga';
import { getLocalStorageJSON, setLocalStorageJSON } from '$store/renderer/utils/safe-local-storage-saga';
import {
  recordProposalApplied,
  clearProposalApplied,
} from '../../settings-proposal-history/settings-proposal-history-slice';
import { clearSpecialistApplied } from '../../specialist-proposal-history/specialist-proposal-history-slice';
import {
  applySettingsProposalWork,
  undoSettingsProposalWork,
} from '$lib/components/chat/proposals/settings-proposal-actions';
import {
  applySpecialistProposalWork,
  undoSpecialistProposalWork,
} from '$lib/components/chat/proposals/specialist-proposal-actions';
import type { Proposal, ProposalActionDetail } from '$shared/types/proposal';

function makeDetail(kind: Proposal['kind'] = 'settings-change'): ProposalActionDetail {
  return {
    proposal: { kind, payload: {}, preview: { title: 'Proposal' }, applyToolCallId: 'proposal-1' },
    editedFields: {},
    selectedBulkItemIds: [],
  };
}

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    proposalLifecycle: {},
    settingsProposalHistory: { entries: {} },
    specialistProposalHistory: { entries: {} },
    ...overrides,
  };
}

describe('proposalLifecycleSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });

  it('runs settings apply success, records history, and tracks success', async () => {
    const detail = makeDetail('settings-change');
    const reverseChanges = [
      { path: 'theme.preference', value: 'system', apply: { kind: 'read-only' as const } },
    ];

    await expectSaga(
      handleApplyProposal,
      applyProposalRequested({ proposalId: 'proposal-1', kind: 'settings-change', detail }),
    )
      .withState(makeState())
      .provide([[matchers.call.fn(applySettingsProposalWork), { reverseChanges }]])
      .put(proposalApplyStarted({ proposalId: 'proposal-1', startedAt: 1_000 }))
      .put(proposalApplySucceeded({ proposalId: 'proposal-1', completedAt: 1_000 }))
      .put(recordProposalApplied({ proposalId: 'proposal-1', appliedAt: 1_000, reverseChanges }))
      .silentRun(0);

    expect(mocks.track).toHaveBeenCalledWith('Proposal Applied', {
      kind: 'settings-change',
      outcome: 'success',
      durationMs: 0,
    });
  });

  it('marks apply failure, toasts, and tracks failure', async () => {
    const detail = makeDetail('settings-change');

    await expectSaga(
      handleApplyProposal,
      applyProposalRequested({ proposalId: 'proposal-1', kind: 'settings-change', detail }),
    )
      .withState(makeState())
      .provide([[matchers.call.fn(applySettingsProposalWork), Promise.reject(new Error('boom'))]])
      .put(proposalApplyStarted({ proposalId: 'proposal-1', startedAt: 1_000 }))
      .put(
        proposalFailed({
          proposalId: 'proposal-1',
          error: 'boom',
          completedAt: 1_000,
          lastAction: 'apply',
        }),
      )
      .silentRun(0);

    expect(mocks.track).toHaveBeenCalledWith('Proposal Applied', {
      kind: 'settings-change',
      outcome: 'failure',
      durationMs: 0,
    });
    expect(mocks.toastError).toHaveBeenCalledWith('Failed to apply changes', {
      description: 'boom',
    });
  });

  it('runs settings undo success and clears history', async () => {
    const reverseChanges = [
      { path: 'theme.preference', value: 'system', apply: { kind: 'read-only' as const } },
    ];

    await expectSaga(
      handleUndoProposal,
      undoProposalRequested({ proposalId: 'proposal-1', kind: 'settings-change' }),
    )
      .withState(
        makeState({
          proposalLifecycle: { 'proposal-1': { status: 'applied' } },
          settingsProposalHistory: {
            entries: { 'proposal-1': { appliedAt: 900, reverseChanges } },
          },
        }),
      )
      .provide([[matchers.call.fn(undoSettingsProposalWork), undefined]])
      .put(proposalUndoStarted({ proposalId: 'proposal-1', startedAt: 1_000 }))
      .put(proposalUndoSucceeded({ proposalId: 'proposal-1', completedAt: 1_000 }))
      .put(clearProposalApplied('proposal-1'))
      .silentRun(0);

    expect(mocks.track).toHaveBeenCalledWith('Proposal Undone', { kind: 'settings-change' });
  });

  it('marks undo failure and keeps retry action as undo', async () => {
    const reverseChanges = [
      { path: 'theme.preference', value: 'system', apply: { kind: 'read-only' as const } },
    ];

    await expectSaga(
      handleUndoProposal,
      undoProposalRequested({ proposalId: 'proposal-1', kind: 'settings-change' }),
    )
      .withState(
        makeState({
          proposalLifecycle: { 'proposal-1': { status: 'applied' } },
          settingsProposalHistory: {
            entries: { 'proposal-1': { appliedAt: 900, reverseChanges } },
          },
        }),
      )
      .provide([[matchers.call.fn(undoSettingsProposalWork), Promise.reject(new Error('no undo'))]])
      .put(proposalUndoStarted({ proposalId: 'proposal-1', startedAt: 1_000 }))
      .put(
        proposalFailed({
          proposalId: 'proposal-1',
          error: 'no undo',
          completedAt: 1_000,
          lastAction: 'undo',
        }),
      )
      .silentRun(0);

    expect(mocks.toastError).toHaveBeenCalledWith('Failed to undo changes', {
      description: 'no undo',
    });
  });

  it('dedupes double-dispatch and same applyToolCallId while already applying', async () => {
    const detail = makeDetail('settings-change');

    await expectSaga(
      handleApplyProposal,
      applyProposalRequested({ proposalId: 'proposal-1', kind: 'settings-change', detail }),
    )
      .withState(
        makeState({
          proposalLifecycle: { 'proposal-1': { status: 'applying', lastAction: 'apply' } },
        }),
      )
      .not.call.fn(applySettingsProposalWork)
      .silentRun(0);
  });

  it('ignores duplicate apply or undo while the same proposal worker is in flight', async () => {
    const action = applyProposalRequested({
      proposalId: 'proposal-1',
      kind: 'settings-change',
      detail: makeDetail('settings-change'),
    });
    const inFlight = handleApplyProposal(action);
    inFlight.next();

    await expectSaga(handleApplyProposal, action)
      .withState(makeState())
      .not.call.fn(applySettingsProposalWork)
      .silentRun(0);

    await expectSaga(
      handleUndoProposal,
      undoProposalRequested({ proposalId: 'proposal-1', kind: 'settings-change' }),
    )
      .withState(makeState())
      .not.call.fn(undoSettingsProposalWork)
      .silentRun(0);

    inFlight.return(undefined);
  });

  it('uses the same lifecycle key for specialist cards sharing an applyToolCallId', async () => {
    const detail = makeDetail('specialist-edit');

    await expectSaga(
      handleApplyProposal,
      applyProposalRequested({ proposalId: 'shared-tool-id', kind: 'specialist-edit', detail }),
    )
      .withState(
        makeState({
          proposalLifecycle: { 'shared-tool-id': { status: 'applying', lastAction: 'apply' } },
        }),
      )
      .not.call.fn(applySpecialistProposalWork)
      .silentRun(0);
  });

  it('runs specialist undo success and clears specialist history', async () => {
    const reverse = { kind: 'delete' as const, id: 'review-buddy', scope: 'user' as const };

    await expectSaga(
      handleUndoProposal,
      undoProposalRequested({ proposalId: 'proposal-1', kind: 'specialist-edit' }),
    )
      .withState(
        makeState({
          proposalLifecycle: { 'proposal-1': { status: 'applied' } },
          specialistProposalHistory: { entries: { 'proposal-1': { appliedAt: 900, reverse } } },
        }),
      )
      .provide([[matchers.call.fn(undoSpecialistProposalWork), undefined]])
      .put(clearSpecialistApplied('proposal-1'))
      .silentRun(0);
  });

  it('validates only persisted applied lifecycle entries', () => {
    expect(
      validateProposalLifecycleEntries({
        entries: {
          applied: { status: 'applied', completedAt: 1_000, lastAction: 'apply' },
          applying: { status: 'applying', completedAt: 1_000, lastAction: 'apply' },
          invalidResult: { status: 'applied', completedAt: 1_000, result: { workspaceId: 42 } },
        },
      }),
    ).toEqual({ applied: { status: 'applied', completedAt: 1_000, lastAction: 'apply' } });
  });

  it('hydrates persisted applied lifecycle entries', async () => {
    const stored = { entries: { p1: { status: 'applied', completedAt: 1_000 } } };

    await expectSaga(hydrateProposalLifecycleSaga)
      .provide([[matchers.call.fn(getLocalStorageJSON), stored]])
      .put(hydrateProposalLifecycle({ p1: { status: 'applied', completedAt: 1_000 } }))
      .silentRun(0);
  });

  it('persists only applied lifecycle entries', async () => {
    await expectSaga(persistProposalLifecycleSaga)
      .withState(
        makeState({
          proposalLifecycle: {
            p1: { status: 'applied', completedAt: 1_000 },
            p2: { status: 'failed', completedAt: 1_000, error: 'Nope', lastAction: 'apply' },
          },
        }),
      )
      .call(setLocalStorageJSON, PROPOSAL_LIFECYCLE_STORAGE_KEY, {
        entries: { p1: { status: 'applied', completedAt: 1_000 } },
      })
      .silentRun(0);
  });

  it('debounces rapid apply-success dispatches into a single localStorage write', async () => {
    vi.useRealTimers();
    const persistCalls: unknown[][] = [];

    await expectSaga(watchProposalLifecyclePersistenceSaga)
      .withState(
        makeState({
          proposalLifecycle: { p1: { status: 'applied', completedAt: 1_000 } },
        }),
      )
      .provide({
        call(effect, next) {
          if (effect.fn === setLocalStorageJSON) {
            persistCalls.push(effect.args);
            return undefined;
          }
          return next();
        },
      })
      .dispatch(proposalApplySucceeded({ proposalId: 'p1', completedAt: 1 }))
      .dispatch(proposalApplySucceeded({ proposalId: 'p2', completedAt: 2 }))
      .dispatch(proposalApplySucceeded({ proposalId: 'p3', completedAt: 3 }))
      .silentRun(PROPOSAL_LIFECYCLE_PERSIST_DEBOUNCE_MS + 100);

    expect(persistCalls).toHaveLength(1);
  });
});
