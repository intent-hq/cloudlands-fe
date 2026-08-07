/**
 * Focus a workspace's first unread top-level agent.
 *
 * Used by the sidebar Active card's Unread rows: after navigating to
 * `/workspace/{id}`, land on the first foreground agent whose session carries
 * `hasUnread === true` (PROTOCOL §5.5 AgentLite) rather than whatever tab the
 * workspace last had active. Ordering is `foregroundAgentIds` order, so the
 * daemon's agent order decides which unread agent wins.
 *
 * The agent list is usually not in the store yet at click time — the
 * navigation itself triggers the workspace's agent hydration. Instead of
 * fanning out an extra daemon RPC (forbidden per AGENTS.md), the helper
 * watches the store for that already-in-flight load to land, bounded by a
 * timeout. Only one watch is pending at a time; a newer call supersedes it.
 *
 * Tab open/focus is delegated to `openAgentTabRequested`, whose middleware
 * (`createAppLayoutNavigationMiddleware`) hydrates the session and opens or
 * focuses the agent tab — the same seam `switchToAttentionAgent` uses.
 *
 * Dependency-light, mirroring `key-switch-service.ts`: no selector imports,
 * state is read straight off `appStore.state`.
 */
import { store as appStore } from '$store/renderer/store';
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import { setActiveAgentId } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

/** How long to wait for the navigation-triggered agent load to land. */
const DEFAULT_TIMEOUT_MS = 5_000;

export interface FocusFirstUnreadAgentDeps {
  /** Bound on the wait for agent sessions. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Store-change subscription seam. Defaults to the app store's readable state. */
  subscribe?: (listener: () => void) => () => void;
}

function subscribeToStore(listener: () => void): () => void {
  return appStore.getReadableState().subscribe(() => listener());
}

/**
 * First foreground agent of `workspaceId` whose session has unread messages,
 * or null when the agents are not loaded yet or none is unread.
 */
export function findFirstUnreadForegroundAgentId(workspaceId: string): string | null {
  const state = appStore.state;
  const foregroundAgentIds =
    state.workspaceAgents?.byWorkspaceId[workspaceId]?.foregroundAgentIds ?? [];
  const sessions = state.agentSessions?.byAgentId ?? {};
  for (const id of foregroundAgentIds) {
    const agentId = String(id);
    if (sessions[agentId]?.hasUnread === true) return agentId;
  }
  return null;
}

/**
 * True once the workspace's agent hydration has actually landed in the store.
 *
 * `agentsLoaded` alone is not enough: `hydrateWorkspaceAgents` (and the boot
 * `agents-seeder`) dispatch `setAgentsLoaded(wsId, true)` *before* `setAgents`
 * and `bulkUpsertSessions`, and the store notifies synchronously per dispatch —
 * so the flag flips while `foregroundAgentIds` and the sessions carrying
 * `hasUnread` are still absent. The watch must therefore also see the
 * foreground list populated and a session for every foreground agent; until
 * then the only exit is the timeout (which is also what a genuinely
 * agent-less workspace falls back to, dispatching nothing either way).
 */
function areAgentsLoaded(workspaceId: string): boolean {
  const state = appStore.state;
  const workspaceState = state.workspaceAgents?.byWorkspaceId[workspaceId];
  if (workspaceState?.agentsLoaded !== true) return false;
  const foregroundAgentIds = workspaceState.foregroundAgentIds ?? [];
  if (foregroundAgentIds.length === 0) return false;
  const sessions = state.agentSessions?.byAgentId ?? {};
  return foregroundAgentIds.every((id) => sessions[String(id)] !== undefined);
}

function activateAgent(workspaceId: string, agentId: string): void {
  appStore.dispatch(setActiveAgentId(workspaceId, agentId));
  appStore.dispatch(openAgentTabRequested(workspaceId, { agentId }));
}

/** Pending watch teardown — a newer call supersedes the previous one. */
let cancelPendingWatch: (() => void) | null = null;

/**
 * Activate the workspace's first unread top-level agent, waiting (bounded) for
 * the agent list to hydrate when it is not in the store yet. No-op when the
 * workspace has no unread foreground agent, leaving the current tab in place.
 */
export function focusFirstUnreadAgent(
  workspaceId: string,
  deps: FocusFirstUnreadAgentDeps = {},
): void {
  cancelPendingWatch?.();
  cancelPendingWatch = null;

  const immediate = findFirstUnreadForegroundAgentId(workspaceId);
  if (immediate !== null) {
    activateAgent(workspaceId, immediate);
    return;
  }
  // Agents already hydrated and none unread: nothing to wait for.
  if (areAgentsLoaded(workspaceId)) return;

  let unsubscribe: (() => void) | null = null;
  const timer = setTimeout(() => {
    stop();
  }, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  function stop(): void {
    clearTimeout(timer);
    unsubscribe?.();
    unsubscribe = null;
    if (cancelPendingWatch === stop) cancelPendingWatch = null;
  }

  // The store readable emits synchronously on subscribe; that first emission is
  // the state already checked above, so `unsubscribe === null` skips it (and
  // any post-stop notification).
  unsubscribe = (deps.subscribe ?? subscribeToStore)(() => {
    if (unsubscribe === null) return;
    const agentId = findFirstUnreadForegroundAgentId(workspaceId);
    if (agentId !== null) {
      stop();
      activateAgent(workspaceId, agentId);
      return;
    }
    if (areAgentsLoaded(workspaceId)) stop();
  });
  cancelPendingWatch = stop;
}
