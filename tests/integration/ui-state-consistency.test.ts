import {
  clearChatDraft,
  initialState,
  setChatDraft,
  setSidebarActiveTab,
  transientUiReducer,
} from '$store/renderer/slices/transient-ui/transient-ui-slice';
import { describe, expect, it } from 'vitest';

describe('UI state consistency', () => {
  it('keeps chat drafts separate by workspace and agent', () => {
    let state = transientUiReducer(initialState, setChatDraft('ws-1', 'agent-1', 'First draft'));
    state = transientUiReducer(state, setChatDraft('ws-1', 'agent-2', 'Second draft'));
    state = transientUiReducer(state, setChatDraft('ws-2', 'agent-1', 'Other workspace'));

    expect(state.byWorkspaceId['ws-1'].chatDrafts).toEqual({
      'agent-1': 'First draft',
      'agent-2': 'Second draft',
    });
    expect(state.byWorkspaceId['ws-2'].chatDrafts).toEqual({ 'agent-1': 'Other workspace' });
  });

  it('clears only the sent agent draft', () => {
    let state = transientUiReducer(initialState, setChatDraft('ws-1', 'agent-1', 'Send me'));
    state = transientUiReducer(state, setChatDraft('ws-1', 'agent-2', 'Keep me'));
    state = transientUiReducer(state, clearChatDraft('ws-1', 'agent-1'));

    expect(state.byWorkspaceId['ws-1'].chatDrafts).toEqual({ 'agent-2': 'Keep me' });
  });

  it('keeps sidebar selection workspace-scoped', () => {
    let state = transientUiReducer(initialState, setSidebarActiveTab('ws-1', 'agents'));
    state = transientUiReducer(state, setSidebarActiveTab('ws-2', 'files'));

    expect(state.byWorkspaceId['ws-1'].sidebarActiveTab).toBe('agents');
    expect(state.byWorkspaceId['ws-2'].sidebarActiveTab).toBe('files');
  });
});
