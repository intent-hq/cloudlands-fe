import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
import { WorkspaceStatus } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { PREVIEW_FIXTURE_TIMESTAMPS } from '$lib/component-catalog/preview-fixtures';
import { store } from '$store/renderer/store';
import {
  fetchEditorsSuccess,
  setEditorOrder,
  setHiddenEditorIds,
  setOpenAction,
  type InstalledEditor,
} from '$store/renderer/slices/external-editors/external-editors-slice';
import { selectInstalledEditors } from '$store/renderer/slices/external-editors/external-editors-selectors';
import {
  removeWorkspaceEntity,
  setWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import { setMultiSelectSidebarSelectedTabs } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';

export const FILES_MENU_WORKSPACE = 'preview-files-menu';
export const FILES_MENU_PATH = '/tmp/intent-demo/worktrees/sample-project';
export interface FilesMenuRequest {
  channel: string;
  args: unknown[];
}

export function setupFilesMenuFixture(
  record: (request: FilesMenuRequest) => void,
  mode: 'local' | 'remote' | 'web',
  fontSize: number,
  collapsed = false,
) {
  const previous = {
    editors: selectInstalledEditors.select(store.state),
    editorState: store.state.externalEditors,
    bridge: Object.getOwnPropertyDescriptor(window, 'electronAPI'),
    clipboard: Object.getOwnPropertyDescriptor(navigator, 'clipboard'),
    fontSize: document.documentElement.style.fontSize,
    tabs: store.state.sidebarNav.multiSelectSelectedTabIdsByWorkspaceId[FILES_MENU_WORKSPACE] ?? [],
  };
  const handle = (channel: string, ...args: unknown[]) => {
    record({ channel, args });
    return { success: true };
  };
  const channels = [
    'shell:showItemInFolder',
    'vscode:open',
    'external-editors:open',
    'external-editors:open-with-other',
  ];
  const disposers = channels.map((channel) =>
    overrideMockIpcHandler(channel, (...args) => handle(channel, ...args)),
  );
  // Never delegate to a native bridge, OS clipboard, or production backend.
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      versions: { electron: mode === 'web' ? '0.0.0-browser' : 'preview-native-controls' },
      invoke: async (channel: string, ...args: unknown[]) => handle(channel, ...args),
    },
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => handle('clipboard:writeText', text) },
  });
  document.documentElement.style.fontSize = `${fontSize}px`;
  const editors: InstalledEditor[] = [
    { id: 'finder', name: 'Finder', category: 'finder', handlerType: 'finder', shortcut: '⌘O' },
    { id: 'vscode', name: 'Visual Studio Code', category: 'ide', handlerType: 'vscode' },
    { id: 'warp', name: 'Warp', category: 'terminal', handlerType: 'generic' },
  ].map((editor, index) => ({
    ...editor,
    shortLabel: editor.name,
    appName: editor.name,
    priority: index,
    installed: true,
  })) as InstalledEditor[];
  store.dispatch(fetchEditorsSuccess(editors, 0));
  store.dispatch(setEditorOrder(editors.map((editor) => editor.id)));
  store.dispatch(setHiddenEditorIds([]));
  store.dispatch(setOpenAction('finder'));
  store.dispatch(
    setWorkspaceEntity({
      id: WorkspaceId(FILES_MENU_WORKSPACE),
      title: 'Sample project',
      branch: 'main',
      path: FILES_MENU_PATH,
      worktreePath: FILES_MENU_PATH,
      status: WorkspaceStatus.Active,
      isRemote: mode === 'remote',
      environmentConfig: mode === 'remote' ? { type: 'remote' } : { type: 'local' },
      changesets: [],
      timeline: [],
      conversationInfo: [],
      ...PREVIEW_FIXTURE_TIMESTAMPS,
    }),
  );
  store.dispatch(
    setMultiSelectSidebarSelectedTabs(FILES_MENU_WORKSPACE, [collapsed ? 'overview' : 'files']),
  );
  return () => {
    disposers.forEach((dispose) => dispose());
    store.dispatch(removeWorkspaceEntity(FILES_MENU_WORKSPACE));
    store.dispatch(setMultiSelectSidebarSelectedTabs(FILES_MENU_WORKSPACE, previous.tabs));
    store.dispatch(fetchEditorsSuccess(previous.editors, previous.editorState.lastFetched));
    store.dispatch(setEditorOrder(previous.editorState.editorOrder));
    store.dispatch(setHiddenEditorIds(previous.editorState.hiddenEditorIds));
    store.dispatch(setOpenAction(previous.editorState.selectedAction));
    document.documentElement.style.fontSize = previous.fontSize;
    if (previous.bridge) Object.defineProperty(window, 'electronAPI', previous.bridge);
    else Reflect.deleteProperty(window, 'electronAPI');
    if (previous.clipboard) Object.defineProperty(navigator, 'clipboard', previous.clipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
  };
}
