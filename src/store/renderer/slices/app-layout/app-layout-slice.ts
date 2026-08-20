import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type {
  AppLayoutState,
  CreateWorkspaceForRepoDetail,
  OpenAgentTabDetail,
  OpenNewSpaceModalDetail,
  OpenTerminalTabDetail,
  SidebarLocateTarget,
} from './app-layout-types';

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

export const openTerminalTabRequested = createAction<[wsId: string, detail: OpenTerminalTabDetail]>(
  'appLayout/openTerminalTabRequested',
);

export const createWorkspaceForRepoRequested = createAction<[detail: CreateWorkspaceForRepoDetail]>(
  'appLayout/createWorkspaceForRepoRequested',
);

export const openNewSpaceModalRequested = createAction<[detail: OpenNewSpaceModalDetail]>(
  'appLayout/openNewSpaceModalRequested',
);

export const focusBrowserTabRequested = createAction<[wsId: string, tabId: string, pin?: boolean]>(
  'appLayout/focusBrowserTabRequested',
);

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
