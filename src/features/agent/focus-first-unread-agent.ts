/**
 * Focus the agent a workspace's unread badge most likely refers to.
 *
 * Used by the sidebar Active card's Unread rows: after navigating to
 * `/workspace/{id}`, land on the agent that plausibly holds the unread message
 * rather than whatever tab the workspace last had active.
 *
 * ## Unread is workspace-level, not per-agent
 *
 * The unread signal the user sees is the BE-owned workspace `attention` flag
 * (`attention === 'unread'`, PROTOCOL §5.1) — the same flag the Unread section
 * itself filters on. There is no per-agent unread flag on the wire:
 * `AgentSession.hasUnread` exists in the FE type but is never populated (it is
 * absent from AgentLite, which carries the per-conversation seen marker
 * `metadata.lastSeenMessageId` instead), and nothing derives it client-side.
 *
 * So this helper mirrors what every other FE surface already does — see
 * `WorkspaceHoverCard.svelte`, `SpacesSwitcherOverlay.svelte`, and
 * `WorkspaceTableView.svelte`, which all treat a workspace's member agents as
 * unread when the workspace flag is raised — and then picks the most plausible
 * member with a heuristic. It is a heuristic, not an exact answer; narrowing it
 * to an exact per-agent signal is tracked in intent-hq/monorepo#1597.
 *
 * The caller must pass the workspace's `attention === 'unread'` state as
 * `wasUnread`, captured **before** navigation: viewing a workspace fires
 * `workspace.markSeen` (fire-and-forget, §5.1) and the resulting
 * `workspace:attention-changed` clears the flag, so a post-navigation read
 * would frequently see `none` and the feature would misfire as a race.
 *
 * ## Waiting for hydration
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
 * The foreground agent most likely holding the workspace's unread message, or
 * null when the agents are not loaded yet or no agent qualifies.
 *
 * Heuristic (see the module doc for why one is needed): the first foreground
 * agent whose session's newest transcript message is the assistant's
 * (`lastMessageRole === 'assistant'`, `AgentLite`, PROTOCOL §5.5) — i.e. the
 * agent spoke last and there is something new for the user to read. Ordering is
 * `foregroundAgentIds` order, so the daemon's agent order breaks ties. Older
 * daemons omit the field, in which case nothing qualifies and the caller falls
 * back to plain navigation.
 */
export function findFirstUnreadForegroundAgentId(workspaceId: string): string | null {
  const state = appStore.state;
  const foregroundAgentIds =
    state.workspaceAgents?.byWorkspaceId[workspaceId]?.foregroundAgentIds ?? [];
  const sessions = state.agentSessions?.byAgentId ?? {};
  for (const agentId of foregroundAgentIds) {
    if (sessions[agentId]?.lastMessageRole === 'assistant') return agentId;
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
 * `lastMessageRole` are still absent. The watch must therefore also see the
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
  return foregroundAgentIds.every((agentId) => sessions[agentId] !== undefined);
}

/** The workspace's currently selected agent, or null when none is set. */
function activeAgentIdOf(workspaceId: string): string | null {
  return appStore.state.workspaceAgents?.byWorkspaceId[workspaceId]?.activeAgentId ?? null;
}

function activateAgent(workspaceId: string, agentId: string): void {
  appStore.dispatch(setActiveAgentId(workspaceId, agentId));
  appStore.dispatch(openAgentTabRequested(workspaceId, { agentId }));
}

/** Pending watch teardown — a newer call supersedes the previous one. */
let cancelPendingWatch: (() => void) | null = null;

/**
 * Activate the agent the workspace's unread badge most likely refers to,
 * waiting (bounded) for the agent list to hydrate when it is not in the store
 * yet. No-op when no foreground agent qualifies, leaving the current tab in
 * place.
 *
 * `wasUnread` is the workspace's `attention === 'unread'` state read *before*
 * navigation (see the module doc): `false` short-circuits, so a plain
 * workspace click never moves the tab.
 */
export function focusFirstUnreadAgent(
  workspaceId: string,
  wasUnread: boolean,
  deps: FocusFirstUnreadAgentDeps = {},
): void {
  cancelPendingWatch?.();
  cancelPendingWatch = null;

  if (!wasUnread) return;

  const immediate = findFirstUnreadForegroundAgentId(workspaceId);
  if (immediate !== null) {
    activateAgent(workspaceId, immediate);
    return;
  }
  // Agents already hydrated and none unread: nothing to wait for.
  if (areAgentsLoaded(workspaceId)) return;

  // Focus-steal guards: the watch outlives the click, so it must not yank a
  // selection the user made in the meantime. Bail when they navigated away from
  // this workspace, or when an existing agent selection changed under us.
  //
  // The workspace guard only engages once `activeWorkspaceId` has actually
  // reached `workspaceId`. The watch arms right after `goto()` is *invoked*,
  // and `setActiveWorkspaceId(workspaceId)` only lands with the navigation
  // effect — so until then the store still reports the previous workspace, and
  // an eager guard would read every emission in that gap as a navigation away
  // and cancel the watch before hydration ever landed.
  //
  // The selection guard only applies to a NON-NULL armed selection: hydration
  // itself picks a default agent when none is set (`hydrateWorkspaceAgents` /
  // `agents-seeder`), and that expected default must not read as a takeover.
  // With a selection already in place both hydration paths preserve it, so a
  // change then really is someone else moving the tab.
  const armedActiveAgentId = activeAgentIdOf(workspaceId);
  let arrived = appStore.state.workspace?.activeWorkspaceId === workspaceId;
  function userTookOver(): boolean {
    const activeWorkspaceId = appStore.state.workspace?.activeWorkspaceId;
    if (activeWorkspaceId === workspaceId) arrived = true;
    else if (arrived) return true;
    if (armedActiveAgentId === null) return false;
    return activeAgentIdOf(workspaceId) !== armedActiveAgentId;
  }

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
    if (userTookOver()) {
      stop();
      return;
    }
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
