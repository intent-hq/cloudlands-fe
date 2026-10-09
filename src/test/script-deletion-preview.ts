import { appClient } from '$lib/client';
import { store } from '$store/renderer/store';
import { scriptsOperationSaga } from '$store/renderer/slices/scripts/sagas/scripts-operation-saga';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import {
  setScriptsData,
  setScriptsInitialized,
} from '$store/renderer/slices/scripts/scripts-slice';
import { initializeLayout } from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { loadWorkspaceTerminals } from '$store/renderer/slices/terminals/terminals-slice';
import { admitLegacyPrincipal } from './fixtures/principal-state';
import { WorkspaceId } from '$shared/types/branded-ids';

export const deletionPreviewWorkspace = WorkspaceId('preview-script-deletion');
export const deletionPreviewScript = 'preview-check';
export function setupScriptDeletionPreview(
  onRemove: (request: string) => void,
  shouldFail: () => boolean,
) {
  const workspaceId = deletionPreviewWorkspace;
  const scriptId = deletionPreviewScript;
  const previous = {
    remove: appClient.scripts.remove,
    start: appClient.scripts.start,
    output: appClient.scripts.output,
  };
  let releaseStart!: () => void;
  const startGate = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  appClient.scripts.remove = async (ws, id) => {
    onRemove(`${ws}:${id}`);
    return shouldFail() ? { success: false, error: 'Preview deletion failed' } : { success: true };
  };
  appClient.scripts.start = async () => {
    await startGate;
    return { success: true };
  };
  appClient.scripts.output = async () => '';
  admitLegacyPrincipal();
  store.dispatch(
    setWorkspaceEntity({ id: workspaceId, title: 'Script deletion', myRole: 'owner' } as never),
  );
  const stopOperations = store.runSaga(scriptsOperationSaga);
  store.dispatch(
    setScriptsData(workspaceId, [
      {
        id: scriptId,
        workspaceId,
        name: 'Project check',
        command: 'pnpm check',
        mode: 'command',
        source: 'user',
        createdAt: '2026-10-09T00:00:00Z',
        runtime: { status: 'idle', restartCount: 0 },
      },
    ]),
  );
  store.dispatch(setScriptsInitialized(workspaceId, true));
  store.dispatch(
    initializeLayout(workspaceId, {
      root: { type: 'panel', panelId: 'main' },
      panels: {
        main: {
          id: 'main',
          tabs: [
            {
              id: 'script-tab',
              type: 'terminal',
              title: 'Project check',
              scriptId,
              workspaceId,
              closable: true,
            },
          ],
          activeTabId: 'script-tab',
        },
      },
      focusedPanelId: 'main',
    }),
  );
  store.dispatch(
    loadWorkspaceTerminals(
      workspaceId,
      [],
      { isOpen: true, activeTerminalId: null, selectedScriptId: scriptId },
      'preview-boot',
    ),
  );

  return () => {
    releaseStart();
    stopOperations();
    Object.assign(appClient.scripts, previous);
  };
}
