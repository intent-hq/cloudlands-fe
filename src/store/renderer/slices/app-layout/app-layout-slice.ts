import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { AppLayoutState, OpenAgentTabDetail, SidebarLocateTarget } from './app-layout-types';

export const initialState: AppLayoutState = {
  pendingCommandPaletteAction: null,
  pendingLocateInSidebar: null,
};

export const createFileRequested = createAction<
  [wsId: string, folderPath: string, fileName: string]
>('appLayout/createFileRequested');

export const openAgentTabRequested = createAction<[wsId: string, detail: OpenAgentTabDetail]>(
  'appLayout/openAgentTabRequested',
);

// `agentDriven` marks focuses originating from agent browser ops
// (browser:focus-tab / browser:show-tab IPC): when the workspace is not the
// one this window displays, they apply their layout-state effects but skip
// the actual UI reveal (monorepo#3045). User-initiated focuses omit it and
// always reveal.
export const focusBrowserTabRequested = createAction<
  [wsId: string, tabId: string, pin?: boolean, agentDriven?: boolean]
>('appLayout/focusBrowserTabRequested');

export const commandPaletteNewFileRequested = createAction<[wsId: string]>(
  'appLayout/commandPaletteNewFileRequested',
);

export const commandPaletteActionConsumed = createAction<[wsId: string]>(
  'appLayout/commandPaletteActionConsumed',
);

export const locateItemInSidebarRequested = createAction<
  [wsId: string, target: SidebarLocateTarget]
>('appLayout/locateItemInSidebarRequested');

export const locateItemInSidebarConsumed = createAction<[wsId: string]>(
  'appLayout/locateItemInSidebarConsumed',
);

export const appLayoutReducer = createReducer<AppLayoutState>(initialState);
appLayoutReducer.with(commandPaletteNewFileRequested, (state, { payload: [wsId] }) => ({
  ...state,
  pendingCommandPaletteAction: { type: 'create-file', workspaceId: wsId },
}));
appLayoutReducer.with(commandPaletteActionConsumed, (state, { payload: [wsId] }) => {
  if (state.pendingCommandPaletteAction?.workspaceId !== wsId) return state;
  return { ...state, pendingCommandPaletteAction: null };
});
appLayoutReducer.with(locateItemInSidebarRequested, (state, { payload: [wsId, target] }) => ({
  ...state,
  pendingLocateInSidebar: { workspaceId: wsId, target },
}));
appLayoutReducer.with(locateItemInSidebarConsumed, (state, { payload: [wsId] }) => {
  if (state.pendingLocateInSidebar?.workspaceId !== wsId) return state;
  return { ...state, pendingLocateInSidebar: null };
});
