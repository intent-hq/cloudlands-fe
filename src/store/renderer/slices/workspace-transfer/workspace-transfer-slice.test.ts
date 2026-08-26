import { describe, expect, it } from 'vitest';

import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type { StoreState } from '../../types';
import { initialState as connectionsInitialState } from '../connections/connections-slice';
import type { ConnectionRecord } from '../connections/connections-types';
import { selectTransferTargetConnections } from './workspace-transfer-selectors';
import {
  closeTransferModal,
  initialState,
  openTransferModal,
  selectTransferDestination,
  setTransferArchiveSource,
  setTransferRestartAgents,
  transferFinalizeFailed,
  transferFinalizeRequested,
  transferFinalizeSucceeded,
  transferPlanFailed,
  transferPlanLoaded,
  transferPlanRequested,
  transferProgressReceived,
  transferRunCancelled,
  transferRunFailed,
  transferRunSucceeded,
  transferStartRequested,
  transferWizardBack,
  workspaceTransferReducer,
} from './workspace-transfer-slice';
import type {
  TransferPlan,
  TransferProgress,
  WorkspaceTransferState,
} from './workspace-transfer-types';

const plan: TransferPlan = {
  manifest: {
    formatVersion: 1,
    creatingIntentdVersion: '0.9.0',
    workspaceId: 'ws-1',
    createdAt: '2026-08-11T00:00:00Z',
    tables: [{ name: 'note', rowCount: 12, approxBytes: 4096 }],
    assets: [{ id: 'a.png', sizeBytes: 2048 }],
    git: { hasRepository: true, branch: 'main', dirtyFiles: [], sandboxBranches: [] },
  },
  totalSizeBytes: 10240,
  dbRowBytes: 4096,
  assetBytes: 2048,
  estimatedGitBundleBytes: 4096,
  warnings: [{ code: 'agents-running', message: '1 agent(s) are running' }],
};

function openState(): WorkspaceTransferState {
  return workspaceTransferReducer(
    initialState,
    openTransferModal({ workspaceId: 'ws-1', workspaceTitle: 'My Space' }),
  );
}

function confirmLoadingState(): WorkspaceTransferState {
  let state = openState();
  state = workspaceTransferReducer(state, selectTransferDestination({ kind: 'download' }));
  return workspaceTransferReducer(state, transferPlanRequested());
}

describe('workspaceTransferReducer', () => {
  it('has a closed initial state', () => {
    expect(initialState.open).toBe(false);
    expect(initialState.step).toBe('destination');
    expect(initialState.planStatus).toBe('idle');
  });

  it('openTransferModal resets to a fresh wizard for the workspace', () => {
    const dirty = { ...confirmLoadingState(), planError: 'boom' };
    const state = workspaceTransferReducer(
      dirty,
      openTransferModal({ workspaceId: 'ws-2', workspaceTitle: 'Other' }),
    );
    expect(state).toEqual({
      ...initialState,
      open: true,
      workspaceId: 'ws-2',
      workspaceTitle: 'Other',
    });
  });

  it('closeTransferModal returns to the initial state', () => {
    expect(workspaceTransferReducer(confirmLoadingState(), closeTransferModal())).toEqual(
      initialState,
    );
  });

  it('selectTransferDestination stores server and download destinations', () => {
    let state = openState();
    state = workspaceTransferReducer(
      state,
      selectTransferDestination({ kind: 'server', connectionId: 'conn-1' }),
    );
    expect(state.destination).toEqual({ kind: 'server', connectionId: 'conn-1' });
    state = workspaceTransferReducer(state, selectTransferDestination({ kind: 'download' }));
    expect(state.destination).toEqual({ kind: 'download' });
  });

  it('transferPlanRequested advances to confirm in loading only with a destination', () => {
    const noDestination = workspaceTransferReducer(openState(), transferPlanRequested());
    expect(noDestination.step).toBe('destination');
    expect(noDestination.planStatus).toBe('idle');

    const state = confirmLoadingState();
    expect(state.step).toBe('confirm');
    expect(state.planStatus).toBe('loading');
    expect(state.plan).toBeNull();
    expect(state.planError).toBeNull();
  });

  it('transferPlanLoaded stores the plan on the confirm step', () => {
    const state = workspaceTransferReducer(confirmLoadingState(), transferPlanLoaded(plan));
    expect(state.planStatus).toBe('loaded');
    expect(state.plan).toEqual(plan);
  });

  it('transferPlanLoaded is ignored when the modal is closed (stale response)', () => {
    const closed = workspaceTransferReducer(confirmLoadingState(), closeTransferModal());
    expect(workspaceTransferReducer(closed, transferPlanLoaded(plan))).toEqual(initialState);
  });

  it('transferPlanFailed stores the error on the confirm step', () => {
    const state = workspaceTransferReducer(confirmLoadingState(), transferPlanFailed('nope'));
    expect(state.planStatus).toBe('error');
    expect(state.planError).toBe('nope');
    expect(state.plan).toBeNull();
  });

  it('transferWizardBack returns to destination and clears the plan, keeping the pick', () => {
    let state = workspaceTransferReducer(confirmLoadingState(), transferPlanLoaded(plan));
    state = workspaceTransferReducer(state, transferWizardBack());
    expect(state.step).toBe('destination');
    expect(state.planStatus).toBe('idle');
    expect(state.plan).toBeNull();
    expect(state.destination).toEqual({ kind: 'download' });
  });
});

