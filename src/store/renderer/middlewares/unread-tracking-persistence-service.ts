/**
 * Unread-tracking persistence service — restores the localStorage hydrate/persist
 * and the `clearWorkspaceUnread` translation that the removed
 * `unread-tracking/sagas/unread-tracking-saga` performed. With no saga listening,
 * unread state never loaded on boot or persisted on change, and
 * `clearWorkspaceUnread` (dispatched from the workspace cards) was a pure no-op
 * because the slice cannot map a workspace id to its agent ids on its own.
 *
 * Like `lifecycle-read-service`, this reconnects the path WITHOUT re-adding a
 * saga and WITHOUT changing any call site:
 *   - On creation it hydrates `unreadAgentIds` from localStorage once.
 *   - After any unread-mutating action it writes the current ids back.
 *   - On `clearWorkspaceUnread` it reads the workspace's agent ids from state and
 *     dispatches `clearAgentsUnread` (which then persists via the branch above).
 *
 * Dependency-light per src/store AGENTS.md: imports only the safe-storage helper
 * and slice actions — no selectors and no store module (state is read through the
 * middleware `api.getState()`).
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { safeLocalStorage } from "$lib/utils/safe-storage";
import type { StoreState } from "../types";
import {
  clearAgentsUnread,
  clearAgentUnread,
  clearAllUnread,
  clearWorkspaceUnread,
  hydrateUnreadTracking,
  markAgentAsViewed,
  newAssistantMessage,
} from "../slices/unread-tracking/unread-tracking-slice";

const STORAGE_KEY = "augment:unread-agents";

/** Actions whose reducer can change `unreadAgentIds` and therefore need a write-back. */
const PERSIST_ACTION_TYPES = new Set<string>([
  markAgentAsViewed.type,
  newAssistantMessage.type,
  clearAgentUnread.type,
  clearAgentsUnread.type,
  clearAllUnread.type,
]);

function loadStoredUnreadIds(): string[] {
  const stored = safeLocalStorage.getJSON<unknown>(STORAGE_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.filter((id): id is string => typeof id === "string");
}

function persistUnreadIds(state: StoreState): void {
  safeLocalStorage.setJSON(STORAGE_KEY, state.unreadTracking.unreadAgentIds);
}

function workspaceAgentIds(state: StoreState, wsId: string): string[] {
  return state.workspaceAgents.byWorkspaceId[wsId]?.agentIds ?? [];
}

/**
 * Middleware giving the unread-tracking persistence + workspace-clear triggers
 * real handlers again. Hydration runs once at factory time (state is already
 * initialized through the INIT reducer pass before the middleware chain is
 * composed); persistence runs after each mutating action passes the reducer.
 */
export function createUnreadTrackingPersistenceMiddleware(): StoreMiddleware {
  return (api) => {
    const storedIds = loadStoredUnreadIds();
    if (storedIds.length > 0) {
      api.dispatch(hydrateUnreadTracking({ unreadAgentIds: storedIds }));
    }

    return (next) => (action) => {
      if (action && action.type === clearWorkspaceUnread.type) {
        const wsId = Array.isArray(action.payload) ? action.payload[0] : undefined;
        const result = next(action);
        if (typeof wsId === "string" && wsId.length > 0) {
          const state = api.getState() as StoreState;
          const agentIds = workspaceAgentIds(state, wsId);
          if (agentIds.length > 0) {
            const unreadSet = new Set(state.unreadTracking.unreadAgentIds);
            const unreadWorkspaceAgentIds = agentIds.filter((id) => unreadSet.has(id));
            if (unreadWorkspaceAgentIds.length > 0) {
              api.dispatch(clearAgentsUnread(unreadWorkspaceAgentIds));
            }
          }
        }
        return result;
      }

      const result = next(action);
      if (action && PERSIST_ACTION_TYPES.has(action.type)) {
        persistUnreadIds(api.getState() as StoreState);
      }
      return result;
    };
  };
}
