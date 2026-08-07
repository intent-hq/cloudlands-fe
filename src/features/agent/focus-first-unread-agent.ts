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
 * member by the tiered heuristic in
 * {@link findFirstUnreadForegroundAgentId}: the exact `hasUnread` marker first
 * (inert today, so the fix tracked in intent-hq/monorepo#1597 lands here for
 * free), then "the agent spoke last", then the workspace's first foreground
 * agent. It is a heuristic, not an exact answer.
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
 * null when nothing qualifies yet.
 *
 * Three tiers, each scanned in `foregroundAgentIds` order so the daemon's agent
 * order breaks ties (see the module doc for why a heuristic is needed at all):
 *
 * 1. `session.hasUnread === true` — the exact per-agent answer. Never matches
 *    today (nothing populates the field), kept so the projection tracked in
 *    intent-hq/monorepo#1597 takes effect here without a code change.
 * 2. `session.lastMessageRole === 'assistant'` (`AgentLite`, PROTOCOL §5.5) —
 *    the agent spoke last, so there is plausibly something new to read.
 * 3. The first foreground agent — the workspace *is* unread, so landing on its
 *    primary agent beats leaving the user on an unrelated tab.
 *
 * Tier 3 waits for {@link areAgentsLoaded}: mid-hydration the foreground list
 * lands before the sessions carrying the tier 1/2 signals, so falling back
 * early would settle for the first agent while the actually-unread one was
 * still in flight. Tiers 1 and 2 are deliberately *not* gated — they only ever
 * match on evidence, so acting on the first one to arrive is right. The
 * asymmetry costs a bounded tie-break: if sessions land piecemeal (streaming
 * upserts rather than hydration's single `bulkUpsertSessions`), tier 2 breaks
 * ties by store-landing order instead of `foregroundAgentIds` order.
 */
export function findFirstUnreadForegroundAgentId(workspaceId: string): string | null {
  const state = appStore.state;
  const foregroundAgentIds =
    state.workspaceAgents?.byWorkspaceId[workspaceId]?.foregroundAgentIds ?? [];
  if (foregroundAgentIds.length === 0) return null;
  const sessions = state.agentSessions?.byAgentId ?? {};
  for (const agentId of foregroundAgentIds) {
    if (sessions[agentId]?.hasUnread === true) return agentId;
  }
  for (const agentId of foregroundAgentIds) {
    if (sessions[agentId]?.lastMessageRole === 'assistant') return agentId;
  }
  return areAgentsLoaded(workspaceId) ? foregroundAgentIds[0] : null;
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
 * yet. No-op when the workspace has no foreground agent to land on, leaving the
 * current tab in place.
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

  // Focus-steal guards: the watch outlives the click, so it must not yank a
  // selection the user made in the meantime. Bail when they navigated away from
  // this workspace, or when an existing agent selection changed under us.
  //
  // The workspace guard tolerates the arming gap: the watch arms right after
  // `goto()` is *invoked*, but `setActiveWorkspaceId(workspaceId)` only lands
  // with the navigation effect, so until then the store still reports the
  // workspace we departed from. An eager equality guard would read every
  // emission in that gap as a navigation away and cancel the watch before
  // hydration ever landed.
  //
  // So "still pending" is specifically *still on `departedFrom`* — not merely
  // "not on the target". A third workspace id means the user navigated
  // elsewhere before this navigation ever completed (click unread A, then B),
  // and the watch must bail rather than survive to mutate A's tab in the
  // background once A's agents hydrate.
  //
  // The selection guard only applies to a NON-NULL armed selection: hydration
  // itself picks a default agent when none is set (`hydrateWorkspaceAgents` /
  // `agents-seeder`), and that expected default must not read as a takeover.
  // With a selection already in place both hydration paths preserve it, so a
  // change then really is someone else moving the tab.
  const armedActiveAgentId = activeAgentIdOf(workspaceId);
  const departedFrom = appStore.state.workspace?.activeWorkspaceId ?? null;
  let arrived = departedFrom === workspaceId;
  function userTookOver(): boolean {
    const activeWorkspaceId = appStore.state.workspace?.activeWorkspaceId ?? null;
    if (activeWorkspaceId === workspaceId) arrived = true;
    else if (arrived || activeWorkspaceId !== departedFrom) return true;
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
    }
    // No `areAgentsLoaded` exit: once hydration lands the tier-3 fallback always
    // yields a candidate, so the only silent exits are a takeover and the
    // timeout (the latter also covering a genuinely agent-less workspace).
  });
  cancelPendingWatch = stop;
}