function confirmLoadedState(): WorkspaceTransferState {
  return workspaceTransferReducer(confirmLoadingState(), transferPlanLoaded(plan));
}

function transferringState(): WorkspaceTransferState {
  return workspaceTransferReducer(confirmLoadedState(), transferStartRequested());
}

const relayProgress: TransferProgress = {
  phase: 'relaying',
  bytesTotal: 10240,
  bytesDown: 5120,
  bytesUp: 4096,
  chunksTotal: 2,
  chunksDone: 1,
};

describe('workspaceTransferReducer — steps 3–4', () => {
  it('transferStartRequested advances confirm → transferring in running', () => {
    const state = transferringState();
    expect(state.step).toBe('transferring');
    expect(state.runStatus).toBe('running');
    expect(state.progress).toBeNull();
    expect(state.runError).toBeNull();
  });

  it('transferStartRequested is ignored outside confirm/failed-result', () => {
    expect(workspaceTransferReducer(openState(), transferStartRequested()).step).toBe(
      'destination',
    );
    const succeeded = workspaceTransferReducer(
      transferringState(),
      transferRunSucceeded({ interruptedAgents: [], downloadFilePath: null }),
    );
    expect(workspaceTransferReducer(succeeded, transferStartRequested()).step).toBe('result');
  });

  it('retry from a failed result restarts the run and clears prior outcome', () => {
    const failed = workspaceTransferReducer(
      transferringState(),
      transferRunFailed({ error: 'boom', failurePhase: 'preflight' }),
    );
    expect(failed.step).toBe('result');
    expect(failed.runStatus).toBe('failed');
    expect(failed.failurePhase).toBe('preflight');
    const retried = workspaceTransferReducer(failed, transferStartRequested());
    expect(retried.step).toBe('transferring');
    expect(retried.runStatus).toBe('running');
    expect(retried.runError).toBeNull();
    expect(retried.failurePhase).toBeNull();
  });

  it('progress frames update only while running', () => {
    const state = workspaceTransferReducer(
      transferringState(),
      transferProgressReceived(relayProgress),
    );
    expect(state.progress).toEqual(relayProgress);

    // Ignored after the run settled.
    const settled = workspaceTransferReducer(
      state,
      transferRunFailed({ error: 'x', failurePhase: 'post-export' }),
    );
    expect(
      workspaceTransferReducer(settled, transferProgressReceived(relayProgress)).progress,
    ).toEqual(settled.progress);
  });

  it('transferRunSucceeded lands on the result step with the payload', () => {
    const state = workspaceTransferReducer(
      transferringState(),
      transferRunSucceeded({ interruptedAgents: ['a-1'], downloadFilePath: null }),
    );
    expect(state.step).toBe('result');
    expect(state.runStatus).toBe('succeeded');
    expect(state.interruptedAgents).toEqual(['a-1']);
    expect(state.archiveSource).toBe(true); // default ON
  });

  it('transferRunCancelled (dismissed save dialog) returns to confirm', () => {
    const state = workspaceTransferReducer(transferringState(), transferRunCancelled());
    expect(state.step).toBe('confirm');
    expect(state.runStatus).toBe('idle');
  });

  it('restartAgents and archiveSource toggles update state', () => {
    let state = transferringState();
    state = workspaceTransferReducer(state, setTransferRestartAgents(true));
    expect(state.restartAgents).toBe(true);
    state = workspaceTransferReducer(state, setTransferArchiveSource(false));
    expect(state.archiveSource).toBe(false);
  });

  it('finalize lifecycle: requested → succeeded / failed', () => {
    const result = workspaceTransferReducer(
      transferringState(),
      transferRunSucceeded({ interruptedAgents: [], downloadFilePath: null }),
    );
    const running = workspaceTransferReducer(
      result,
      transferFinalizeRequested({ switchToTarget: false }),
    );
    expect(running.finalizeStatus).toBe('running');

    expect(workspaceTransferReducer(running, transferFinalizeSucceeded()).finalizeStatus).toBe(
      'done',
    );
    const failed = workspaceTransferReducer(running, transferFinalizeFailed('workspace gone'));
    expect(failed.finalizeStatus).toBe('error');
    expect(failed.finalizeError).toBe('workspace gone');
  });

  it('finalize is rejected while transferring or after failure', () => {
    const transferring = transferringState();
    expect(
      workspaceTransferReducer(transferring, transferFinalizeRequested({ switchToTarget: false }))
        .finalizeStatus,
    ).toBe('idle');
    const failed = workspaceTransferReducer(
      transferring,
      transferRunFailed({ error: 'x', failurePhase: 'post-export' }),
    );
    expect(
      workspaceTransferReducer(failed, transferFinalizeRequested({ switchToTarget: false }))
        .finalizeStatus,
    ).toBe('idle');
  });

  it('closeTransferModal resets steps 3–4 state too', () => {
    let state = workspaceTransferReducer(
      transferringState(),
      transferRunSucceeded({ interruptedAgents: ['a-1'], downloadFilePath: '/tmp/x.zip' }),
    );
    state = workspaceTransferReducer(state, setTransferRestartAgents(true));
    expect(workspaceTransferReducer(state, closeTransferModal())).toEqual(initialState);
  });
});

