import { store } from '$store/renderer/store';
import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
import {
  clearPanelLayout,
  initializeLayout,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { removeScript, setScriptsData } from '$store/renderer/slices/scripts/scripts-slice';
import { addTerminal, removeTerminal } from '$store/renderer/slices/terminals/terminals-slice';

export const LIST_LABELS_WORKSPACE = 'list-labels-preview';

/** Local reducer-only fixture. No script execution, persistence, or daemon sagas. */
export function setupListLabelsPreview(initializeStore = true) {
  const dispose = initializeStore
    ? startRootStoreLifecycle(store, { startSagas: () => [] })
    : () => {};
  store.dispatch(
    initializeLayout(LIST_LABELS_WORKSPACE, {
      root: { type: 'panel', panelId: 'labels-panel' },
      panels: { 'labels-panel': { id: 'labels-panel', tabs: [], activeTabId: null } },
      focusedPanelId: 'labels-panel',
      columnCount: 1,
    }),
  );
  store.dispatch(addTerminal(LIST_LABELS_WORKSPACE, 'fixture-terminal', 'Build shell'));
  store.dispatch(
    setScriptsData(
      LIST_LABELS_WORKSPACE,
      [
        { id: 'fixture-dev', name: 'Development server', status: 'running' as const },
        { id: 'fixture-test', name: 'Run tests', status: 'idle' as const },
      ].map(({ id, name, status }) => ({
        id,
        name,
        workspaceId: LIST_LABELS_WORKSPACE,
        command: 'echo fixture',
        mode: 'command' as const,
        category: 'dev',
        source: 'user' as const,
        createdAt: '2026-09-01T00:00:00Z',
        runtime: { status, restartCount: 0 },
      })),
    ),
  );
  return () => {
    store.dispatch(removeScript(LIST_LABELS_WORKSPACE, 'fixture-dev'));
    store.dispatch(removeScript(LIST_LABELS_WORKSPACE, 'fixture-test'));
    store.dispatch(removeTerminal(LIST_LABELS_WORKSPACE, 'fixture-terminal'));
    store.dispatch(clearPanelLayout(LIST_LABELS_WORKSPACE));
    dispose();
  };
}
