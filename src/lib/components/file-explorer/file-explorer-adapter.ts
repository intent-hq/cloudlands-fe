/**
 * Action-only adapter backed by Redux.
 *
 * Components call `getFileExplorerStore()` for action methods (toggle, refresh, etc.)
 * and use Redux selectors directly for reading state.
 */
import type { FileNode, EnvironmentConfig } from "$shared/types";
import type { FlattenedFileNode } from "$lib/store/slices/file-explorer/file-explorer-types";
import { getReduxStore } from "$lib/store/redux-dispatch-bridge";
import {
  initializeFileExplorer,
  toggleDirectoryRequested,
  expandToPathRequested,
  expandAllRequested,
  refreshFileExplorer,
  refreshGitStatusRequested,
  syncGitStatusFromStoresRequested,
  clearExpandedPathsExceptRoot,
  setIsStoreActive,
  clearFileExplorerForWorkspace,
  setWorkspacePathRequested,
  setEnvironmentConfigAction,
} from "$lib/store/slices/file-explorer/file-explorer-slice";
import {
  selectFileExplorerWorkspacePath,
} from "$lib/store/slices/file-explorer/file-explorer-selectors";

export type { FlattenedFileNode };

export interface FileExplorerStoreOptions {
  initialPath: string;
  workspaceId?: string;
  environmentConfig?: EnvironmentConfig;
}

/**
 * Adapter store that dispatches Redux actions.
 * Components should use Redux selectors directly for reading state.
 */
function createAdapterStore(wsId: string) {
  const store = getReduxStore();

  function getState() {
    return store.getState();
  }

  return {
    setEnvironmentConfig(config: EnvironmentConfig | undefined) {
      store.dispatch(setEnvironmentConfigAction(wsId, config));
    },
    async initialize() {
      const wsPath = selectFileExplorerWorkspacePath.select(getState(), wsId);
      store.dispatch(initializeFileExplorer(wsId, {
        workspacePath: wsPath || "",
      }));
    },
    toggleDirectory(node: FileNode) {
      store.dispatch(toggleDirectoryRequested(wsId, node.path));
    },
    async expandToPath(targetPath: string): Promise<boolean> {
      store.dispatch(expandToPathRequested(wsId, targetPath));
      return true;
    },
    async expandAll(maxDepth?: number) {
      store.dispatch(expandAllRequested(wsId, maxDepth));
    },
    collapseAll() {
      store.dispatch(clearExpandedPathsExceptRoot(wsId));
    },
    async refresh() {
      store.dispatch(refreshFileExplorer(wsId));
    },
    async refreshGitStatus() {
      store.dispatch(refreshGitStatusRequested(wsId));
    },
    syncGitStatusFromStores() {
      store.dispatch(syncGitStatusFromStoresRequested(wsId));
    },
    async setWorkspacePath(path: string) {
      store.dispatch(setWorkspacePathRequested(wsId, path));
    },
    cleanup() {
      store.dispatch(clearFileExplorerForWorkspace(wsId));
    },
    deactivate() {
      store.dispatch(setIsStoreActive(wsId, false));
    },
    reactivate() {
      store.dispatch(setIsStoreActive(wsId, true));
    },
  };
}

type AdapterStore = ReturnType<typeof createAdapterStore>;

// Store cache for singleton pattern
const storeCache = new Map<string, AdapterStore>();

function getCacheKey(workspacePath: string, workspaceId?: string): string {
  return workspaceId || workspacePath;
}

/**
 * Create or retrieve a file explorer store for the given workspace.
 * Drop-in replacement for the old `createFileExplorerStore`.
 */
export function createFileExplorerStore(
  initialPathOrOptions: string | FileExplorerStoreOptions,
  workspaceId?: string,
): AdapterStore {
  const opts =
    typeof initialPathOrOptions === "string"
      ? { initialPath: initialPathOrOptions, workspaceId }
      : initialPathOrOptions;

  const wsId = opts.workspaceId || opts.initialPath;
  const key = getCacheKey(opts.initialPath, opts.workspaceId);

  let adapter = storeCache.get(key);
  if (!adapter) {
    adapter = createAdapterStore(wsId);
    storeCache.set(key, adapter);

    // Dispatch initial workspace path so state is pre-seeded
    const reduxStore = getReduxStore();
    reduxStore.dispatch(
      initializeFileExplorer(wsId, {
        workspacePath: opts.initialPath,
        workspaceId: opts.workspaceId,
        environmentConfig: opts.environmentConfig,
      }),
    );
  }

  return adapter;
}

/**
 * Get or create a singleton file explorer store (shared between components).
 * Drop-in replacement for the old `getFileExplorerStore`.
 */
export function getFileExplorerStore(
  workspacePath: string,
  workspaceId?: string,
  environmentConfig?: EnvironmentConfig,
): AdapterStore {
  const key = getCacheKey(workspacePath, workspaceId);
  let adapter = storeCache.get(key);
  if (!adapter) {
    const wsId = workspaceId || workspacePath;
    adapter = createAdapterStore(wsId);
    storeCache.set(key, adapter);

    // Pre-seed workspace state (saga will handle async init on first initialize())
    const reduxStore = getReduxStore();
    reduxStore.dispatch(
      initializeFileExplorer(wsId, {
        workspacePath,
        workspaceId,
        environmentConfig,
      }),
    );
  }
  return adapter;
}

/**
 * Clear and remove a cached file explorer store.
 */
export function clearFileExplorerStore(workspaceId: string) {
  const adapter = storeCache.get(workspaceId);
  if (adapter) {
    adapter.cleanup();
    storeCache.delete(workspaceId);
  }
}

/**
 * Deactivate a file explorer store (abort pending async ops).
 */
export function deactivateFileExplorerStore(workspaceId: string) {
  const adapter = storeCache.get(workspaceId);
  if (adapter) {
    adapter.deactivate();
  }
}

/**
 * Reactivate a previously deactivated store.
 */
export function reactivateFileExplorerStore(workspaceId: string) {
  const adapter = storeCache.get(workspaceId);
  if (adapter) {
    adapter.reactivate();
  }
}
