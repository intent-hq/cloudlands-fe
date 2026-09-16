import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';

export type SidebarTabId = 'notes' | 'changes' | 'files' | 'agents' | 'terminals' | 'browser';
export type NoteViewMode = 'editor' | 'raw' | 'preview';

export interface TransientUiWorkspaceState {
  chatDrafts: Record<string, string>;
  noteViewModeByNoteId: Record<string, Exclude<NoteViewMode, 'editor'>>;
  sidebarActiveTab: SidebarTabId;
  viewedFiles: Record<string, string>;
  timestamp: number;
}

export interface TransientUiState {
  byWorkspaceId: Record<string, TransientUiWorkspaceState>;
}

function createEmptyWorkspaceTransientUiState(): TransientUiWorkspaceState {
  return {
    chatDrafts: {},
    noteViewModeByNoteId: {},
    sidebarActiveTab: 'notes',
    viewedFiles: {},
    timestamp: 0,
  };
}

export const emptyWorkspaceTransientUiState = createEmptyWorkspaceTransientUiState();
export const initialState: TransientUiState = { byWorkspaceId: {} };

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } = createWorkspaceScopedHelpers(
  emptyWorkspaceTransientUiState,
);

const updateWorkspaceState = (
  state: TransientUiState,
  workspaceId: string,
  updater: (workspaceState: TransientUiWorkspaceState) => TransientUiWorkspaceState,
) => {
  const workspaceState = getWorkspaceState(state, workspaceId);
  const nextWorkspaceState = updater(workspaceState);
  if (nextWorkspaceState === workspaceState) return state;
  return setWorkspaceState(state, workspaceId, nextWorkspaceState);
};
export const setViewedFiles = createAction<
  [workspaceId: string, viewedFiles: Record<string, string>]
>('transientUi/setViewedFiles');
export const setSidebarActiveTab = createAction<[workspaceId: string, tab: SidebarTabId]>(
  'transientUi/setSidebarActiveTab',
);
export const setNoteViewMode = createAction<
  [workspaceId: string, noteId: string, mode: NoteViewMode]
>('transientUi/setNoteViewMode');
export const setChatDraft = createAction<[workspaceId: string, agentId: string, draft: string]>(
  'transientUi/setChatDraft',
);
export const clearChatDraft = createAction<[workspaceId: string, agentId: string]>(
  'transientUi/clearChatDraft',
);

export const transientUiReducer = createReducer<TransientUiState>(initialState);
transientUiReducer.with(setViewedFiles, (state, { payload: [workspaceId, viewedFiles] }) =>
  updateWorkspaceState(state, workspaceId, (workspaceState) => ({
    ...workspaceState,
    viewedFiles,
  })),
);
transientUiReducer.with(setSidebarActiveTab, (state, { payload: [workspaceId, tab] }) =>
  updateWorkspaceState(state, workspaceId, (workspaceState) => ({
    ...workspaceState,
    sidebarActiveTab: tab,
  })),
);
transientUiReducer.with(setNoteViewMode, (state, { payload: [workspaceId, noteId, mode] }) =>
  updateWorkspaceState(state, workspaceId, (workspaceState) => {
    const noteViewModeByNoteId = { ...workspaceState.noteViewModeByNoteId };
    if (mode === 'editor') {
      delete noteViewModeByNoteId[noteId];
    } else {
      noteViewModeByNoteId[noteId] = mode;
    }
    return { ...workspaceState, noteViewModeByNoteId };
  }),
);
transientUiReducer.with(setChatDraft, (state, { payload: [workspaceId, agentId, draft] }) =>
  updateWorkspaceState(state, workspaceId, (workspaceState) => {
    const currentDraft = workspaceState.chatDrafts[agentId] ?? '';
    if (currentDraft === draft) return workspaceState;
    const chatDrafts = { ...workspaceState.chatDrafts };
    if (draft) {
      chatDrafts[agentId] = draft;
    } else {
      delete chatDrafts[agentId];
    }
    return { ...workspaceState, chatDrafts };
  }),
);
transientUiReducer.with(clearChatDraft, (state, { payload: [workspaceId, agentId] }) =>
  updateWorkspaceState(state, workspaceId, (workspaceState) => {
    if (!(agentId in workspaceState.chatDrafts)) return workspaceState;
    const chatDrafts = { ...workspaceState.chatDrafts };
    delete chatDrafts[agentId];
    return { ...workspaceState, chatDrafts };
  }),
);
transientUiReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
