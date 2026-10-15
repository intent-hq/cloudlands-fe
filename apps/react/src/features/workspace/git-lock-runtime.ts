import { m } from '$shared/paraglide/messages.js';
import { createBackendAgentLockReader } from '$lib/client/live/backend-agent-lock-reader';
import { setAgentLockState } from '../../../../../src/store/renderer/slices/agent-lock/agent-lock-slice';
import { store } from '@/store';
import { backendRequest } from '@/features/backend/backend-transport';
import { selectGitWriteContext } from '@/store/git/git-write-selectors';

/** Lock hydration shares the canonical status read owner; writes also re-read before dispatch. */
export async function readGitLocks(workspaceId: string, current?: () => boolean) {
  const context = selectGitWriteContext.select(store.state, workspaceId);
  const initial = store.state.agentLock.byWorkspaceId[workspaceId];
  const admitted = () =>
    !!context &&
    selectGitWriteContext.select(store.state, workspaceId) === context &&
    (current?.() ?? true);
  if (!admitted()) throw new Error(m.workspace_client_accessChanged_error());
  const locks = await createBackendAgentLockReader(
    async <T>(method: string, params: Record<string, unknown>) => {
      if (!admitted()) throw new Error(m.workspace_client_accessChanged_error());
      return backendRequest<T>(method, params, {
        onDispatch: () => {
          if (!admitted()) throw new Error(m.workspace_client_accessChanged_error());
        },
      });
    },
  )(workspaceId);
  if (!admitted()) throw new Error(m.workspace_client_accessChanged_error());
  if (
    store.state.git.byWorkspaceId[workspaceId] !== undefined &&
    store.state.agentLock.byWorkspaceId[workspaceId] === initial
  )
    store.dispatch(
      setAgentLockState(workspaceId, locks.lockedAgentIds, locks.lockedFilePaths, context!),
    );
  // A newer event is authoritative over the older hydration response.
  const latest = store.state.agentLock.byWorkspaceId[workspaceId];
  const newerEvent =
    latest?.authorityContext === context &&
    (latest.eventRevision ?? 0) > (initial?.eventRevision ?? 0);
  return newerEvent ? latest : locks;
}
