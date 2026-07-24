import type { StoreMiddleware } from '$lib/store-shim/types';
import { store as appStore } from '$store/renderer/store';
import {
  legacyImportFailed,
  legacyImportRequested,
  legacyImportSucceeded,
} from '$store/renderer/slices/legacy-import/legacy-import-slice';
import { loadWorkspacesRequested } from '$store/renderer/slices/workspace/workspace-slice';
import { importLegacyWorkspaces } from './legacy-import.client';

async function runLegacyImport(force: boolean): Promise<void> {
  try {
    const report = await importLegacyWorkspaces(force);
    appStore.dispatch(legacyImportSucceeded(report));
    appStore.dispatch(loadWorkspacesRequested());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appStore.dispatch(legacyImportFailed(message));
  }
}

export function createLegacyImportMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action && action.type === legacyImportRequested.type) {
      const force = Array.isArray(action.payload) && action.payload[0] === true;
      void runLegacyImport(force);
    }
    return result;
  };
}
