import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

import type { Workspace, WorkspaceId } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import { setWorkspaceEntity, workspaceReducer } from '../../workspace/workspace-slice';
import { openWorkspaceTab, proposalWorkspaceCreated, tabStateReducer } from '../tab-state-slice';
import {
  PROPOSAL_WORKSPACE_TAB_WAIT_MS,
  proposalWorkspaceTabSaga,
} from './proposal-workspace-tab-saga';

const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function makeWorkspace(id: string): Workspace {
  return {
    id: id as WorkspaceId,
    title: 'Follow-up',
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatusEnum.Active,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function createHarness() {
  let state = {
    tabState: tabStateReducer(undefined, { type: '@@INIT' }),
    workspace: workspaceReducer(undefined, { type: '@@INIT' }),
  };
  const channel = stdChannel();
  const dispatch = vi.fn((action: { type: string; payload?: unknown }) => {
    state = {
      tabState: tabStateReducer(state.tabState, action as never),
      workspace: workspaceReducer(state.workspace, action as never),
    };
    channel.put(action);
    return action;
  });
  const task = runSaga({ channel, dispatch, getState: () => state }, proposalWorkspaceTabSaga);
  return {
    dispatch,
    tabOrder: () => state.tabState.workspaceStacks.flat(),
    currentTabId: () => state.tabState.currentTabId,
    task,
  };
}

describe('proposalWorkspaceTabSaga', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds the workspace as an unfocused tab once its row loads', async () => {
    const harness = createHarness();
    harness.dispatch(openWorkspaceTab('ws-source'));
    harness.dispatch(proposalWorkspaceCreated('ws-new', 'ws-source'));
    await settle();
    // Not loaded yet: a tab now would be pruned as a ghost by reconciliation.
    expect(harness.tabOrder()).toEqual(['ws-source']);

    harness.dispatch(setWorkspaceEntity(makeWorkspace('ws-new')));
    await settle();
    expect(harness.tabOrder()).toEqual(['ws-source', 'ws-new']);
    expect(harness.currentTabId()).toBe('ws-source');
    harness.task.cancel();
  });

  it('adds the tab immediately when the row is already loaded', async () => {
    const harness = createHarness();
    harness.dispatch(openWorkspaceTab('ws-source'));
    harness.dispatch(setWorkspaceEntity(makeWorkspace('ws-new')));
    harness.dispatch(proposalWorkspaceCreated('ws-new', 'ws-source'));
    await settle();
    expect(harness.tabOrder()).toEqual(['ws-source', 'ws-new']);
    expect(harness.currentTabId()).toBe('ws-source');
    harness.task.cancel();
  });

  it('ignores the proposal when this window does not show the source workspace', async () => {
    const harness = createHarness();
    harness.dispatch(openWorkspaceTab('ws-other'));
    harness.dispatch(setWorkspaceEntity(makeWorkspace('ws-new')));
    harness.dispatch(proposalWorkspaceCreated('ws-new', 'ws-source'));
    await settle();
    expect(harness.tabOrder()).toEqual(['ws-other']);
    harness.task.cancel();
  });

  it('gives up when the row never loads within the wait window', async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    harness.dispatch(openWorkspaceTab('ws-source'));
    harness.dispatch(proposalWorkspaceCreated('ws-new', 'ws-source'));
    await vi.advanceTimersByTimeAsync(PROPOSAL_WORKSPACE_TAB_WAIT_MS + 1);
    harness.dispatch(setWorkspaceEntity(makeWorkspace('ws-new')));
    await settle();
    expect(harness.tabOrder()).toEqual(['ws-source']);
    harness.task.cancel();
  });
});
