import { describe, expect, it } from 'vitest';
import {
  acceptOperationFinished,
  acceptOperationStarted,
  acceptWorkflowReducer,
  setMergeDrawerOpen,
  setMergeOptions,
} from './accept-workflow-slice';
import { selectAcceptOperationPending, selectMergeOptions } from './accept-workflow-selectors';
import type { AcceptOperation } from './accept-workflow-types';
import { gitReducer, setAcceptChangesStatus } from '../git/git-slice';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import type { WorkspaceGitStatus } from '$features/accept-changes/types';
import { acceptChangesConsumerMounted, acceptChangesConsumerUnmounted } from '../git/git-slice';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';

describe('accept workflow state', () => {
  it('refcounts consumers without losing the workspace observer on remount, and cleans up on close', () => {
    let state = acceptWorkflowReducer(undefined, acceptChangesConsumerUnmounted('a'));
    expect(state.byWorkspaceId.a).toBeUndefined();
    state = acceptWorkflowReducer(state, acceptChangesConsumerMounted('a'));
    state = acceptWorkflowReducer(state, acceptChangesConsumerMounted('a'));
    expect(state.byWorkspaceId.a.consumerCount).toBe(2);
    state = acceptWorkflowReducer(state, acceptChangesConsumerUnmounted('a'));
    state = acceptWorkflowReducer(state, acceptChangesConsumerUnmounted('a'));
    expect(state.byWorkspaceId.a.consumerCount).toBe(0);
    expect(state.byWorkspaceId.a.observerRequested).toBe(true);
    expect(acceptWorkflowReducer(state, acceptChangesConsumerUnmounted('a'))).toBe(state);
    state = acceptWorkflowReducer(state, acceptChangesConsumerMounted('b'));
    state = acceptWorkflowReducer(state, workspaceUnmounted('a'));
    expect(state.byWorkspaceId.a).toBeUndefined();
    expect(state.byWorkspaceId.b.consumerCount).toBe(1);
  });

  it('starts empty and preserves unrelated and duplicate updates', () => {
    const state = acceptWorkflowReducer(undefined, { type: 'init' });
    expect(state).toEqual({ byWorkspaceId: {} });
    expect(acceptWorkflowReducer(state, { type: 'other' })).toBe(state);
    expect(acceptWorkflowReducer(state, setMergeDrawerOpen('a', false))).toBe(state);
    const open = acceptWorkflowReducer(state, setMergeDrawerOpen('a', true));
    expect(open.byWorkspaceId.a.mergeDrawerOpen).toBe(true);
    expect(open.byWorkspaceId.b).toBeUndefined();
    expect(acceptWorkflowReducer(open, setMergeDrawerOpen('a', true))).toBe(open);
    expect(
      acceptWorkflowReducer(open, setMergeDrawerOpen('a', false)).byWorkspaceId.a.mergeDrawerOpen,
    ).toBe(false);
  });

  it('correlates terminal outcomes, clears pending, and round-trips JSON', () => {
    const old: AcceptOperation = {
      kind: 'merge',
      requestId: 'old',
      status: 'running',
      error: null,
    };
    const current: AcceptOperation = { ...old, requestId: 'current' };
    let state = acceptWorkflowReducer(undefined, acceptOperationStarted('a', old));
    state = acceptWorkflowReducer(state, acceptOperationStarted('a', current));
    expect(
      acceptWorkflowReducer(state, acceptOperationFinished('a', { ...old, status: 'succeeded' })),
    ).toBe(state);
    expect(
      selectAcceptOperationPending.select({ acceptWorkflow: state } as never, 'a', 'merge'),
    ).toBe(true);
    for (const status of ['failed', 'cancelled', 'succeeded'] as const) {
      const done = acceptWorkflowReducer(
        state,
        acceptOperationFinished('a', {
          ...current,
          status,
          error: status === 'failed' ? 'failed' : null,
        }),
      );
      expect(
        selectAcceptOperationPending.select({ acceptWorkflow: done } as never, 'a', 'merge'),
      ).toBe(false);
      expect(JSON.parse(JSON.stringify(done))).toEqual(done);
    }
  });

  it('derives defaults from wire state and retains workspace-scoped user options', () => {
    const acceptWorkflow = acceptWorkflowReducer(
      undefined,
      setMergeOptions('a', { squash: true, pushAfter: false }),
    );
    const state = {
      acceptWorkflow,
      git: gitReducer(
        undefined,
        setAcceptChangesStatus('a', { hasRemote: true } as WorkspaceGitStatus),
      ),
      workspace: {
        workspaces: createCollection('id', [{ id: 'a', pullRequests: [{ status: 'Open' }] }]),
      },
    };
    expect(selectMergeOptions.select(state as never, 'a')).toEqual({
      viaPR: true,
      squash: true,
      pushAfter: false,
    });
    expect(selectMergeOptions.select(state as never, 'b')).toEqual({
      viaPR: false,
      squash: false,
      pushAfter: false,
    });
    expect(acceptWorkflowReducer(acceptWorkflow, setMergeOptions('a', { squash: true }))).toBe(
      acceptWorkflow,
    );
  });
});
