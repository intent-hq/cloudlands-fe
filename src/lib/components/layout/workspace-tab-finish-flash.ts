import type { WorkspaceStatusPresentationState } from '$lib/components/workspace/utils/workspace-status-presentation';

/** How long a background tab keeps its "just finished" dot. */
export const WORKSPACE_TAB_FINISH_FLASH_MS = 30_000;

export interface WorkspaceTabFinishObservation {
  workspaceId: string;
  state: WorkspaceStatusPresentationState;
  isCurrent: boolean;
}

export interface WorkspaceTabFinishFlashes {
  previous: ReadonlyMap<string, WorkspaceStatusPresentationState>;
  expiresAt: ReadonlyMap<string, number>;
}

export const EMPTY_WORKSPACE_TAB_FINISH_FLASHES: WorkspaceTabFinishFlashes = {
  previous: new Map(),
  expiresAt: new Map(),
};

/**
 * A background tab flashes when its status goes from working to unread; the
 * flash lasts until it expires, the tab becomes current, or the status moves
 * on. Tabs that are no longer observed are forgotten.
 */
export function nextWorkspaceTabFinishFlashes(
  current: WorkspaceTabFinishFlashes,
  observations: readonly WorkspaceTabFinishObservation[],
  now: number,
): WorkspaceTabFinishFlashes {
  const previous = new Map<string, WorkspaceStatusPresentationState>();
  const expiresAt = new Map<string, number>();
  for (const { workspaceId, state, isCurrent } of observations) {
    previous.set(workspaceId, state);
    if (isCurrent || state !== 'unread') continue;
    if (current.previous.get(workspaceId) === 'in_progress') {
      expiresAt.set(workspaceId, now + WORKSPACE_TAB_FINISH_FLASH_MS);
      continue;
    }
    const existing = current.expiresAt.get(workspaceId);
    if (existing !== undefined && existing > now) expiresAt.set(workspaceId, existing);
  }
  return { previous, expiresAt };
}

/** Earliest pending expiry, or `null` when nothing is flashing. */
export function nextWorkspaceTabFinishFlashExpiry(flashes: WorkspaceTabFinishFlashes): number | null {
  let earliest: number | null = null;
  for (const at of flashes.expiresAt.values()) {
    if (earliest === null || at < earliest) earliest = at;
  }
  return earliest;
}
