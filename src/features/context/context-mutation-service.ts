/**
 * Context mutation service — routes local `context/*` reducer actions to the
 * daemon-owned `workspace.updateContext` RPC (PROTOCOL §5.1). The reducer
 * runs first for instant UI feedback (add/remove/update is optimistic); the
 * middleware then reads the workspace's new authoritative items list from the
 * slice and forwards it as the full-list replacement the daemon expects.
 * Cross-window convergence flows via the `workspace:context-changed` event
 * the daemon emits after every `updateContext`, folded back into the store by
 * the daemon-events bridge.
 *
 * READ-THROUGH: the middleware never writes state itself; it only issues the
 * wire call so the daemon becomes the source of truth. Concurrent dispatches
 * for the same workspace are coalesced per-workspace so a burst of
 * add/remove clicks collapses into a single trailing `updateContext` with
 * the final items array.
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam,
 * the configured store, the slice actions/types, a pure collection lookup,
 * and the logger. No selector modules (importing them would evaluate
 * `store.createSelector` during middleware-chain construction).
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { getItems } from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import type { ContextItem } from "$features/context/types";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  addContextItem,
  removeContextItem,
  updateContextItem,
} from "$store/renderer/slices/context/context-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("ContextMutationService");

/** Coalesce trailing `updateContext` calls per workspace so bursts collapse. */
const pending = new Map<string, { queued: boolean; running: boolean }>();

function currentItems(workspaceId: string): ContextItem[] {
  const ws = appStore.state.context.byWorkspaceId[workspaceId];
  return ws ? getItems(ws.items) : [];
}

function scheduleSync(workspaceId: string): void {
  const slot = pending.get(workspaceId);
  if (slot?.running) {
    slot.queued = true;
    return;
  }
  const fresh = { queued: false, running: true };
  pending.set(workspaceId, fresh);
  void (async () => {
    try {
      await appClient.workspaces.updateContext(workspaceId, currentItems(workspaceId));
    } catch (error) {
      logger.error("workspace.updateContext failed", { workspaceId, error });
    } finally {
      const after = pending.get(workspaceId);
      pending.delete(workspaceId);
      if (after?.queued) scheduleSync(workspaceId);
    }
  })();
}

function workspaceIdOf(action: { payload?: unknown }): string | undefined {
  return Array.isArray(action.payload) && typeof action.payload[0] === "string"
    ? action.payload[0]
    : undefined;
}

/**
 * Middleware giving the context slice's mutation actions a real write path.
 * After the reducer produces the new items list, forward it to the daemon so
 * the workspace's authoritative context state converges via the
 * `workspace:context-changed` event.
 */
export function createContextMutationMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action) {
      switch (action.type) {
        case addContextItem.type:
        case removeContextItem.type:
        case updateContextItem.type: {
          const workspaceId = workspaceIdOf(action);
          if (workspaceId) scheduleSync(workspaceId);
          break;
        }
      }
    }
    return result;
  };
}

/** Test-only — clear the pending-sync map between test cases. */
export function __resetContextMutationForTests(): void {
  pending.clear();
}
