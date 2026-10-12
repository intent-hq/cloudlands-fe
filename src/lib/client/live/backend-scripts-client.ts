import { m } from '$shared/paraglide/messages.js';
import type { ScriptArchiveFilter, ScriptWithState } from '../../../features/scripts/types';
import type { ScriptsReadClient } from '../lifecycle-read-client-types';
import type { BackendRuntime } from './backend-transport-runtime';

/** Canonical lifecycle negotiation and list policy, bound to the owning renderer. */
export function createBackendScriptsClient(
  backend: Pick<BackendRuntime, 'backendRequest'>,
): Required<ScriptsReadClient> {
  const { backendRequest } = backend;
  return {
    async supportsLifecycle(): Promise<boolean> {
      const result = await backendRequest<{
        server?: { capabilities?: { scriptLifecycle?: number } };
      }>('client.hello', {});
      return result?.server?.capabilities?.scriptLifecycle === 1;
    },

    async list(
      workspaceId: string,
      options?: { archive?: ScriptArchiveFilter },
    ): Promise<ScriptWithState[]> {
      const supported = await this.supportsLifecycle();
      // An explicit partition must never become a successful unfiltered snapshot.
      // Missing capability is legacy fallback only for default/all-list callers;
      // failed negotiation remains a retryable error rather than cached history.
      if (!supported && options?.archive && options.archive !== 'all') {
        throw new Error(m.scripts_history_unsupported_error());
      }
      const result = await backendRequest<{ scripts: ScriptWithState[] }>('script.list', {
        workspaceId,
        ...(supported ? { archive: options?.archive ?? 'active' } : {}),
      });
      if (!Array.isArray(result?.scripts)) throw new Error(m.scripts_history_load_error());
      return result.scripts;
    },
  };
}
