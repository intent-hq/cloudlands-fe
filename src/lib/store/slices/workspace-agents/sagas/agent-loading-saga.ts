import {
  focusPanel,
  openTab,
  openTabInAdjacentOrSplit,
  reconcileStaleAgentTabs as reconcileStaleAgentTabsAction,
  setActiveTab,
} from '$lib/store/slices/panel-layout/panel-layout-slice';
import {
  selectPanels,
  selectRestoreStatus,
} from '$lib/store/slices/panel-layout/panel-layout-selectors';
import { workspaceStorageManager } from '$lib/store/slices/workspace/utils/workspace-storage-manager';
import { shouldDeferSpecPanel } from '$lib/store/slices/app-layout/sagas/spec-panel-saga';
import { SPEC_NOTE_ID } from '$shared/constants/notes';
import {
  AgentId,
  WorkspaceId,
} from '$shared/types/branded-ids';
import type { AgentSession } from '$shared/types';
import type { UnifiedAgentConfig } from '$shared/types/agent.types';
import type { StoredAgent } from '$lib/utils/agent-loader';
import type { PanelLayoutRestoreStatus } from '$lib/store/slices/panel-layout/panel-layout-types';
import {
  call,
  delay,
  put,
} from 'typed-redux-saga';
import {
  markAgentRecentlyCreated,
  setAgents,
  setAgentsLoaded,
  setIsLoadingAgents,
  activateInitialAgentRequested,
  clearInitialAgentConfig,
  ensureAgentSessionLoaded,
  setInitialAgentId,
  triggerBackendStreamReconnect,
  reconnectStreamHandlersForWorkspaceRequested,
  type InitialAgentConfig,
} from '../workspace-agents-slice';
import {
  selectAgentsLoaded,
  selectForegroundWorkspaceAgents,
  selectInitialAgentId,
  selectInitialAgentConfig,
  selectIsLoadingAgents,
} from '../workspace-agents-selectors';
import {
  bulkUpsertSessions,
  removeWorkspaceSessions,
} from '../../agent-session/agent-session-slice';
import { clearWorkspaceUnread } from '../../unread-tracking/unread-tracking-slice';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';

const PANEL_LAYOUT_RESTORE_POLL_MS = 100;
const PANEL_LAYOUT_RESTORE_TIMEOUT_MS = 2_000;
const AGENT_RESTORE_POLL_MS = 100;
const AGENT_RESTORE_TIMEOUT_MS = 5_000;
const INITIAL_AGENT_ACTIVATION_TIMEOUT_MS = 60_000;

function* waitForAgentSession(
  agentId: string,
  timeoutMs = AGENT_RESTORE_TIMEOUT_MS,
  isReady: (session: AgentSession) => boolean = () => true,
) {
  const maxAttempts = Math.ceil(timeoutMs / AGENT_RESTORE_POLL_MS);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const session: AgentSession | undefined = yield* selectAgentSession.effect(agentId);
    if (session && isReady(session)) return session;
    yield* delay(AGENT_RESTORE_POLL_MS);
  }
  return null;
}

function hasUsableInitialAgentSession(session: AgentSession | undefined | null): session is AgentSession {
  return !!session?.backendSessionId && String(session.status).toLowerCase() !== 'pending';
}

function getStoredAgentBackendSessionId(agent: StoredAgent): string | null {
  return (
    (agent as any).backendSessionId ??
    (agent as any).sessionId ??
    (agent as any).backendAgentId ??
    null
  );
}

function storedAgentHasInitialPrompt(agent: StoredAgent): boolean {
  const prompt =
    (agent as any).metadata?.initialMessage ??
    (agent as any).config?.metadata?.initialMessage ??
    (agent as any).config?.prompt;
  return typeof prompt === 'string' ? prompt.trim().length > 0 : !!prompt;
}

function buildInitialActivationConfig(
  wsId: string,
  agentId: string,
  config: InitialAgentConfig['config'] & Record<string, any>,
  diskMeta?: Record<string, any>,
  diskAgent?: StoredAgent,
): UnifiedAgentConfig {
  return {
    workspaceId: WorkspaceId(wsId),
    id: agentId,
    name: config.name || (diskAgent as any)?.name || 'Agent',
    model: config.model || (diskAgent as any)?.model,
    provider: config.provider || diskMeta?.provider,
    agentType: config.agentType || diskMeta?.agentType,
    initialMessage: config.prompt || diskMeta?.initialMessage,
    contextReferences: config.contextReferences,
    imageBlocks: config.imageBlocks || diskMeta?.imageBlocks,
    behaviorPrompt: config.behaviorPrompt,
    source: 'workspace-initializer',
    metadata: {
      ...diskMeta,
      ...config.metadata,
      isInitialAgent: true,
      isFirstWorkspaceAgent: config.isFirstWorkspaceAgent ?? diskMeta?.isFirstWorkspaceAgent,
      specialist: config.specialist || diskMeta?.specialist,
    },
  };
}

