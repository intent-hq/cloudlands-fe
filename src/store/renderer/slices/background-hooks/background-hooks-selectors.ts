/**
 * Background Hooks Selectors
 */

import { store } from "../../store";
import { getItems } from "$lib/store-shim/utils/collections/collection-utils";
import type { BackgroundHook } from "$features/hooks/background-hooks-service";

/** All live-subscribed hooks for a workspace (every wire state), in seed order. */
export const selectBackgroundHooks = store.createSelector(
  (state, workspaceId: string): BackgroundHook[] => {
    const ws = state.backgroundHooks.byWorkspaceId[workspaceId];
    if (!ws) return [];
    return getItems(ws.hooks);
  },
);
