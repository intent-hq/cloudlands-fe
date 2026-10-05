import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  applySettingsProposalWork: vi.fn(),
  undoSettingsProposalWork: vi.fn(),
  applySpecialistProposalWork: vi.fn(),
  undoSpecialistProposalWork: vi.fn(),
  toastError: vi.fn(),
  getJSON: vi.fn(),
  setJSON: vi.fn(),
}));

vi.mock('$lib/components/chat/proposals/settings-proposal-actions', () => ({
  applySettingsProposalWork: mocks.applySettingsProposalWork,
  undoSettingsProposalWork: mocks.undoSettingsProposalWork,
}));
vi.mock('$lib/components/chat/proposals/specialist-proposal-actions', () => ({
  applySpecialistProposalWork: mocks.applySpecialistProposalWork,
  undoSpecialistProposalWork: mocks.undoSpecialistProposalWork,
}));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: mocks.toastError } }));
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
  applyProposalRequested,
  proposalApplyStarted,
  proposalApplySucceeded,
  proposalFailed,
  hydrateProposalLifecycle,
  proposalResolutionReconciled,
  proposalUndoStarted,
  proposalUndoSucceeded,
  undoProposalRequested,
} from '../proposal-lifecycle-slice';
import {
  clearProposalApplied,
  recordProposalApplied,
} from '../../settings-proposal-history/settings-proposal-history-slice';
import {
  clearSpecialistApplied,
  recordSpecialistApplied,
} from '../../specialist-proposal-history/specialist-proposal-history-slice';
import type { ProposalActionDetail } from '$shared/types/proposal';
import type { ProposalLifecycleState } from '../proposal-lifecycle-types';
import type { SpecialistReverseAction } from '../../specialist-proposal-history/specialist-proposal-history-types';
import {
  handleApplyProposal,
  handleUndoProposal,
  hydrateProposalLifecycleSaga,
  persistProposalLifecycleSaga,
  proposalLifecycleSaga,
  PROPOSAL_LIFECYCLE_STORAGE_KEY,
  validateProposalLifecycleEntries,
} from './proposal-lifecycle-saga';

const settingsDetail = {
  proposal: { kind: 'settings-change', payload: { changes: [] } },
  editedFields: {},
} as unknown as ProposalActionDetail;

const specialistDetail = {
  proposal: { kind: 'specialist-edit', payload: {} },
  editedFields: {},
} as unknown as ProposalActionDetail;

const reverseChanges = [
  {
    path: 'theme.activePresetId',
    value: null,
    apply: { kind: 'redux-action', action: 'theme/selectThemePreset' },
  },
];

const specialistReverse: SpecialistReverseAction = {
  kind: 'delete',
  id: 'my-specialist',
  scope: 'user',
};

interface HarnessState {
  proposalLifecycle: Record<string, unknown>;
  settingsProposalHistory: { entries: Record<string, unknown> };
  specialistProposalHistory: { entries: Record<string, unknown> };
}

function emptyState(): HarnessState {
  return {
    proposalLifecycle: {},
    settingsProposalHistory: { entries: {} },
    specialistProposalHistory: { entries: {} },
  };
}

