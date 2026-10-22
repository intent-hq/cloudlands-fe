import { describe, expect, it } from 'vitest';
import {
  backendReconnected,
  workspaceUnmounted,
} from '../workspace-lifecycle/workspace-lifecycle-slice';
import { fileTrackingReducer, setPRContent } from '../changes/changes-slice';
import {
  prWorkflowReducer,
  prWorkflowRequested,
  setPRWorkflowDrawer,
  setPRWorkflowPendingAuth,
} from './pr-workflow-slice';
import { selectPRWorkflow, selectPRWorkflowOperation } from './pr-workflow-selectors';

describe('PR workflow state', () => {
  it('starts empty and stores correlated serializable outcomes without overwriting newer requests', () => {
    const initial = prWorkflowReducer(undefined, { type: 'init' });
    expect(initial).toEqual({ byWorkspaceId: {} });
    expect(prWorkflowReducer(initial, { type: 'other' })).toBe(initial);
    const first = prWorkflowRequested('a', { kind: 'pull' }, 'first');
    const second = prWorkflowRequested('a', { kind: 'pull' }, 'second');
    let state = prWorkflowReducer(initial, first);
    expect(prWorkflowReducer(state, first)).toBe(state);
    state = prWorkflowReducer(state, second);
    expect(prWorkflowReducer(state, first.success({ success: true }))).toBe(state);
    expect(
      selectPRWorkflowOperation.select({ prWorkflow: state } as never, 'a', 'pull')?.status,
    ).toBe('pending');
    state = prWorkflowReducer(state, second.success({ success: false, error: 'conflicts' }));
    expect(
      selectPRWorkflow.select({ prWorkflow: state } as never, 'a').operations.pull?.result,
    ).toEqual({ success: false, error: 'conflicts' });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('isolates drawers and pending authentication by workspace, clears auth on reconnect, ignores late completion after unmount', () => {
    let state = prWorkflowReducer(undefined, setPRWorkflowDrawer('a', 'prDrawerOpen', true));
    expect(prWorkflowReducer(state, setPRWorkflowDrawer('a', 'prDrawerOpen', true))).toBe(state);
    state = prWorkflowReducer(state, setPRWorkflowDrawer('b', 'commitDrawerOpen', true));
    const command = { kind: 'refresh-pr' as const, requireAuth: true };
    state = prWorkflowReducer(state, setPRWorkflowPendingAuth('a', command));
    expect(prWorkflowReducer(state, setPRWorkflowPendingAuth('a', command))).toBe(state);
    const request = prWorkflowRequested('a', command, 'auth');
    state = prWorkflowReducer(state, request);
    state = prWorkflowReducer(state, request.success({ success: false, needsAuth: true }));
    expect(state.byWorkspaceId.a.operations['refresh-pr']?.status).toBe('auth-required');
    state = prWorkflowReducer(state, backendReconnected());
    expect(state.byWorkspaceId.a.pendingAuth).toBeNull();
    expect(prWorkflowReducer(state, backendReconnected())).toBe(state);
    state = prWorkflowReducer(state, workspaceUnmounted('a'));
    expect(prWorkflowReducer(state, request.success({ success: true }))).toBe(state);
    expect(state.byWorkspaceId.b.commitDrawerOpen).toBe(true);
  });

  it('uses the existing changes draft owner and supports clearing both PR fields', () => {
    let state = fileTrackingReducer(undefined, setPRContent('a', 'Title', 'Body'));
    expect(fileTrackingReducer(state, setPRContent('a', 'Title', 'Body'))).toBe(state);
    state = fileTrackingReducer(state, setPRContent('b', 'Other', 'Other body'));
    state = fileTrackingReducer(state, setPRContent('a', '', ''));
    expect(state.byWorkspaceId.a.acceptChanges).toMatchObject({ prTitle: '', prDescription: '' });
    expect(state.byWorkspaceId.b.acceptChanges).toMatchObject({
      prTitle: 'Other',
      prDescription: 'Other body',
    });
  });
});
