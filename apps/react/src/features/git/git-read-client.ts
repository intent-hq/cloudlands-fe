import { IPC_CHANNELS } from '$shared/ipc-registry';
import { createElectronWorkspaceLoadTransport } from '$lib/client/live/workspace-load-route-transport';
import { acquireWorkspaceGitReadScope } from '$lib/client/live/workspace-git-read-scope';
import { createBackendGitReadRuntime } from '$lib/client/live/backend-git-read-runtime';
import { BackendError } from '$lib/client/live/backend-transport-types';
import { store } from '@/store';
import { selectAdmittedWorkspaceReadContext } from '../../store/workspace-lifecycle/workspace-lifecycle-selectors';
import { selectPRStatusRefreshMetadata } from '../../store/pr-status/pr-status-selectors';
import type { ScopedGitReadPorts } from '../../../../../src/store/renderer/slices/workspace-lifecycle/lifecycle-read-types';

/** Inactive ports: no Store init, saga registration, bridge observation or PR call on construction. */
export function createReactGitReadPorts(): ScopedGitReadPorts<typeof store.state> {
  const transport = createElectronWorkspaceLoadTransport(IPC_CHANNELS.WORKSPACE_LOAD);
  return {
    admission: selectAdmittedWorkspaceReadContext,
    readCurrentContext: (id) => selectAdmittedWorkspaceReadContext.select(store.state, id),
    readMetadata: (id) => selectPRStatusRefreshMetadata.select(store.state, id),
    getDispatch: () => store.dispatch,
    async acquire(workspaceId, signal) {
      const acquired = await acquireWorkspaceGitReadScope(transport, workspaceId, signal);
      if (acquired.kind === 'unavailable') return acquired;
      const raw = acquired.scope;
      let prepared: Awaited<ReturnType<typeof raw.preparePrRefresh>> | undefined;
      const reads = createBackendGitReadRuntime({
        isCurrent: raw.isCurrent,
        request<T>(method: string, params: Record<string, unknown>): Promise<T> {
          if (params.workspaceId !== workspaceId) {
            // i18n-ignore (internal operation/scope mismatch)
            throw new BackendError({
              code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE',
              message: 'Captured Git workspace mismatch',
            });
          }
          switch (method) {
            case 'git.status':
              return raw.read<T>({
                operation: 'git-status',
                ...(params.forceRefresh === true ? { forceRefresh: true } : {}),
              });
            case 'file-tracking.getChanges':
              return raw.read<T>({ operation: 'tracked-changes' });
            case 'file-tracking.loadCommits':
              return raw.read<T>({
                operation: 'commits-with-boundary',
                ...(typeof params.includeOlder === 'boolean'
                  ? { includeOlder: params.includeOlder }
                  : {}),
              });
            case 'pr.refresh':
              if (prepared)
                return prepared.read<T>({
                  operation: 'pr-refresh',
                  ...(typeof params.automatic === 'boolean' ? { automatic: params.automatic } : {}),
                });
          }
          // i18n-ignore (internal operation/scope mismatch)
          throw new BackendError({
            code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE',
            message: 'Captured Git operation unavailable',
          });
        },
      });
      return {
        kind: 'acquired',
        scope: {
          identity: raw.identity,
          signal: raw.signal,
          isCurrent: raw.isCurrent,
          release: raw.release,
          reads,
          async preparePrRefresh() {
            const child = await raw.preparePrRefresh({ retainCurrentFailure: true });
            prepared = child;
            return {
              provenance: child.provenance,
              isCurrent: child.isCurrent,
              read: (options) => reads.prRefresh(workspaceId, options),
            };
          },
        },
      };
    },
  };
}