async function run(saga: (...args: never[]) => Generator, action: unknown, state: HarnessState) {
  const channel = stdChannel();
  const dispatched: Array<{ type: string; payload?: unknown }> = [];
  const task = runSaga(
    {
      channel,
      dispatch: (a: { type: string }) => {
        dispatched.push(a);
        return a;
      },
      getState: () => state,
    },
    saga as never,
    action as never,
  );
  await task.toPromise();
  return dispatched;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleApplyProposal', () => {
  it('applies a settings proposal and records the reverse changes', async () => {
    mocks.applySettingsProposalWork.mockResolvedValue({ reverseChanges });
    const dispatched = await run(
      handleApplyProposal,
      applyProposalRequested({
        proposalId: 'p-1',
        kind: 'settings-change',
        detail: settingsDetail,
      }),
      emptyState(),
    );

    expect(mocks.applySettingsProposalWork).toHaveBeenCalledWith(settingsDetail);
    expect(dispatched.map((a) => a.type)).toEqual([
      proposalApplyStarted.type,
      proposalApplySucceeded.type,
      recordProposalApplied.type,
    ]);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('applies a specialist proposal and records the reverse action', async () => {
    mocks.applySpecialistProposalWork.mockResolvedValue({ reverse: specialistReverse });
    const dispatched = await run(
      handleApplyProposal,
      applyProposalRequested({
        proposalId: 'p-2',
        kind: 'specialist-edit',
        detail: specialistDetail,
      }),
      emptyState(),
    );

    expect(mocks.applySpecialistProposalWork).toHaveBeenCalledWith(specialistDetail);
    expect(dispatched.map((a) => a.type)).toEqual([
      proposalApplyStarted.type,
      proposalApplySucceeded.type,
      recordSpecialistApplied.type,
    ]);
  });

  it('skips apply when the proposal is already applied', async () => {
    const state = emptyState();
    state.proposalLifecycle['p-1'] = { status: 'applied', completedAt: 1, lastAction: 'apply' };
    const dispatched = await run(
      handleApplyProposal,
      applyProposalRequested({
        proposalId: 'p-1',
        kind: 'settings-change',
        detail: settingsDetail,
      }),
      state,
    );

    expect(mocks.applySettingsProposalWork).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);
  });

  it('marks the proposal failed and toasts when apply work throws', async () => {
    mocks.applySettingsProposalWork.mockRejectedValue(new Error('boom'));
    const dispatched = await run(
      handleApplyProposal,
      applyProposalRequested({
        proposalId: 'p-1',
        kind: 'settings-change',
        detail: settingsDetail,
      }),
      emptyState(),
    );

    expect(dispatched.map((a) => a.type)).toEqual([proposalApplyStarted.type, proposalFailed.type]);
    const failure = dispatched[1] as ReturnType<typeof proposalFailed>;
    expect(failure.payload[0]).toMatchObject({
      proposalId: 'p-1',
      error: 'boom',
      lastAction: 'apply',
    });
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });

  it('fails on an unsupported proposal kind', async () => {
    const dispatched = await run(
      handleApplyProposal,
      applyProposalRequested({
        proposalId: 'p-1',
        kind: 'workspace-create' as never,
        detail: settingsDetail,
      }),
      emptyState(),
    );

    expect(dispatched.map((a) => a.type)).toEqual([proposalApplyStarted.type, proposalFailed.type]);
  });
});

describe('handleUndoProposal', () => {
  it('undoes an applied settings proposal and clears its history entry', async () => {
    mocks.undoSettingsProposalWork.mockResolvedValue(undefined);
    const state = emptyState();
    state.proposalLifecycle['p-1'] = { status: 'applied', completedAt: 1, lastAction: 'apply' };
    state.settingsProposalHistory.entries['p-1'] = { appliedAt: 1, reverseChanges };
    const dispatched = await run(
      handleUndoProposal,
      undoProposalRequested({ proposalId: 'p-1', kind: 'settings-change' }),
      state,
    );

    expect(mocks.undoSettingsProposalWork).toHaveBeenCalledWith(reverseChanges);
    expect(dispatched.map((a) => a.type)).toEqual([
      proposalUndoStarted.type,
      proposalUndoSucceeded.type,
      clearProposalApplied.type,
    ]);
  });

  it('undoes an applied specialist proposal and clears its history entry', async () => {
    mocks.undoSpecialistProposalWork.mockResolvedValue(undefined);
    const state = emptyState();
    state.proposalLifecycle['p-2'] = { status: 'applied', completedAt: 1, lastAction: 'apply' };
    state.specialistProposalHistory.entries['p-2'] = {
      appliedAt: 1,
      reverse: specialistReverse,
    };
    const dispatched = await run(
      handleUndoProposal,
      undoProposalRequested({ proposalId: 'p-2', kind: 'specialist-edit' }),
      state,
    );

    expect(mocks.undoSpecialistProposalWork).toHaveBeenCalledWith(specialistReverse);
    expect(dispatched.map((a) => a.type)).toEqual([
      proposalUndoStarted.type,
      proposalUndoSucceeded.type,
      clearSpecialistApplied.type,
    ]);
  });

  it('allows undo from history alone after a restart (no lifecycle entry)', async () => {
    mocks.undoSettingsProposalWork.mockResolvedValue(undefined);
    const state = emptyState();
    state.settingsProposalHistory.entries['p-1'] = { appliedAt: 1, reverseChanges };
    const dispatched = await run(
      handleUndoProposal,
      undoProposalRequested({ proposalId: 'p-1', kind: 'settings-change' }),
      state,
    );

    expect(mocks.undoSettingsProposalWork).toHaveBeenCalledWith(reverseChanges);
    expect(dispatched.map((a) => a.type)).toEqual([
      proposalUndoStarted.type,
      proposalUndoSucceeded.type,
      clearProposalApplied.type,
    ]);
  });

  it('skips undo when there is no lifecycle entry and no history', async () => {
    const dispatched = await run(
      handleUndoProposal,
      undoProposalRequested({ proposalId: 'p-1', kind: 'settings-change' }),
      emptyState(),
    );

    expect(mocks.undoSettingsProposalWork).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);
  });

  it('marks the proposal failed and toasts when undo work throws', async () => {
    mocks.undoSettingsProposalWork.mockRejectedValue(new Error('undo boom'));
    const state = emptyState();
    state.proposalLifecycle['p-1'] = { status: 'applied', completedAt: 1, lastAction: 'apply' };
    state.settingsProposalHistory.entries['p-1'] = { appliedAt: 1, reverseChanges };
    const dispatched = await run(
      handleUndoProposal,
      undoProposalRequested({ proposalId: 'p-1', kind: 'settings-change' }),
      state,
    );

    expect(dispatched.map((a) => a.type)).toEqual([proposalUndoStarted.type, proposalFailed.type]);
    const failure = dispatched[1] as ReturnType<typeof proposalFailed>;
    expect(failure.payload[0]).toMatchObject({
      proposalId: 'p-1',
      error: 'undo boom',
      lastAction: 'undo',
    });
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });
});

