import { describe, expect, it } from 'vitest';

import {
  closeTransferModal,
  initialState,
  openTransferModal,
  selectTransferDestination,
  transferPlanFailed,
  transferPlanLoaded,
  transferPlanRequested,
  transferWizardBack,
  workspaceTransferReducer,
} from './workspace-transfer-slice';
import type { TransferPlan, WorkspaceTransferState } from './workspace-transfer-types';

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
