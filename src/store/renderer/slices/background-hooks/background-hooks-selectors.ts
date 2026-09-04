/**
 * Background Hooks Selectors
 */

import { store } from '../../store';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { BackgroundHook } from '$features/hooks/background-hooks-service';

/** All live-subscribed hooks for a workspace (every wire state), in seed order. */
export const selectBackgroundHooks = store.createSelector(
  (state, workspaceId: string): BackgroundHook[] => {
    const ws = state.backgroundHooks.byWorkspaceId[workspaceId];
    if (!ws) return [];
    return getItems(ws.hooks);
  },
);

/**
 * Utility-footer readiness: true once the workspace's initial `hook.list`
 * seed has been delivered (the saga writes an entry on success AND on a
 * failed seed — failure counts as ready-with-empty, so this never wedges
 * the transcript reveal). Entries are RETAINED (stale-marked, not cleared)
 * when the workspace's last subscriber leaves, so a warm switch-back stays
 * latched and reveals without waiting on a fresh `hook.list`.
 */
export const selectBackgroundHooksSnapshotDelivered = store.createSelector(
  (state, workspaceId: string): boolean =>
    state.backgroundHooks?.byWorkspaceId?.[workspaceId] !== undefined,
);
