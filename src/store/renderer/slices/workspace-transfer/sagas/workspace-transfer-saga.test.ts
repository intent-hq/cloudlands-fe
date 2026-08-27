import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({ request: vi.fn(), invoke: vi.fn(), toastWarning: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.request }));
vi.mock('svelte-sonner', () => ({ toast: { warning: mocks.toastWarning } }));

import {
  closeTransferModal,
  initialState,
  openTransferModal,
  selectTransferDestination,
  transferFinalizeRequested,
  transferPlanLoaded,
  transferPlanRequested,
  transferRunSucceeded,
  transferStartRequested,
  workspaceTransferReducer,
} from '../workspace-transfer-slice';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { m } from '$shared/paraglide/messages.js';
import { switchConnectionRequested } from '../../connections/connections-slice';
import type { ConnectionRecord, ConnectionsState } from '../../connections/connections-types';
import type { TransferPlan, WorkspaceTransferState } from '../workspace-transfer-types';
import { workspaceTransferSaga } from './workspace-transfer-saga';

const plan: TransferPlan = {
  manifest: {
    formatVersion: 1,
    creatingIntentdVersion: '0.9.0',
    workspaceId: 'ws-1',
    createdAt: '2026-08-11T00:00:00Z',
    tables: [{ name: 'note', rowCount: 3, approxBytes: 512 }],
    assets: [],
    git: { hasRepository: false, dirtyFiles: [], sandboxBranches: [] },
  },
  totalSizeBytes: 512,
  dbRowBytes: 512,
  assetBytes: 0,
  estimatedGitBundleBytes: 0,
  warnings: [],
};

const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

/** Minimal connections slice: one eligible remote target. */
function connectionsState(): ConnectionsState {
  return {
    connections: createCollection<ConnectionRecord, 'id'>('id', [
      {
        id: 'conn-1',
        label: '10.0.0.2:5181',
        host: '10.0.0.2',
        port: 5181,
        fingerprint: 'AA:BB',
        isLocal: false,
        hostname: 'devbox',
      },
    ]),
    activeId: 'local',
    status: 'idle',
    error: null,
    certMismatch: null,
    authRejected: null,
    protocolMismatch: null,
    protocolMismatchModalDismissed: false,
  } as ConnectionsState;
}

function harness(seed: WorkspaceTransferState = initialState) {
  const channel = stdChannel();
  let state = seed;
  const dispatch = vi.fn((action) => {
    state = workspaceTransferReducer(state, action);
    channel.put(action);
  });
  const task = runSaga(
    {
      channel,
      dispatch,
      getState: () => ({ workspaceTransfer: state, connections: connectionsState() }),
    },
    workspaceTransferSaga,
  );
  return { channel, dispatch, task, state: () => state };
}

function openedForPlan(): WorkspaceTransferState {
  let state = workspaceTransferReducer(
    initialState,
    openTransferModal({ workspaceId: 'ws-1', workspaceTitle: 'My Space' }),
  );
  state = workspaceTransferReducer(state, selectTransferDestination({ kind: 'download' }));
  return workspaceTransferReducer(state, transferPlanRequested());
}

describe('workspaceTransferSaga', () => {
  afterEach(() => {
    mocks.request.mockReset();
  });

  it('sends workspace.transfer.plan with the pending workspaceId and stores the plan', async () => {
    mocks.request.mockResolvedValue({ plan });
    const h = harness(openedForPlan());

    h.channel.put(transferPlanRequested());
    await settle();

    expect(mocks.request).toHaveBeenCalledWith('workspace.transfer.plan', {
      workspaceId: 'ws-1',
    });
    expect(h.state().planStatus).toBe('loaded');
    expect(h.state().plan).toEqual(plan);
    h.task.cancel();
  });

  it('stores the error message when the plan fetch fails', async () => {
    mocks.request.mockRejectedValue(new Error('daemon unavailable'));
    const h = harness(openedForPlan());

    h.channel.put(transferPlanRequested());
    await settle();

    expect(h.state().planStatus).toBe('error');
    expect(h.state().planError).toBe('daemon unavailable');
    h.task.cancel();
  });

  it('does nothing when no workspace is pending (modal closed)', async () => {
    const h = harness(initialState);

    h.channel.put(transferPlanRequested());
    await settle();

    expect(mocks.request).not.toHaveBeenCalled();
    h.task.cancel();
  });
});

