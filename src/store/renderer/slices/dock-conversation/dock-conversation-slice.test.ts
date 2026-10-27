import { describe, expect, it } from 'vitest';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import {
  dockConversationReducer as reduce,
  openDockConversationRequested,
  closeDockConversationRequested,
  dockConversationLoaded,
  dockConversationDraftChanged,
  dockConversationDraftRestored,
  dockConversationDraftAdmitted,
} from './dock-conversation-slice';

// Failure inventory: held A discovery must not replace B; late restore must not
// replace typing; old send admission must not clear a newer edit; close retains
// target-scoped drafts. Wire admission/reconciliation is covered by the browser
// fixture through the real configured store and fake external backend.
describe('companion conversation ownership', () => {
  it('rejects stale discovery after a workspace switch', () => {
    let state = reduce(undefined, openDockConversationRequested('A'));
    const generation = state.generation;
    state = reduce(state, openDockConversationRequested('B'));
    state = reduce(state, dockConversationLoaded(generation, 'A', 'Agent A', [], 'a'));
    expect(state.workspaceId).toBe('B');
    expect(state.agentId).toBeNull();
  });

  it('keeps typing over a late restored draft and retains it after close', () => {
    let state = reduce(undefined, openDockConversationRequested('A'));
    state = reduce(
      state,
      dockConversationLoaded(
        state.generation,
        'A',
        'A',
        [{ id: 'a', name: 'A', isMain: true }],
        'a',
      ),
    );
    state = reduce(state, dockConversationDraftChanged('A', 'a', 'new words'));
    state = reduce(state, dockConversationDraftRestored('A', 'a', 'old words', false));
    state = reduce(state, closeDockConversationRequested());
    expect(getItem(state.drafts, JSON.stringify(['A', 'a']))?.text).toBe('new words');
  });

  it('clears only the exact admitted draft revision', () => {
    let state = reduce(undefined, openDockConversationRequested('A'));
    state = reduce(state, dockConversationDraftChanged('A', 'a', 'first'));
    const revision = getItem(state.drafts, JSON.stringify(['A', 'a']))!.revision;
    state = reduce(state, dockConversationDraftChanged('A', 'a', 'second'));
    state = reduce(state, dockConversationDraftAdmitted('A', 'a', revision));
    expect(getItem(state.drafts, JSON.stringify(['A', 'a']))?.text).toBe('second');
    state = reduce(state, dockConversationDraftAdmitted('A', 'a', revision + 1));
    expect(getItem(state.drafts, JSON.stringify(['A', 'a']))?.text).toBe('');
  });
});
