import { appClient } from '$lib/client';
import type { MutationResult, ScriptCreateInput, ScriptCreateResult } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { runMutation } from '$lib/client/live/live-support';
import type { ScriptArchiveFilter } from './types';
import type { ScriptRuntimeState, ScriptWithState, WorkspaceScript } from './types';
import { detectScriptCandidates } from './detect-scripts';

type ScriptDefinitionCreateInput = ScriptCreateInput & { source?: string };

/** Narrow wire/file seam used by scriptsOperationSaga. No Redux or facade dependency. */
export const scriptDefinitionTransport = {
  list(
    workspaceId: string,
    options?: { archive?: ScriptArchiveFilter },
  ): Promise<ScriptWithState[]> {
    return appClient.scripts.list(workspaceId, options);
  },

  get(workspaceId: string, scriptId: string): Promise<ScriptWithState> {
    return appClient.scripts.get(workspaceId, scriptId);
  },

  async create(
    workspaceId: string,
    input: ScriptDefinitionCreateInput,
  ): Promise<ScriptCreateResult> {
    try {
      const script = await backendRequest<WorkspaceScript>('script.create', {
        workspaceId,
        ...input,
      });
      return { success: true, script };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  async upsert(
    workspaceId: string,
    scriptId: string,
    input: ScriptCreateInput,
  ): Promise<ScriptCreateResult> {
    try {
      const script = await backendRequest<WorkspaceScript>('script.create', {
        workspaceId,
        scriptId,
        ...input,
      });
      return { success: true, script };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  remove(workspaceId: string, scriptId: string): Promise<MutationResult> {
    return runMutation('script.remove', { workspaceId, scriptId });
  },

  start(workspaceId: string, scriptId: string): Promise<MutationResult> {
    return appClient.scripts.start(workspaceId, scriptId);
  },

  stop(workspaceId: string, scriptId: string): Promise<MutationResult> {
    return appClient.scripts.stop(workspaceId, scriptId);
  },

  restart(workspaceId: string, scriptId: string): Promise<MutationResult> {
    return appClient.scripts.restart(workspaceId, scriptId);
  },

  status(workspaceId: string, scriptId: string): Promise<ScriptRuntimeState | null> {
    return appClient.scripts.status(workspaceId, scriptId);
  },

  detectCandidates(workspaceId: string) {
    return detectScriptCandidates(appClient.files, workspaceId);
  },

  saveRepoScripts(workspaceId: string, scripts: ScriptWithState[]): Promise<unknown> {
    const payload = scripts.map(
      ({ name, command, mode, category, cwd, env, autoStart, healthUrl, readyPattern }) => ({
        name,
        command,
        mode,
        ...(category !== undefined ? { category } : {}),
        ...(cwd !== undefined ? { cwd } : {}),
        ...(env !== undefined ? { env } : {}),
        ...(autoStart !== undefined ? { autoStart } : {}),
        ...(healthUrl !== undefined ? { healthUrl } : {}),
        ...(readyPattern !== undefined ? { readyPattern } : {}),
      }),
    );
    if (payload.length === 0) return Promise.resolve(undefined);
    return backendRequest('repoConfig.save', { workspaceId, config: { scripts: payload } });
  },
};