function shouldClearUnreadForLoadedWorkspace(wsId: string): boolean {
  return !!wsId && wsId !== 'new' && !wsId.startsWith('optimistic-');
}

/**
 * Open an agent tab in the panel layout manager.
 * Replicates the component-local `openAgentInLayout` using direct layout manager calls.
 *
 * Generator: reads `panels` via `yield* selectPanels.effect(wsId)` so saga-context
 * code never performs one-time selector reads from the configured app store.
 */
function* openAgentInLayout(
  agentId: string,
  agentName: string,
  wsId: string,
  options?: {
    focusIfExists?: boolean;
  },
) {
  const focusIfExists = options?.focusIfExists ?? true;
  const panels = yield* selectPanels.effect(wsId);
  for (const [panelId, panel] of Object.entries(panels)) {
    const existingAgentTab = panel.tabs.find((t) => t.type === 'agent' && t.agentId === agentId);
    if (existingAgentTab) {
      if (focusIfExists) {
        yield* put(focusPanel(wsId, panelId));
        yield* put(setActiveTab(wsId, existingAgentTab.id, panelId));
      }
      return;
    }
  }
  yield* put(
    openTab(wsId, {
      type: 'agent',
      title: agentName || 'Agent',
      agentId,
      closable: true,
    }),
  );
}

function* getAllTabsForWorkspace(wsId: string) {
  const panels = yield* selectPanels.effect(wsId);
  return Object.values(panels).flatMap((panel) => panel.tabs);
}

/** @internal Exported for testing only. */
export function* waitForPanelLayoutRestore(wsId: string) {
  const maxAttempts = PANEL_LAYOUT_RESTORE_TIMEOUT_MS / PANEL_LAYOUT_RESTORE_POLL_MS;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const panels = yield* selectPanels.effect(wsId);
    const hasTabs = Object.values(panels).flatMap((panel) => panel.tabs).length > 0;
    const restoreStatus: PanelLayoutRestoreStatus = yield* selectRestoreStatus.effect(wsId);
    if (hasTabs || (restoreStatus !== 'idle' && restoreStatus !== 'pending')) {
      return;
    }
    yield* delay(PANEL_LAYOUT_RESTORE_POLL_MS);
  }
}

/**
 * Core agent loading saga – extracted from the component's `loadAgentsFromDisk()`.
 *
 * Race-prevention strategy (mount-race hardening):
 * 1. `isLoadingAgents` is set BEFORE the async work begins, acting as a saga-level
 *    guard that prevents duplicate concurrent loads for the same workspace.
 * 2. Final state publication keeps `setAgents` before `setAgentsLoaded` so the
 *    sidebar observes a populated agent list before the loaded flag flips true.
 */