describe('validateProposalLifecycleEntries', () => {
  it('keeps only persisted applied/dismissed entries with valid fields', () => {
    const valid = { status: 'applied', completedAt: 5, lastAction: 'apply' };
    const dismissed = { status: 'dismissed', completedAt: 6, lastAction: 'dismiss' };
    expect(
      validateProposalLifecycleEntries({
        entries: {
          'p-1': valid,
          'p-2': dismissed,
          'p-3': { status: 'applying' },
          'p-4': { status: 'applied' },
          'p-5': null,
        },
      }),
    ).toEqual({ 'p-1': valid, 'p-2': dismissed });
  });

  it('returns an empty map for malformed storage payloads', () => {
    expect(validateProposalLifecycleEntries(null)).toEqual({});
    expect(validateProposalLifecycleEntries({ entries: [] })).toEqual({});
    expect(validateProposalLifecycleEntries('nope')).toEqual({});
  });
});

describe('persistence', () => {
  it('hydrates pruned entries from localStorage', async () => {
    const fresh = { status: 'applied', completedAt: Date.now(), lastAction: 'apply' };
    const stale = { status: 'applied', completedAt: 1, lastAction: 'apply' };
    mocks.getJSON.mockReturnValue({ entries: { 'p-new': fresh, 'p-old': stale } });
    const dispatched = await run(hydrateProposalLifecycleSaga, undefined, emptyState());

    expect(mocks.getJSON).toHaveBeenCalledWith(PROPOSAL_LIFECYCLE_STORAGE_KEY);
    expect(dispatched.map((a) => a.type)).toEqual([hydrateProposalLifecycle.type]);
    const hydrate = dispatched[0] as ReturnType<typeof hydrateProposalLifecycle>;
    expect(hydrate.payload[0]).toEqual({ 'p-new': fresh });
  });

  it('persists only applied/dismissed entries under the storage key', async () => {
    const state = emptyState();
    const applied = { status: 'applied', completedAt: Date.now(), lastAction: 'apply' };
    state.proposalLifecycle = {
      'p-applied': applied,
      'p-inflight': { status: 'applying', startedAt: 1 },
    };
    await run(persistProposalLifecycleSaga, undefined, state);

    expect(mocks.setJSON).toHaveBeenCalledWith(PROPOSAL_LIFECYCLE_STORAGE_KEY, {
      entries: { 'p-applied': applied },
    });
  });

  it.each(['transferring', 'imported'] as const)(
    'keeps unfinished %s checkpoints across history eviction, expiry, and reload',
    async (phase) => {
      const now = Date.now();
      const transfer = {
        workspaceId: 'ws-1',
        sourceWorkspacePath: '/repo/ws-1',
        sourceConnectionId: 'source',
        destinationConnectionId: 'target',
        phase,
      };
      const state = emptyState();
      state.proposalLifecycle = Object.fromEntries(
        Array.from({ length: 301 }, (_, i) => [
          `completed-${i}`,
          { status: 'applied', completedAt: now - i, lastAction: 'apply', result: { transfer } },
        ]),
      );
      state.proposalLifecycle['first-attempt'] = {
        status: 'applying',
        startedAt: now,
        lastAction: 'apply',
        result: { transfer },
      };
      state.proposalLifecycle['old-unresolved'] = {
        status: 'failed',
        completedAt: now - 31 * 24 * 60 * 60 * 1000,
        lastAction: 'apply',
        result: { transfer },
      };
      state.proposalLifecycle['old-completed'] = {
        status: 'applied',
        completedAt: now - 31 * 24 * 60 * 60 * 1000,
        lastAction: 'apply',
        result: { transfer },
      };
      await run(persistProposalLifecycleSaga, undefined, state);
      const stored = mocks.setJSON.mock.calls.at(-1)![1];
      expect(Object.keys(stored.entries)).toHaveLength(302);
      expect(stored.entries['completed-299']).toBeDefined();
      expect(stored.entries['completed-300']).toBeUndefined();
      expect(stored.entries['old-completed']).toBeUndefined();
      mocks.getJSON.mockReturnValue(stored);
      const dispatched = await run(hydrateProposalLifecycleSaga, undefined, emptyState());
      const restored = (dispatched[0] as ReturnType<typeof hydrateProposalLifecycle>).payload[0];
      expect(restored['first-attempt']).toMatchObject({
        status: 'failed',
        lastAction: 'apply',
        result: { transfer },
      });
      expect(restored['old-unresolved']).toMatchObject({
        status: 'failed',
        result: { transfer },
      });
    },
  );

  it('persists a dismissal when resolution reconciliation completes', async () => {
    vi.useFakeTimers();
    mocks.getJSON.mockReturnValue(undefined);
    const channel = stdChannel();
    const state = emptyState();
    const task = runSaga(
      {
        channel,
        dispatch: (action) => action,
        getState: () => state,
      },
      proposalLifecycleSaga,
    );
    await Promise.resolve();
    const dismissed = { status: 'dismissed', completedAt: Date.now(), lastAction: 'dismiss' };
    state.proposalLifecycle['agent-a::p-dismissed'] = dismissed;

    channel.put(
      proposalResolutionReconciled({
        proposalId: 'agent-a::p-dismissed',
        outcome: 'dismissed',
        completedAt: dismissed.completedAt,
      }),
    );
    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.setJSON).toHaveBeenCalledWith(PROPOSAL_LIFECYCLE_STORAGE_KEY, {
      entries: { 'agent-a::p-dismissed': dismissed },
    });
    task.cancel();
    await task.toPromise();
    vi.useRealTimers();
  });
});

