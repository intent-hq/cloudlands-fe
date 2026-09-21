import { describe, expect, it } from 'vitest';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { StoreState } from '../../types';
import {
  initialState,
  setNoteViewMode,
  setChatDraft,
  setComposerContextItems,
  setSidebarActiveTab,
  transientUiReducer,
} from './transient-ui-slice';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  selectIsRawNoteViewEnabled,
  selectNoteViewMode,
  selectSidebarActiveTab,
} from './transient-ui-selectors';

const WS_1 = 'ws-1';
const WS_2 = 'ws-2';

function mockState(overrides: Partial<StoreState['transientUi']> = {}): StoreState {
  return {
    transientUi: {
      ...initialState,
      ...overrides,
    },
  } as StoreState;
}

describe('transientUiReducer', () => {
  it('returns the initial state', () => {
    expect(transientUiReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('stores workspace-scoped values independently', () => {
    let state = transientUiReducer(initialState, setSidebarActiveTab(WS_1, 'notes'));
    state = transientUiReducer(state, setSidebarActiveTab(WS_2, 'agents'));

    expect(state.byWorkspaceId[WS_1].sidebarActiveTab).toBe('notes');
    expect(state.byWorkspaceId[WS_2].sidebarActiveTab).toBe('agents');
  });

  it('removes chat drafts when set to an empty string', () => {
    let state = transientUiReducer(initialState, setChatDraft(WS_1, 'agent-1', 'draft'));
    state = transientUiReducer(state, setChatDraft(WS_1, 'agent-1', ''));

    expect(state.byWorkspaceId[WS_1].chatDrafts).toEqual({});
  });

  it('returns the same state for an unchanged draft', () => {
    const stateWithDraft = transientUiReducer(initialState, setChatDraft(WS_1, 'agent-1', 'draft'));

    expect(transientUiReducer(stateWithDraft, setChatDraft(WS_1, 'agent-1', 'draft'))).toBe(
      stateWithDraft,
    );
    expect(transientUiReducer(initialState, setChatDraft(WS_1, 'agent-1', ''))).toBe(initialState);
  });

  describe('composer attachments', () => {
    const first = {
      id: 'first',
      type: 'file' as const,
      label: 'first.png',
      imageData: 'YQ==',
      imageMimeType: 'image/png',
    };
    const second = { ...first, id: 'second', label: 'second.png', imageData: 'Yg==' };

    it('stores and replaces one agent collection without changing other agents or workspaces', () => {
      let state = transientUiReducer(
        initialState,
        setComposerContextItems(WS_1, 'agent-1', [first]),
      );
      state = transientUiReducer(state, setComposerContextItems(WS_1, 'agent-2', [second]));
      state = transientUiReducer(state, setComposerContextItems(WS_2, 'agent-1', [first]));
      const next = transientUiReducer(state, setComposerContextItems(WS_1, 'agent-1', [second]));
      expect(getItems(next.byWorkspaceId[WS_1].composerContextByAgentId['agent-1'])).toEqual([
        second,
      ]);
      expect(getItems(state.byWorkspaceId[WS_1].composerContextByAgentId['agent-1'])).toEqual([
        first,
      ]);
      expect(next.byWorkspaceId[WS_1].composerContextByAgentId['agent-2']).toBe(
        state.byWorkspaceId[WS_1].composerContextByAgentId['agent-2'],
      );
      expect(next.byWorkspaceId[WS_2]).toBe(state.byWorkspaceId[WS_2]);
      expect(structuredClone(next)).toEqual(next);
    });

    it('removes an empty collection and treats clearing an absent collection as a no-op', () => {
      const state = transientUiReducer(
        initialState,
        setComposerContextItems(WS_1, 'agent-1', [first]),
      );
      const cleared = transientUiReducer(state, setComposerContextItems(WS_1, 'agent-1', []));
      expect(cleared.byWorkspaceId[WS_1].composerContextByAgentId).toEqual({});
      expect(transientUiReducer(cleared, setComposerContextItems(WS_1, 'agent-1', []))).toBe(
        cleared,
      );
      expect(transientUiReducer(initialState, setComposerContextItems(WS_1, 'agent-1', []))).toBe(
        initialState,
      );
    });

    it('clears all workspace composer collections on unmount while retaining other workspaces', () => {
      let state = transientUiReducer(
        initialState,
        setComposerContextItems(WS_1, 'agent-1', [first]),
      );
      state = transientUiReducer(state, setComposerContextItems(WS_1, 'agent-2', [second]));
      state = transientUiReducer(state, setComposerContextItems(WS_2, 'agent-1', [second]));
      const next = transientUiReducer(state, workspaceUnmounted(WS_1));
      expect(next.byWorkspaceId[WS_1]).toBeUndefined();
      expect(next.byWorkspaceId[WS_2]).toBe(state.byWorkspaceId[WS_2]);
      expect(transientUiReducer(next, workspaceUnmounted(WS_1))).toBe(next);
    });
  });

  it('keeps note view modes mutually exclusive and stores only non-default modes', () => {
    let state = transientUiReducer(initialState, setNoteViewMode(WS_1, 'note-1', 'raw'));
    expect(state.byWorkspaceId[WS_1].noteViewModeByNoteId).toEqual({ 'note-1': 'raw' });

    state = transientUiReducer(state, setNoteViewMode(WS_1, 'note-1', 'preview'));
    expect(state.byWorkspaceId[WS_1].noteViewModeByNoteId).toEqual({ 'note-1': 'preview' });

    state = transientUiReducer(state, setNoteViewMode(WS_1, 'note-1', 'editor'));
    expect(state.byWorkspaceId[WS_1].noteViewModeByNoteId).toEqual({});
  });

  it('keeps view modes isolated across notes and workspaces', () => {
    let state = transientUiReducer(initialState, setNoteViewMode(WS_1, 'note-1', 'preview'));
    state = transientUiReducer(state, setNoteViewMode(WS_1, 'note-2', 'raw'));
    state = transientUiReducer(state, setNoteViewMode(WS_2, 'note-1', 'raw'));
    const storeState = mockState(state);

    expect(selectNoteViewMode.select(storeState, WS_1, 'note-1')).toBe('preview');
    expect(selectNoteViewMode.select(storeState, WS_1, 'note-2')).toBe('raw');
    expect(selectNoteViewMode.select(storeState, WS_2, 'note-1')).toBe('raw');
    expect(selectNoteViewMode.select(storeState, WS_2, 'note-2')).toBe('editor');
  });

  it('clears workspace state on workspaceUnmounted', () => {
    let state = transientUiReducer(initialState, setSidebarActiveTab(WS_1, 'files'));
    state = transientUiReducer(state, setSidebarActiveTab(WS_2, 'agents'));

    const nextState = transientUiReducer(state, workspaceUnmounted(WS_1));

    expect(nextState.byWorkspaceId[WS_1]).toBeUndefined();
    expect(nextState.byWorkspaceId[WS_2].sidebarActiveTab).toBe('agents');
  });
});

describe('transientUi selectors', () => {
  it('returns the default sidebar tab for missing workspaces', () => {
    const state = mockState();

    expect(selectSidebarActiveTab.select(state, WS_1)).toBe('notes');
  });

  it('defaults missing note view state to the editor', () => {
    const state = mockState();

    expect(selectIsRawNoteViewEnabled.select(state, WS_1, 'note-1')).toBe(false);
    expect(selectNoteViewMode.select(state, WS_1, 'note-1')).toBe('editor');
  });

  it('isolates note view mode by workspace and note', () => {
    const state = mockState({
      byWorkspaceId: {
        [WS_1]: {
          chatDrafts: {},
          noteViewModeByNoteId: { 'note-1': 'raw' },
          sidebarActiveTab: 'notes',
          viewedFiles: {},
          timestamp: 0,
        },
      },
    });

    expect(selectIsRawNoteViewEnabled.select(state, WS_1, 'note-1')).toBe(true);
    expect(selectIsRawNoteViewEnabled.select(state, WS_1, 'note-2')).toBe(false);
    expect(selectNoteViewMode.select(state, WS_2, 'note-1')).toBe('editor');
  });
});
