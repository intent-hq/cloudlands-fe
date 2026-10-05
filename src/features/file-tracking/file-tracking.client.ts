/** Agent-lock hydration from the daemon (PROTOCOL §5.19). */

import { backendRequest } from '$lib/client/live/backend-transport';
import { store as appStore } from '$store/renderer/store';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  selectHostRole,
  selectPrincipalActionContext,
} from '$store/renderer/slices/principal/principal-selectors';
import {
  selectWorkspaceById,
  selectWorkspaceListLoadedForBackend,
} from '$store/renderer/slices/workspace/workspace-selectors';
import { setAgentLockState } from '$store/renderer/slices/agent-lock/agent-lock-slice';

/** Fold a wire string[] into the slice's `Record<string, true>` lookup shape. */
export function toLockRecord(value: unknown): Record<string, true> {
  const record: Record<string, true> = {};
  if (!Array.isArray(value)) return record;
  for (const entry of value) {
    if (typeof entry === 'string') record[entry] = true;
  }
  return record;
}

/**
 * Hydrate a workspace's agent-lock snapshot from the daemon
 * (PROTOCOL §5.19 `file-tracking.getAgentLocks` — the hydration read for the
 * `changes:agent-locks` event, §6.5) and fold it into the agent-lock slice.
 * A failed read degrades to unlocked (empty records), matching the daemon's
 * own store-failure behavior — a stale locked snapshot must never outlive a
 * hydration attempt; the `changes:agent-locks` event converges it later.
 * Note: an event landing while this read is in flight is overwritten by the
 * (older) read response; the daemon only re-emits on diff, so the window is
 * tiny and self-heals on the next real change.
 */
function lockReadContext(workspaceId: string): string | null {
  const state = appStore.state;
  const context = selectPrincipalActionContext.select(state);
  const role = selectHostRole.select(state);
  if (
    !context ||
    (role !== 'owner' && role !== 'member') ||
    (role === 'member' && workspaceId === CHIEF_WORKSPACE_ID) ||
    !selectWorkspaceById.select(state, workspaceId) ||
    !selectWorkspaceListLoadedForBackend.select(state, state.connections.windowBackendId) ||
    state.workspace.capabilityContext !== context
  )
    return null;
  return context;
}

export async function hydrateAgentLocks(workspaceId: string): Promise<void> {
  const context = lockReadContext(workspaceId);
  if (!context) return;
  let lockedAgentIds: Record<string, true> = {};
  let lockedFilePaths: Record<string, true> = {};
  try {
    const result = await backendRequest<Record<string, unknown>>('file-tracking.getAgentLocks', {
      workspaceId,
    });
    lockedAgentIds = toLockRecord(result?.lockedAgentIds);
    lockedFilePaths = toLockRecord(result?.lockedFilePaths);
  } catch {
    // Degrade to unlocked; the `changes:agent-locks` event converges it later.
  }
  if (lockReadContext(workspaceId) !== context) return;
  appStore.dispatch(setAgentLockState(workspaceId, lockedAgentIds, lockedFilePaths));
}