describe('workspace transfer proposals', () => {
  const detail: ProposalActionDetail = {
    proposal: {
      kind: 'workspace-transfer',
      applyToolCallId: 'transfer-p',
      payload: {
        operation: 'workspace.transfer',
        workspaceId: 'ws-1',
        sourceWorkspacePath: '/repo/ws-1',
      },
      preview: { title: 'Transfer project' },
    },
    editedFields: { sourceConnectionId: 'source', destinationConnectionId: 'target' },
    selectedBulkItemIds: [],
  };
  const action = () =>
    applyProposalRequested({ proposalId: 'transfer-p', kind: 'workspace-transfer', detail });
  async function harness(initialLifecycle: ProposalLifecycleState = {}) {
    const { createCollection } =
      await import('@themislib/themis/utils/collections/collection-utils');
    const { proposalLifecycleReducer } = await import('../proposal-lifecycle-slice');
    let lifecycle = initialLifecycle;
    const state = () => ({
      ...emptyState(),
      proposalLifecycle: lifecycle,
      connections: {
        windowBackendId: 'source',
        connections: createCollection('id', [
          { id: 'source', label: 'Source' },
          { id: 'target', label: 'Target' },
        ]),
      },
    });
    return {
      run: () =>
        runSaga(
          {
            dispatch: (a: { type: string }) => {
              lifecycle = proposalLifecycleReducer(lifecycle, a);
            },
            getState: state,
          },
          handleApplyProposal,
          action(),
        ).toPromise(),
      get entry() {
        return lifecycle['transfer-p'];
      },
    };
  }
  it('starts only on approval and only retries finalize after import succeeds', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'offline' })
      .mockResolvedValueOnce({ success: true });
    const previousWindow = globalThis.window;
    vi.stubGlobal('window', { electronAPI: { invoke } });
    try {
      const h = await harness();
      expect(invoke).not.toHaveBeenCalled();
      await h.run();
      expect(h.entry.status).toBe('failed');
      expect(h.entry.result?.transfer?.phase).toBe('imported');
      await h.run();
      expect(h.entry.status).toBe('applied');
      expect(invoke.mock.calls).toEqual([
        [
          'transfer:start',
          {
            proposalId: 'transfer-p',
            workspaceId: 'ws-1',
            sourceWorkspacePath: '/repo/ws-1',
            sourceConnectionId: 'source',
            destination: { kind: 'server', connectionId: 'target' },
          },
        ],
        [
          'transfer:finalize',
          { proposalId: 'transfer-p', archiveSource: true, restartAgents: false },
        ],
        [
          'transfer:finalize',
          { proposalId: 'transfer-p', archiveSource: true, restartAgents: false },
        ],
      ]);
      await h.run();
      expect(invoke).toHaveBeenCalledTimes(3);
      expect(mocks.setJSON).toHaveBeenCalled();
    } finally {
      vi.stubGlobal('window', previousWindow);
    }
  });
  it('retries only finalize after restoring the first import checkpoint alongside a full history', async () => {
    let importedSnapshot: unknown;
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockImplementationOnce(() => {
        importedSnapshot = mocks.setJSON.mock.calls.at(-1)![1];
        return { success: false, error: 'offline' };
      })
      .mockResolvedValueOnce({ success: true });
    const previousWindow = globalThis.window;
    vi.stubGlobal('window', { electronAPI: { invoke } });
    try {
      const history: ProposalLifecycleState = Object.fromEntries(
        Array.from({ length: 301 }, (_, i) => [
          `completed-${i}`,
          { status: 'applied', completedAt: Date.now() - i, lastAction: 'apply' },
        ]),
      );
      const first = await harness(history);
      await first.run();
      mocks.getJSON.mockReturnValue(importedSnapshot);
      const dispatched = await run(hydrateProposalLifecycleSaga, undefined, emptyState());
      const restored = (dispatched[0] as ReturnType<typeof hydrateProposalLifecycle>).payload[0];
      const reloaded = await harness(restored);
      expect(reloaded.entry).toMatchObject({
        status: 'failed',
        result: { transfer: { phase: 'imported', destinationConnectionId: 'target' } },
      });
      await reloaded.run();
      expect(reloaded.entry.status).toBe('applied');
      expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
        'transfer:start',
        'transfer:finalize',
        'transfer:finalize',
      ]);
    } finally {
      vi.stubGlobal('window', previousWindow);
    }
  });

  it('ignores simultaneous approvals while the relay is running', async () => {
    let finish!: (value: { success: boolean }) => void;
    const invoke = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
      .mockResolvedValue({ success: true });
    const previousWindow = globalThis.window;
    vi.stubGlobal('window', { electronAPI: { invoke } });
    try {
      const h = await harness();
      const first = h.run();
      await h.run();
      expect(invoke).toHaveBeenCalledTimes(1);
      finish({ success: true });
      await first;
      expect(invoke).toHaveBeenCalledTimes(2);
    } finally {
      vi.stubGlobal('window', previousWindow);
    }
  });
  it('rejects a browser bridge with an actionable desktop error', async () => {
    const invoke = vi.fn();
    const previousWindow = globalThis.window;
    vi.stubGlobal('window', { electronAPI: { invoke, versions: { electron: '0.0.0-browser' } } });
    try {
      const h = await harness();
      await h.run();
      expect(h.entry.status).toBe('failed');
      expect(h.entry.error).toContain('desktop');
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal('window', previousWindow);
    }
  });
  it('restores an interrupted checkpoint as retryable instead of pending approval', () => {
    const result = {
      transfer: {
        workspaceId: 'ws-1',
        sourceWorkspacePath: '/repo/ws-1',
        sourceConnectionId: 'source',
        destinationConnectionId: 'target',
        phase: 'imported',
      },
    };
    expect(
      validateProposalLifecycleEntries({
        entries: { p: { status: 'applying', startedAt: 10, lastAction: 'apply', result } },
      }).p,
    ).toMatchObject({ status: 'failed', result, lastAction: 'apply' });
  });
});
