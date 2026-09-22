/**
 * Store/bridge wiring for the close-tab action key.
 *
 * Kept out of action-key-registry.ts on purpose (same reasoning as
 * window-cycle.ts): the registry is imported by Svelte components and must
 * stay free of IPC bridge references, and it is loaded during store
 * construction, so the app store and the workspace-tab-navigation selectors
 * (which call `store.createSelector` at module scope) can only be reached
 * through a dynamic import of this module.
 */
import { invoke } from '$lib/electron-bridge';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { hasCapability } from '$lib/utils/platform-capabilities';
import { store as appStore } from '$store/renderer/store';
import {
  closeActiveTabCascade,
  type CloseTabCascadeLevel,
} from '$features/workspace/utils/workspace-tab-navigation';

/**
 * Run the Cmd+W cascade with the same inputs the `navigation.close-tab`
 * shortcut registration passes in `+layout.svelte`: the app store, the
 * location path captured when the key was pressed (the caller reads it
 * before the dynamic import so a workspace switch racing the import cannot
 * redirect the close), and a window close only on builds with window
 * chrome. Returns the level that closed, or null when nothing was closable.
 */
export function closeActiveTab(
  currentPath: string,
  navigate: (path: string) => unknown,
): CloseTabCascadeLevel | null {
  return closeActiveTabCascade(appStore, currentPath, {
    navigate,
    ...(hasCapability('windowChrome')
      ? { closeWindow: () => invoke(IPC_CHANNELS.WINDOW.CLOSE) }
      : {}),
  });
}