export function* loadAgentsFromDiskSaga(wsId: string) {
  if (typeof window === 'undefined') return;
  // Guard: check-and-set must happen before any async work.
  // Both selectors are checked atomically within the same saga tick,
  // and `setIsLoadingAgents(true)` is dispatched immediately after,
  // so a second concurrent fork for the same wsId will see the flag
  // and bail out before reaching the lock or disk I/O.
  const alreadyLoaded: boolean = yield* selectAgentsLoaded.effect(wsId);
  const alreadyLoading: boolean = yield* selectIsLoadingAgents.effect(wsId);
  if (alreadyLoaded || alreadyLoading) return;
  yield* put(setIsLoadingAgents(wsId, true));
  try {
    // 1. Existing foreground agents from Redux
    const existingAgents: AgentSession[] = yield* selectForegroundWorkspaceAgents.effect(wsId);
    const existingAgentIds = new Set(existingAgents.filter((a) => a).map((a) => a.id));
    // 2. Load from disk
    const { getStoredAgentsFromDisk } = yield* call(() => import('$lib/utils/agent-loader'));
    const initialAgentId: string | null = yield* selectInitialAgentId.effect(wsId);
    // Retry loop when expecting an initial agent
    const diskAgents: Awaited<ReturnType<typeof getStoredAgentsFromDisk>> = yield* call(
      async () => {
        const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
        let attempt = 0;
        let agents = await getStoredAgentsFromDisk(wsId);
        while (
          initialAgentId &&
          !wsId.startsWith('optimistic-') &&
          !agents.some((a) => a.id === AgentId(initialAgentId)) &&
          attempt < 3
        ) {
          attempt++;
          await pause(150);
          agents = await getStoredAgentsFromDisk(wsId);
        }
        return agents;
      },
    );
    // 2b. Recover initialAgentId from disk metadata if Redux lost it (e.g. after refresh)
    let effectiveInitialAgentId = initialAgentId;
    if (!effectiveInitialAgentId) {
      const firstAgent = diskAgents.find(
        (a) => (a as any).metadata?.isFirstWorkspaceAgent === true,
      );
      if (firstAgent) {
        effectiveInitialAgentId = firstAgent.id as string;
        yield* put(setInitialAgentId(wsId, effectiveInitialAgentId));
      }
    }
    // 3. Restore initial agent with priority
    yield* restoreInitialAgent(wsId, effectiveInitialAgentId, diskAgents, existingAgentIds);
    // 4. Restore remaining agents in parallel
    yield* restoreRemainingAgents(wsId, diskAgents, existingAgentIds, effectiveInitialAgentId);
    // 5. Collect final agent list from Redux
    const restoredAgents: AgentSession[] = yield* selectForegroundWorkspaceAgents.effect(wsId);
    const filteredAgents = restoredAgents.filter((a) => a && !String(a.id).startsWith('terminal-'));
    // Publish agents and loaded flag atomically so the sidebar never
    // sees an intermediate state (agents set but loaded still false,
    // or loaded true with stale/empty agents).
    yield* put(bulkUpsertSessions(filteredAgents));
    yield* put(setAgents(wsId, filteredAgents));
    yield* put(setAgentsLoaded(wsId, true));
    if (shouldClearUnreadForLoadedWorkspace(wsId)) {
      yield* put(clearWorkspaceUnread(wsId));
    }
    yield* call(waitForPanelLayoutRestore, wsId);
    // 6. Reconcile stale agent tabs in panel layout
    yield* reconcileStaleAgentTabs(wsId, restoredAgents);
    // 7. Reconnect IPC stream handlers
    yield* put(reconnectStreamHandlersForWorkspaceRequested(wsId));
    // 8. Request backend stream reconnect. The reconnect saga handles backend
    // queries and intentionally does not auto-open a random streaming agent.
    yield* put(triggerBackendStreamReconnect());
    const hasOpenedStreamingAgent = false;
    // 9. Restore persisted drawer / layout state
    yield* restoreLayoutState(
      wsId,
      restoredAgents,
      diskAgents,
      hasOpenedStreamingAgent,
      effectiveInitialAgentId,
    );
    // 10. Deferred cleanup of sessionStorage
    const isNewlyCreated = restoredAgents.length === 0;
    if (!isNewlyCreated) {
      yield* cleanupSessionStorageKeys(wsId);
    }
  } catch {
    // Even on error, publish empty agents before marking the list loaded.
    yield* put(removeWorkspaceSessions(wsId));
    yield* put(setAgents(wsId, []));
    yield* put(setAgentsLoaded(wsId, true));
  } finally {
    yield* put(setIsLoadingAgents(wsId, false));
  }
}
// ---------------------------------------------------------------------------
// Sub-routines
// ---------------------------------------------------------------------------
/** @internal Exported for testing only. */
export function* restoreInitialAgent(
  wsId: string,
  initialAgentId: string | null,
  diskAgents: StoredAgent[],
  existingAgentIds: Set<string>,
) {
  if (!initialAgentId) return;
  let indexedExistingSession: AgentSession | undefined;
  if (existingAgentIds.has(AgentId(initialAgentId))) {
    indexedExistingSession = yield* selectAgentSession.effect(initialAgentId);
    if (hasUsableInitialAgentSession(indexedExistingSession)) {
      yield* put(markAgentRecentlyCreated(wsId, initialAgentId));
      return;
    }
  }
  const initialAgentOnDisk = diskAgents.find((a) => a.id === AgentId(initialAgentId));
  if (initialAgentOnDisk) {
    // Use workspace-scoped Redux selector for race-safe lookup
    const existingSession: AgentSession | undefined = indexedExistingSession ??
      (yield* selectAgentSession.effect(initialAgentId));
    const isAlreadyUsable = hasUsableInitialAgentSession(existingSession);
    if (!isAlreadyUsable) {
      // Check if this is a pending agent from workspace creation that needs
      // its initial message sent. The backend creates these with status Pending
      // and stores initialMessage in metadata — resumeSession would just load
      // the metadata without actually starting the agent.
      const diskMeta = (initialAgentOnDisk as any).metadata;
      const diskMessages = (initialAgentOnDisk as any).messages;
      const hasExistingMessages = Array.isArray(diskMessages) && diskMessages.length > 0;
      const diskBackendSessionId = getStoredAgentBackendSessionId(initialAgentOnDisk);
      const isPendingWithMessage =
        storedAgentHasInitialPrompt(initialAgentOnDisk) &&
        !hasExistingMessages &&
        (String((initialAgentOnDisk as any).status).toLowerCase() === 'pending' ||
          !diskBackendSessionId ||
          !hasUsableInitialAgentSession(existingSession));
      try {
        let restored: AgentSession | null | undefined;
        if (isPendingWithMessage) {
          // Dispatch the saga-owned activation request so backend creation and
          // first-message sending happen through the Redux creation flow.
          const reduxConfig: InitialAgentConfig | null = yield* selectInitialAgentConfig.effect(wsId);
          const agentConfigData = sessionStorage.getItem(`workspace:${wsId}:agent-config`);
          const config =
            reduxConfig?.config ?? (agentConfigData ? JSON.parse(agentConfigData) : diskMeta);
          yield* put(
            activateInitialAgentRequested(
              wsId,
              initialAgentId,
              buildInitialActivationConfig(
                wsId,
                initialAgentId,
                config,
                diskMeta,
                initialAgentOnDisk,
              ),
            ),
          );
          restored = yield* waitForAgentSession(
            initialAgentId,
            INITIAL_AGENT_ACTIVATION_TIMEOUT_MS,
            hasUsableInitialAgentSession,
          );
        } else if (!existingSession) {
          // Agent has messages or an active backend session — restore it via
          // the saga-owned disk-load action and observe Redux for the result.
          yield* put(ensureAgentSessionLoaded(wsId, initialAgentId));
          restored = yield* waitForAgentSession(initialAgentId);
        } else {
          restored = existingSession;
        }
        if (restored) {
          yield* put(markAgentRecentlyCreated(wsId, initialAgentId));
        }
      } catch {}
    } else {
      yield* put(markAgentRecentlyCreated(wsId, initialAgentId));
    }
  } else {
    const reduxConfig: InitialAgentConfig | null = yield* selectInitialAgentConfig.effect(wsId);
    const agentConfigData = sessionStorage.getItem(`workspace:${wsId}:agent-config`);
    const config = reduxConfig?.config ?? (agentConfigData ? JSON.parse(agentConfigData) : {});
    try {
      yield* put(
        activateInitialAgentRequested(
          wsId,
          initialAgentId,
          buildInitialActivationConfig(wsId, initialAgentId, config),
        ),
      );
      const newSession: AgentSession | null = yield* waitForAgentSession(
        initialAgentId,
        INITIAL_AGENT_ACTIVATION_TIMEOUT_MS,
        hasUsableInitialAgentSession,
      );
      if (newSession) {
        yield* put(markAgentRecentlyCreated(wsId, initialAgentId));
      }
    } catch {}
  }
}
function* restoreRemainingAgents(
  wsId: string,
  diskAgents: StoredAgent[],
  existingAgentIds: Set<string>,
  initialAgentId: string | null,
) {
  const agentsToRestore = diskAgents.filter(
    (agent) =>
      !existingAgentIds.has(agent.id as any) && (!initialAgentId || agent.id !== initialAgentId),
  );
  if (agentsToRestore.length === 0) return;
  for (const agent of agentsToRestore) {
    yield* put(ensureAgentSessionLoaded(wsId, agent.id));
  }
  for (const agent of agentsToRestore) {
    yield* waitForAgentSession(agent.id);
  }
}
function* reconcileStaleAgentTabs(wsId: string, restoredAgents: AgentSession[]) {
  if (restoredAgents.length === 0) return;
  const validAgentIds = restoredAgents.map((a: AgentSession) => String(a.id));
  const sortedForReconcile = [...restoredAgents].sort((a, b) => {
    const aTime = new Date(a.createdAt || 0).getTime();
    const bTime = new Date(b.createdAt || 0).getTime();
    return bTime - aTime;
  });
  const replacement = sortedForReconcile[0];
  if (replacement) {
    yield* put(
      reconcileStaleAgentTabsAction(
        wsId,
        validAgentIds,
        String(replacement.id),
        replacement.name || 'Agent',
      ),
    );
  }
}
/** @internal Exported for testing only. */
export function* restoreLayoutState(
  wsId: string,
  restoredAgents: AgentSession[],
  diskAgents: StoredAgent[],
  hasOpenedStreamingAgent: boolean,
  initialAgentId: string | null,
) {
  const allTabsAtStart = yield* getAllTabsForWorkspace(wsId);
  if (allTabsAtStart.length > 0) return;
  const hasInitialAgentOpen = !!initialAgentId;
  if (hasInitialAgentOpen && initialAgentId) {
    // Open the initial agent tab directly — the workspace:show-agent event
    // from the page $effect may fire before this saga's event listener is ready
    const agent = restoredAgents.find((a: AgentSession) => String(a.id) === initialAgentId);
    yield* openAgentInLayout(initialAgentId, agent?.name || 'Agent', wsId);
  }
  if (!hasOpenedStreamingAgent && !hasInitialAgentOpen) {
    const persistedState = workspaceStorageManager.loadState(wsId);
    if (persistedState?.drawer?.open && persistedState?.drawer?.itemId) {
      const persistedAgentExists =
        persistedState.drawer.type !== 'agent' ||
        restoredAgents.some(
          (a: AgentSession) => String(a.id) === String(persistedState.drawer?.itemId),
        );
      if (persistedAgentExists && persistedState.drawer.type === 'agent') {
        const agent = restoredAgents.find(
          (a: AgentSession) => a.id === persistedState.drawer?.itemId,
        );
        yield* openAgentInLayout(persistedState.drawer.itemId, agent?.name || 'Agent', wsId, {
          focusIfExists: false,
        });
      }
    } else if (restoredAgents.length > 0) {
      const tabsAfterMutations = yield* getAllTabsForWorkspace(wsId);
      const hasAgentTabs = tabsAfterMutations.some((t) => t.type === 'agent');
      if (!hasAgentTabs) {
        const sortedAgents = [...restoredAgents].sort((a, b) => {
          const aTime = new Date(a.createdAt || 0).getTime();
          const bTime = new Date(b.createdAt || 0).getTime();
          return bTime - aTime;
        });
        const mostRecentAgent = sortedAgents[0];
        if (mostRecentAgent) {
          yield* openAgentInLayout(mostRecentAgent.id, mostRecentAgent.name || 'Agent', wsId);
          const restoreStatus = yield* selectRestoreStatus.effect(wsId);
          const shouldDefer = yield* shouldDeferSpecPanel(wsId);
          if (allTabsAtStart.length === 0 && !shouldDefer && restoreStatus !== 'restored') {
            yield* put(
              openTabInAdjacentOrSplit(wsId, {
                type: 'note',
                title: 'Spec',
                noteId: SPEC_NOTE_ID,
                closable: true,
              }),
            );
          }
        }
      }
    }
  }
  // Ensure panels have content – fallback to agent | spec layout
  yield* ensureFallbackLayout(wsId, restoredAgents, diskAgents);
}
/** @internal Exported for testing only. */
export function* ensureFallbackLayout(
  wsId: string,
  restoredAgents: AgentSession[],
  diskAgents: StoredAgent[],
) {
  const allTabs = yield* getAllTabsForWorkspace(wsId);
  if (allTabs.length > 0) return;
  const agentsToUse =
    restoredAgents.length > 0
      ? restoredAgents
      : diskAgents.map((a) => ({
          ...a,
          createdAt: a.createdAt || new Date(0),
        }));
  if (agentsToUse.length > 0) {
    const sorted = [...agentsToUse].sort((a, b) => {
      const aTime = new Date(a.createdAt || 0).getTime();
      const bTime = new Date(b.createdAt || 0).getTime();
      return bTime - aTime;
    });
    const mostRecent = sorted[0];
    if (mostRecent) {
      yield* openAgentInLayout(mostRecent.id, (mostRecent as any).name || 'Agent', wsId);
    }
  }
  const restoreStatus = yield* selectRestoreStatus.effect(wsId);
  const shouldDefer = yield* shouldDeferSpecPanel(wsId);
  if (!shouldDefer && restoreStatus !== 'restored') {
    yield* put(
      openTabInAdjacentOrSplit(wsId, {
        type: 'note',
        title: 'Spec',
        noteId: SPEC_NOTE_ID,
        closable: true,
      }),
    );
  }
}
function* cleanupSessionStorageKeys(wsId: string) {
  yield* put(clearInitialAgentConfig(wsId));
  const agentConfigKey = `workspace:${wsId}:agent-config`;
  const pendingAgentKey = `workspace:${wsId}:initial-agent-pending`;
  if (sessionStorage.getItem(agentConfigKey)) {
    sessionStorage.removeItem(agentConfigKey);
  }
  if (sessionStorage.getItem(pendingAgentKey)) {
    sessionStorage.removeItem(pendingAgentKey);
  }
}