function confirmLoadedState(
  destination: { kind: 'server'; connectionId: string } | { kind: 'download' },
): WorkspaceTransferState {
  let state = workspaceTransferReducer(
    initialState,
    openTransferModal({ workspaceId: 'ws-1', workspaceTitle: 'My Space' }),
  );
  state = workspaceTransferReducer(state, selectTransferDestination(destination));
  state = workspaceTransferReducer(state, transferPlanRequested());
  return workspaceTransferReducer(state, transferPlanLoaded(plan));
}

describe('workspaceTransferSaga — steps 3–4', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      electronAPI: { invoke: mocks.invoke, on: vi.fn(() => 'listener-1'), offById: vi.fn() },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mocks.invoke.mockReset();
  });

  it('transfer:start success lands on the result step with the payload', async () => {
    mocks.invoke.mockResolvedValue({ success: true, interruptedAgents: ['agent-1'] });
    const h = harness(
      workspaceTransferReducer(
        confirmLoadedState({ kind: 'server', connectionId: 'conn-1' }),
        transferStartRequested(),
      ),
    );

    h.channel.put(transferStartRequested());
    await settle();

    expect(mocks.invoke).toHaveBeenCalledWith('transfer:start', {
      workspaceId: 'ws-1',
      destination: { kind: 'server', connectionId: 'conn-1' },
    });
    expect(h.state().step).toBe('result');
    expect(h.state().runStatus).toBe('succeeded');
    expect(h.state().interruptedAgents).toEqual(['agent-1']);
    h.task.cancel();
  });

  it('transfer:start failure lands on the failed result with the reason', async () => {
    mocks.invoke.mockResolvedValue({
      success: false,
      error: 'destination unavailable',
      failurePhase: 'preflight',
    });
    const h = harness(
      workspaceTransferReducer(
        confirmLoadedState({ kind: 'server', connectionId: 'conn-1' }),
        transferStartRequested(),
      ),
    );

    h.channel.put(transferStartRequested());
    await settle();

    expect(h.state().runStatus).toBe('failed');
    expect(h.state().runError).toBe('destination unavailable');
    expect(h.state().failurePhase).toBe('preflight');
    h.task.cancel();
  });

  it('maps a not-session-owner rejection to the localized message', async () => {
    mocks.invoke.mockResolvedValue({
      success: false,
      error: 'the transfer session belongs to another window',
      code: 'not-session-owner',
    });
    const h = harness(
      workspaceTransferReducer(
        confirmLoadedState({ kind: 'server', connectionId: 'conn-1' }),
        transferStartRequested(),
      ),
    );

    h.channel.put(transferStartRequested());
    await settle();

    expect(h.state().runStatus).toBe('failed');
    expect(h.state().runError).toBe(m.workspace_transfer_notSessionOwner_error());
    h.task.cancel();
  });

  it('a dismissed save dialog returns to confirm (no failure)', async () => {
    mocks.invoke.mockResolvedValue({ success: false, canceled: true });
    const h = harness(
      workspaceTransferReducer(confirmLoadedState({ kind: 'download' }), transferStartRequested()),
    );

    h.channel.put(transferStartRequested());
    await settle();

    expect(h.state().step).toBe('confirm');
    expect(h.state().runStatus).toBe('idle');
    h.task.cancel();
  });

  it('finalize sends archive/restart flags, closes the modal, and switches when asked', async () => {
    mocks.invoke.mockResolvedValue({ success: true });
    let state = workspaceTransferReducer(
      confirmLoadedState({ kind: 'server', connectionId: 'conn-1' }),
      transferStartRequested(),
    );
    state = workspaceTransferReducer(
      state,
      transferRunSucceeded({ interruptedAgents: ['agent-1'], downloadFilePath: null }),
    );
    const h = harness(state);

    h.channel.put(transferFinalizeRequested({ switchToTarget: true }));
    await settle();

    expect(mocks.invoke).toHaveBeenCalledWith(
      'transfer:finalize',
      expect.objectContaining({
        archiveSource: true,
        restartAgents: false,
        finalStatusMessage: expect.stringContaining('devbox'),
      }),
    );
    expect(h.dispatch).toHaveBeenCalledWith(closeTransferModal());
    const switchAction = h.dispatch.mock.calls
      .map(([action]) => action)
      .find((action) => action.type === switchConnectionRequested('conn-1').type);
    expect(switchAction?.payload).toEqual(['conn-1']);
    h.task.cancel();
  });

  it('finalize for a download forces archiveSource off and sends no status message', async () => {
    mocks.invoke.mockResolvedValue({ success: true });
    let state = workspaceTransferReducer(
      confirmLoadedState({ kind: 'download' }),
      transferStartRequested(),
    );
    state = workspaceTransferReducer(
      state,
      transferRunSucceeded({ interruptedAgents: [], downloadFilePath: '/tmp/ws-1.zip' }),
    );
    const h = harness(state);

    h.channel.put(transferFinalizeRequested({ switchToTarget: false }));
    await settle();

    expect(mocks.invoke).toHaveBeenCalledWith('transfer:finalize', {
      archiveSource: false,
      restartAgents: false,
    });
    expect(h.dispatch).toHaveBeenCalledWith(closeTransferModal());
    h.task.cancel();
  });

  it('finalize success with resumeFailed surfaces a warning toast and still closes', async () => {
    mocks.invoke.mockResolvedValue({ success: true, resumeFailed: ['agent-1', 'agent-2'] });
    let state = workspaceTransferReducer(
      confirmLoadedState({ kind: 'server', connectionId: 'conn-1' }),
      transferStartRequested(),
    );
    state = workspaceTransferReducer(
      state,
      transferRunSucceeded({ interruptedAgents: ['agent-1', 'agent-2'], downloadFilePath: null }),
    );
    const h = harness(state);

    h.channel.put(transferFinalizeRequested({ switchToTarget: false }));
    await settle();
    // The toast module is dynamically imported — allow a macrotask to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settle();

    expect(mocks.toastWarning).toHaveBeenCalledOnce();
    expect(mocks.toastWarning.mock.calls[0][0]).toContain('2');
    expect(h.dispatch).toHaveBeenCalledWith(closeTransferModal());
    h.task.cancel();
  });

  it('finalize failure stays on the result step with the error', async () => {
    mocks.invoke.mockResolvedValue({ success: false, error: 'workspace gone' });
    let state = workspaceTransferReducer(
      confirmLoadedState({ kind: 'server', connectionId: 'conn-1' }),
      transferStartRequested(),
    );
    state = workspaceTransferReducer(
      state,
      transferRunSucceeded({ interruptedAgents: [], downloadFilePath: null }),
    );
    const h = harness(state);

    h.channel.put(transferFinalizeRequested({ switchToTarget: false }));
    await settle();

    expect(h.state().open).toBe(true);
    expect(h.state().finalizeStatus).toBe('error');
    expect(h.state().finalizeError).toBe('workspace gone');
    expect(h.dispatch).not.toHaveBeenCalledWith(closeTransferModal());
    h.task.cancel();
  });

  it('closing the wizard fires a best-effort transfer:cancel', async () => {
    mocks.invoke.mockResolvedValue({ success: true });
    const h = harness(
      workspaceTransferReducer(
        confirmLoadedState({ kind: 'server', connectionId: 'conn-1' }),
        transferStartRequested(),
      ),
    );

    h.channel.put(closeTransferModal());
    await settle();

    expect(mocks.invoke).toHaveBeenCalledWith('transfer:cancel', undefined);
    h.task.cancel();
  });
});