describe('selectTransferTargetConnections', () => {
  const LOCAL: ConnectionRecord = {
    id: LOCAL_CONNECTION_ID,
    label: 'This machine (local)',
    host: null,
    port: null,
    fingerprint: null,
    isLocal: true,
  };

  const remote = (id: string, host: string): ConnectionRecord => ({
    id,
    label: `${host}:8443`,
    host,
    port: 8443,
    fingerprint: 'AB:CD',
    isLocal: false,
  });

  const REMOTE_1 = remote('remote-1', '10.0.0.5');
  const REMOTE_2 = remote('remote-2', '10.0.0.6');

  function connectionsState(records: ConnectionRecord[], activeId: string): StoreState {
    return {
      connections: {
        ...connectionsInitialState,
        connections: createCollection<ConnectionRecord, 'id'>('id', records),
        activeId,
      },
    } as unknown as StoreState;
  }

  it('remote active: lists local and the other remotes, excluding the active backend', () => {
    const state = connectionsState([LOCAL, REMOTE_1, REMOTE_2], 'remote-1');
    expect(selectTransferTargetConnections.select(state)).toEqual([LOCAL, REMOTE_2]);
  });

  it('local active: lists only remotes (local excluded as the active backend)', () => {
    const state = connectionsState([LOCAL, REMOTE_1, REMOTE_2], LOCAL_CONNECTION_ID);
    expect(selectTransferTargetConnections.select(state)).toEqual([REMOTE_1, REMOTE_2]);
  });
});
