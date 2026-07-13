import type { StoreAction } from '@augmentcode/ag-redux-toolkit/types';
import { createAction } from '@augmentcode/ag-redux-toolkit/utils/store/create-action';
import { createReducer } from '@augmentcode/ag-redux-toolkit/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';

export const STORAGE_KEY_PREFIX = 'workspace-transient-ui-';
export const SAVE_DEBOUNCE_MS = 300;
export const STALE_STATE_THRESHOLD_MS = 60 * 60 * 1000;

export type SidebarTabId = 'notes' | 'changes' | 'files' | 'agents' | 'terminals' | 'browser';

export interface TransientUiWorkspaceState {
  chatDrafts: Record<string, string>;
  rawNoteViewByNoteId: Record<string, boolean>;
  sidebarActiveTab: SidebarTabId;
  viewedFiles: Record<string, string>;
  timestamp: number;
}

export interface TransientUiState {
  byWorkspaceId: Record<string, TransientUiWorkspaceState>;
}

export function createEmptyWorkspaceTransientUiState(): TransientUiWorkspaceState {
  return {
    chatDrafts: {},
    rawNoteViewByNoteId: {},
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
  return setWorkspaceState(state, workspaceId, updater(workspaceState));
};

export const hydrateWorkspaceTransientUi = createAction<
  [workspaceId: string, workspaceState: TransientUiWorkspaceState]
>('transientUi/hydrateWorkspaceTransientUi');
export const clearWorkspaceTransientUi = createAction<[workspaceId: string]>(
  'transientUi/clearWorkspaceTransientUi',
);
export const requestPersistWorkspaceTransientUi = createAction<[StoreAction<any>]>(
  'transientUi/requestPersistWorkspaceTransientUi',
);
export const persistWorkspaceTransientUi = createAction<[workspaceId: string]>(
  'transientUi/persistWorkspaceTransientUi',
);
export const setViewedFiles = createAction<
  [workspaceId: string, viewedFiles: Record<string, string>]
>('transientUi/setViewedFiles');
export const setSidebarActiveTab = createAction<[workspaceId: string, tab: SidebarTabId]>(
  'transientUi/setSidebarActiveTab',
);
export const setRawNoteViewEnabled = createAction<
  [workspaceId: string, noteId: string, enabled: boolean]
>('transientUi/setRawNoteViewEnabled');
export const toggleRawNoteView = createAction<[workspaceId: string, noteId: string]>(
  'transientUi/toggleRawNoteView',
);
export const setChatDraft = createAction<[workspaceId: string, agentId: string, draft: string]>(
  'transientUi/setChatDraft',
);
export const clearChatDraft = createAction<[workspaceId: string, agentId: string]>(
  'transientUi/clearChatDraft',
);

export const transientUiReducer = createReducer<TransientUiState>(initialState)
  .with(hydrateWorkspaceTransientUi, (state, { payload: [workspaceId, workspaceState] }) =>
    setWorkspaceState(state, workspaceId, workspaceState),
  )
  .with(clearWorkspaceTransientUi, (state, { payload: [workspaceId] }) =>
    clearWorkspaceState(state, workspaceId),
  )
  .with(setViewedFiles, (state, { payload: [workspaceId, viewedFiles] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      viewedFiles,
    })),
  )
  .with(setSidebarActiveTab, (state, { payload: [workspaceId, tab] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => ({
      ...workspaceState,
      sidebarActiveTab: tab,
    })),
  )
  .with(setRawNoteViewEnabled, (state, { payload: [workspaceId, noteId, enabled] }) => {
    const workspaceState = getWorkspaceState(state, workspaceId);
    const currentEnabled = workspaceState.rawNoteViewByNoteId[noteId] === true;
    if (currentEnabled === enabled) {
      return state;
    }

    const rawNoteViewByNoteId = { ...workspaceState.rawNoteViewByNoteId };
    if (enabled) {
      rawNoteViewByNoteId[noteId] = true;
    } else {
      delete rawNoteViewByNoteId[noteId];
    }
    return setWorkspaceState(state, workspaceId, { ...workspaceState, rawNoteViewByNoteId });
  })
  .with(toggleRawNoteView, (state, { payload: [workspaceId, noteId] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => {
      const rawNoteViewByNoteId = { ...workspaceState.rawNoteViewByNoteId };
      if (rawNoteViewByNoteId[noteId] === true) {
        delete rawNoteViewByNoteId[noteId];
      } else {
        rawNoteViewByNoteId[noteId] = true;
      }
      return { ...workspaceState, rawNoteViewByNoteId };
    }),
  )
  .with(setChatDraft, (state, { payload: [workspaceId, agentId, draft] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => {
      const chatDrafts = { ...workspaceState.chatDrafts };
      if (draft) {
        chatDrafts[agentId] = draft;
      } else {
        delete chatDrafts[agentId];
      }
      return { ...workspaceState, chatDrafts };
    }),
  )
  .with(clearChatDraft, (state, { payload: [workspaceId, agentId] }) =>
    updateWorkspaceState(state, workspaceId, (workspaceState) => {
      const chatDrafts = { ...workspaceState.chatDrafts };
      delete chatDrafts[agentId];
      return { ...workspaceState, chatDrafts };
    }),
  )
  .with(workspaceUnmounted, (state, { payload: [wsId] }) => clearWorkspaceState(state, wsId));
