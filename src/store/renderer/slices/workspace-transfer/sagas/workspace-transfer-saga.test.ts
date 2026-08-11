import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.request }));

import {
  initialState,
  openTransferModal,
  selectTransferDestination,
  transferPlanRequested,
  workspaceTransferReducer,
} from '../workspace-transfer-slice';
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
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function harness(seed: WorkspaceTransferState = initialState) {
  const channel = stdChannel();
  let state = seed;
  const dispatch = vi.fn((action) => {
    state = workspaceTransferReducer(state, action);
  });
  const task = runSaga(
    { channel, dispatch, getState: () => ({ workspaceTransfer: state }) },
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
