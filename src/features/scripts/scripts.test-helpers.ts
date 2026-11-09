/** Test driver for scriptsOperationSaga: dispatches its correlated async actions
 * and folds each outcome into a `{ success, data?, error? }` envelope. */
import type { WorkspaceScript } from './types';
import { store } from '$store/renderer/store';
import {
  createScriptDefinitionRequested,
  detectScriptDefinitionsRequested,
  removeScriptDefinitionRequested,
  saveScriptDefinitionsToRepoRequested,
  updateScriptDefinitionRequested,
} from '$store/renderer/slices/scripts/scripts-slice';

interface CommandResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

async function dispatchCommand<T>(request: { promise: Promise<T> }): Promise<CommandResponse<T>> {
  try {
    store.dispatch(request as never);
    const data = await request.promise;
    return data === undefined ? { success: true } : { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export const scriptsClient = {
  create(
    workspaceId: string,
    script: Parameters<typeof createScriptDefinitionRequested>[1],
  ): Promise<CommandResponse<WorkspaceScript>> {
    return dispatchCommand(createScriptDefinitionRequested(workspaceId, script));
  },

  update(
    workspaceId: string,
    scriptId: string,
    updates: Parameters<typeof updateScriptDefinitionRequested>[2],
    selectedDefinition?: WorkspaceScript,
  ): Promise<CommandResponse<WorkspaceScript>> {
    return dispatchCommand(
      updateScriptDefinitionRequested(
        workspaceId,
        scriptId,
        updates,
        undefined,
        selectedDefinition,
      ),
    );
  },

  remove(
    workspaceId: string,
    scriptId: string,
    selectedDefinition?: WorkspaceScript,
  ): Promise<CommandResponse<void>> {
    return dispatchCommand(
      removeScriptDefinitionRequested(workspaceId, scriptId, undefined, selectedDefinition),
    );
  },

  async detect(workspaceId: string): Promise<{
    success: boolean;
    detected?: number;
    added?: number;
    removed?: number;
    skippedRunning?: string[];
    packageManager?: string;
    error?: string;
  }> {
    const result = await dispatchCommand(detectScriptDefinitionsRequested(workspaceId));
    if (!result.success) return { success: false, error: result.error };
    const outcome = result.data!;
    return {
      success: true,
      detected: outcome.detected,
      added: outcome.added,
      removed: outcome.removed,
      ...(outcome.skippedRunning.length ? { skippedRunning: outcome.skippedRunning } : {}),
      ...(outcome.packageManager ? { packageManager: outcome.packageManager } : {}),
    };
  },

  saveToRepo(workspaceId: string): Promise<CommandResponse<void>> {
    return dispatchCommand(saveScriptDefinitionsToRepoRequested(workspaceId));
  },
};
