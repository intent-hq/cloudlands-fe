import type {
  AgentDeletedPayload,
  AgentRenamedPayload,
  AgentRestoredPayload,
  WorkspaceEvent,
} from "$features/events/types";
import type { AgentSession } from "$shared/types";
import { initWorkspace } from "$lib/store/slices/changes/changes-slice";
import { loadGitStatus } from "$lib/store/slices/git/git-slice";
import { clearWorkspaceUnread } from "../../unread-tracking/unread-tracking-slice";
import { clearCurrentlyViewed } from "$lib/store/slices/note-read-tracking/note-read-tracking-slice";
import {
  takeEveryFromElectronChannel,
  takeEveryFromWindowEvent,
} from "$lib/store/utils/ipc-channel";
import {
  type Task,
} from "redux-saga";
import {
  all,
  call,
  cancel,
  delay,
  fork,
  put,
  race,
  take,
  takeEvery,
} from "typed-redux-saga";
import { createChannelFromSelector } from "svelte-redux-toolkit/saga";
import {
  workspaceMounted,
  workspaceUnmounted,
} from "../../workspace-lifecycle/workspace-lifecycle-slice";
import {
  selectAllWorkspaceAgents,
  selectAgentsLoaded,
  selectInitialAgentConfig,
  selectInitialAgentId,
  selectIsLoadingAgents,
  selectRecentlyCreatedAgents,
} from "../workspace-agents-selectors";
import { selectActiveWorkspaceId } from "../../workspace/workspace-selectors";
import {
  addAgent,
  removeAgent,
  setAgentsLoaded,
  setInitialAgentConfig,
  setInitialAgentId,
  setInitialSpecWriteInProgress,
  setIsLoadingAgents,
  setWaitingForFirstMessage,
} from "../workspace-agents-slice";
import {
  removeSession as removeAgentSession,
  renameAgent,
  renameSession as renameAgentSession,
  setAgentStreaming,
  upsertSession,
} from "../../agent-session/agent-session-slice";
import { selectWorkspaceNavigationDrawer } from "../../workspace-navigation/workspace-navigation-selectors";
import { closeWorkspaceDrawer } from "../../workspace-navigation/workspace-navigation-slice";
import {
  selectLoadedWorkspaceTerminals,
  selectRecentlyCreatedTerminals,
  selectTerminalsLoaded,
} from "../../terminals/terminals-selectors";
import { loadAgentsFromDiskSaga } from "./agent-loading-saga";
import { watchAgentCreationSaga } from "./agent-creation-saga";
import { watchEnsureAgentSessionLoadedSaga } from "./ensure-agent-session-saga";
import { selectAgentSession } from '../../agent-session/agent-session-selectors';


type MaybeWrappedPayload<T> = T | { payload: T };
type AgentDeletedEventPayload = MaybeWrappedPayload<AgentDeletedPayload | WorkspaceEvent>;

const workspaceAgentTasks = new Map<string, Task[]>();

function unwrapPayload<T>(event: MaybeWrappedPayload<T>): T {
  if (event && typeof event === "object" && "payload" in event) {
    return event.payload;
  }

  return event;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeAgentDeletedPayload(
  event: AgentDeletedEventPayload,
): Partial<AgentDeletedPayload> {
  const data = unwrapPayload(event) as unknown;

  if (isRecord(data) && isRecord(data.data) && typeof data.workspaceId === "string") {
    return { ...data.data, workspaceId: data.workspaceId };
  }

  return isRecord(data) ? data : {};
}

function isOptimisticWorkspaceId(wsId: string): boolean {
  return wsId.startsWith("optimistic-");
}

function isValidFileTrackingWorkspaceId(wsId: string): boolean {
  return !!wsId && wsId !== "new" && !isOptimisticWorkspaceId(wsId) && wsId !== "undefined";
}

function* clearUnreadForMountedWorkspace(wsId: string) {
  if (!wsId || wsId === "new" || isOptimisticWorkspaceId(wsId)) {
    return;
  }

  yield* put(clearWorkspaceUnread(wsId));
}

export function* initializeFileTrackingForWorkspaceSaga(wsId: string) {
  if (!isValidFileTrackingWorkspaceId(wsId)) {
    return;
  }

  yield* put(initWorkspace(wsId));
  yield* delay(50);

  // Load initial git status via Redux. Ongoing git updates are owned by gitStatusSaga.
  yield* put(loadGitStatus(wsId));
}

export function* watchAgentDeletedSaga() {
  yield* takeEveryFromElectronChannel<AgentDeletedEventPayload>(
    "agent:deleted",
    function* (event) {
      const data = normalizeAgentDeletedPayload(event);

      if (typeof data.agentId !== "string" || typeof data.workspaceId !== "string") {
        return;
      }

      yield* put(removeAgentSession(data.agentId));
      yield* put(removeAgent(data.workspaceId, data.agentId));
    },
  );
}

export function* watchAgentRestoredSaga() {
  yield* takeEveryFromElectronChannel<MaybeWrappedPayload<AgentRestoredPayload>>(
    "agent:restored",
    function* (event) {
      const data = unwrapPayload(event);

      if (typeof data.agentId !== "string" || typeof data.workspaceId !== "string") {
        return;
      }

      const session = data.session as AgentSession | null | undefined;
      if (!session || typeof session !== "object" || !("id" in session)) {
        return;
      }

      // Dual-dispatch mirrors watchAgentDeletedSaga: re-populate the full
      // session first, then re-index it in the workspace agent list.
      yield* put(upsertSession({
        ...session,
        workspaceId: data.workspaceId as AgentSession['workspaceId'],
      }));
      yield* put(addAgent(data.workspaceId, session));
    },
  );
}

export function* watchAgentRenamedSaga() {
  yield* takeEveryFromElectronChannel<MaybeWrappedPayload<AgentRenamedPayload>>(
    "agent:renamed",
    function* (event) {
      const data = unwrapPayload(event);

      if (
        typeof data.agentId !== "string" ||
        typeof data.workspaceId !== "string" ||
        typeof data.name !== "string"
      ) {
        return;
      }

      yield* put(renameAgentSession(data.agentId, data.name));
      yield* put(renameAgent(data.workspaceId, data.agentId, data.name));
    },
  );
}

export function* watchWaitingForFirstMessageSaga() {
  yield* takeEveryFromWindowEvent<{ agentId: string; workspaceId: string }>(
    "workspace:waiting-for-first-message",
    function* (data) {
      yield* put(setWaitingForFirstMessage(data.workspaceId, data.agentId, true));
    },
  );
}

function* checkDrawerGuard(wsId: string) {
  const drawerState = yield* selectWorkspaceNavigationDrawer.effect(wsId);
  if (!drawerState?.open || !drawerState.itemId) {
    return;
  }

  const drawerItemId = String(drawerState.itemId);

  if (drawerState.type === "agent") {
    const agentsLoaded = yield* selectAgentsLoaded.effect(wsId);
    if (!agentsLoaded) {
      return;
    }

    const initialAgentId = yield* selectInitialAgentId.effect(wsId);
    const agents = yield* selectAllWorkspaceAgents.effect(wsId);

    if (initialAgentId && drawerItemId === initialAgentId) {
      const pendingInitialAgent = agents.find((agent) => String(agent.id) === initialAgentId);
      if (!pendingInitialAgent) {
        return;
      }
    }

    const recentlyCreatedAgents = yield* selectRecentlyCreatedAgents.effect(wsId);
    if (recentlyCreatedAgents.includes(drawerItemId)) {
      return;
    }

    const agent = agents.find((candidate) => String(candidate.id) === drawerItemId);

    if (!agent || String(agent.workspaceId) !== String(wsId)) {
      yield* put(closeWorkspaceDrawer(wsId));
    }

    return;
  }

  if (drawerState.type !== "terminal") {
    return;
  }

  const terminalsLoaded = yield* selectTerminalsLoaded.effect(wsId);
  if (!terminalsLoaded) {
    return;
  }

  const recentlyCreatedTerminals = yield* selectRecentlyCreatedTerminals.effect(wsId);
  if (recentlyCreatedTerminals.includes(drawerItemId)) {
    return;
  }

  const terminals = yield* selectLoadedWorkspaceTerminals.effect(wsId);
  if (!terminals.find((terminal) => terminal.id === drawerItemId)) {
    yield* put(closeWorkspaceDrawer(wsId));
  }
}

function* watchDrawerGuardSaga(wsId: string) {
  const agentsChannel = yield* createChannelFromSelector(selectAllWorkspaceAgents, wsId);
  const agentsLoadedChannel = yield* createChannelFromSelector(selectAgentsLoaded, wsId);
  const initialAgentIdChannel = yield* createChannelFromSelector(selectInitialAgentId, wsId);
  const recentlyCreatedAgentsChannel = yield* createChannelFromSelector(selectRecentlyCreatedAgents, wsId);
  const terminalsChannel = yield* createChannelFromSelector(selectLoadedWorkspaceTerminals, wsId);
  const terminalsLoadedChannel = yield* createChannelFromSelector(selectTerminalsLoaded, wsId);
  const recentlyCreatedTerminalsChannel = yield* createChannelFromSelector(selectRecentlyCreatedTerminals, wsId);

  try {
    yield* call(checkDrawerGuard, wsId);

    while (true) {
      yield* race({
        agents: take(agentsChannel),
        agentsLoaded: take(agentsLoadedChannel),
        initialAgentId: take(initialAgentIdChannel),
        recentlyCreatedAgents: take(recentlyCreatedAgentsChannel),
        terminals: take(terminalsChannel),
        terminalsLoaded: take(terminalsLoadedChannel),
        recentlyCreatedTerminals: take(recentlyCreatedTerminalsChannel),
      });
      yield* call(checkDrawerGuard, wsId);
    }
  } finally {
    agentsChannel.close();
    agentsLoadedChannel.close();
    initialAgentIdChannel.close();
    recentlyCreatedAgentsChannel.close();
    terminalsChannel.close();
    terminalsLoadedChannel.close();
    recentlyCreatedTerminalsChannel.close();
  }
}

/** @internal Exported for testing only. */
export function* recoverLateInitialAgentHydrationSaga(wsId: string) {
  const initialAgentConfig = yield* selectInitialAgentConfig.effect(wsId);
  const initialAgentId = yield* selectInitialAgentId.effect(wsId);
  const wasLoadingAgents = yield* selectIsLoadingAgents.effect(wsId);
  const wasAgentsLoaded = yield* selectAgentsLoaded.effect(wsId);

  if (!initialAgentId && initialAgentConfig?.agentId) {
    yield* put(setInitialAgentId(wsId, initialAgentConfig.agentId));
    return;
  }

  if (!initialAgentId || (!wasLoadingAgents && !wasAgentsLoaded)) {
    return;
  }

  if (wasLoadingAgents) {
    while (yield* selectIsLoadingAgents.effect(wsId)) {
      const action = (yield* take(setIsLoadingAgents.type)) as ReturnType<typeof setIsLoadingAgents>;
      const [actionWsId, loading] = action.payload;

      if (actionWsId === wsId && !loading) {
        break;
      }
    }
  }

  const settledInitialAgentId = wasLoadingAgents
    ? yield* selectInitialAgentId.effect(wsId)
    : initialAgentId;
  const settledAgentsLoaded = wasLoadingAgents
    ? yield* selectAgentsLoaded.effect(wsId)
    : wasAgentsLoaded;
  const settledAgents = yield* selectAllWorkspaceAgents.effect(wsId);

  if (!settledInitialAgentId || !settledAgentsLoaded || settledAgents.length > 0) {
    return;
  }

  yield* put(setAgentsLoaded(wsId, false));
  yield* call(loadAgentsFromDiskSaga, wsId);
}

/** @internal Exported for testing only. */
export function* watchLateInitialAgentHydrationRecoverySaga() {
  const recoveryTasks = new Map<string, Task>();

  try {
    while (true) {
      const action = (yield* take([
        setInitialAgentId.type,
        setInitialAgentConfig.type,
      ])) as ReturnType<typeof setInitialAgentId> | ReturnType<typeof setInitialAgentConfig>;
      const [actionWsId] = action.payload;

      const existing = recoveryTasks.get(actionWsId);
      if (existing) {
        yield* cancel(existing);
      }

      const task = yield* fork(recoverLateInitialAgentHydrationSaga, actionWsId);
      recoveryTasks.set(actionWsId, task);
    }
  } finally {
    for (const task of recoveryTasks.values()) {
      yield* cancel(task);
    }
    recoveryTasks.clear();
  }
}

export function* watchWorkspaceAgentEventsForWorkspaceSaga(
  action: ReturnType<typeof workspaceMounted>
) {
  const [wsId] = action.payload;

  // Deduplicate: if a watcher is already running for this workspace
  // (e.g. from the retroactive mount check), skip this duplicate mount.
  if (workspaceAgentTasks.has(wsId)) {
    return;
  }

  // Immediately register a sentinel so the retroactive-mount guard sees this
  // workspace as "already being watched" and won't fork a duplicate watcher.
  workspaceAgentTasks.set(wsId, []);
  yield* clearUnreadForMountedWorkspace(wsId);

  // One-shot mount initialization only; ongoing git/file listeners are owned by
  // their domain sagas, so this task is intentionally not tracked for unmount
  // cancellation.
  yield* fork(initializeFileTrackingForWorkspaceSaga, wsId);
  const drawerGuardTask = yield* fork(watchDrawerGuardSaga, wsId);

  // Load agents from disk on workspace mount
  yield* fork(loadAgentsFromDiskSaga, wsId);

  workspaceAgentTasks.set(wsId, [drawerGuardTask]);
}

/**
 * Cancels workspace-scoped tasks when a workspace unmounts.
 *
 * The tasks tracked in `workspaceAgentTasks` are workspace-level long-running
 * UI concerns tied to a workspace being mounted (currently the drawer guard).
 * They do not represent per-agent background work, so it is safe to cancel them
 * on unmount; their state is rebuilt on remount.
 *
 * Per-agent background work lives in `chat-state-saga`'s `activeSendTasks`
 * map, which has its own unmount handling that preserves watchdogs while
 * their agent is still streaming or processing.
 */
export function* cancelWorkspaceAgentEventsForWorkspaceSaga(
  action: ReturnType<typeof workspaceUnmounted>
) {
  const [wsId] = action.payload;
  const tasks = workspaceAgentTasks.get(wsId);

  yield* put(clearCurrentlyViewed());

  if (!tasks) {
    return;
  }

  for (const task of tasks) {
    yield* cancel(task);
  }

  workspaceAgentTasks.delete(wsId);
}

/**
 * Watch for streaming state changes and track whether the initial spec-writer
 * agent is actively writing the spec.
 */
function* watchSpecWriteTrackingSaga() {
  yield* takeEvery(setAgentStreaming, function* (action: ReturnType<typeof setAgentStreaming>) {
    const [agentId, isStreaming] = action.payload;
    const agent = yield* selectAgentSession.effect(agentId);
    if (!agent?.workspaceId) return;

    const isInitialAgent = agent.metadata?.isInitialAgent === true;
    const isSpecWriter = agent.metadata?.specialist === "spec-writer";

    if (isInitialAgent && isSpecWriter) {
      yield* put(setInitialSpecWriteInProgress(agent.workspaceId as string, isStreaming));
    }
  });
}

export function* workspaceAgentsSaga() {
  // Reset module-level state on (re)start to avoid stale data from previous runs
  workspaceAgentTasks.clear();

  yield* all([
    takeEvery(workspaceMounted, watchWorkspaceAgentEventsForWorkspaceSaga),
    takeEvery(workspaceUnmounted, cancelWorkspaceAgentEventsForWorkspaceSaga),
    fork(watchAgentCreationSaga),
    fork(retroactiveWorkspaceMountCheckSaga),
    fork(watchAgentDeletedSaga),
    fork(watchAgentRestoredSaga),
    fork(watchAgentRenamedSaga),
    fork(watchWaitingForFirstMessageSaga),
    fork(watchLateInitialAgentHydrationRecoverySaga),
    fork(watchSpecWriteTrackingSaga),
    fork(watchEnsureAgentSessionLoadedSaga),
  ]);
}

/**
 * Guard against early `workspaceMounted` dispatch.
 *
 * If the component dispatches `workspaceMounted` before the saga middleware
 * has registered its `takeEvery`, the action is silently dropped and agents
 * never load. This saga runs once at startup: after the `takeEvery` is
 * registered (because `all` waits for all forks to start), it checks whether
 * a workspace is already active in Redux state. If one exists, it manually
 * forks the workspace watcher with a synthetic action.
 *
 * Invalid workspace IDs (`""`, `"new"`, `"optimistic-..."`, `"undefined"`)
 * are skipped — the real `workspaceMounted` will arrive once the workspace
 * is fully resolved.
 *
 * The `workspaceAgentTasks` map prevents duplicate loads: if the action was
 * already processed normally, the map will have an entry for the workspace ID.
 * This also supports crash recovery: after a saga auto-restart the map is
 * cleared, so the retroactive check correctly replays the mount.
 */
/** @internal Exported for testing only. */
export function* retroactiveWorkspaceMountCheckSaga() {
  const activeWsId = yield* selectActiveWorkspaceId.effect();

  if (!activeWsId) {
    return;
  }

  // Skip invalid workspace IDs (empty, "new", "optimistic-*", "undefined") —
  // the real workspaceMounted will arrive once the workspace is fully resolved.
  if (!isValidFileTrackingWorkspaceId(activeWsId)) {
    return;
  }

  // If the normal takeEvery already processed the mount, tasks will exist.
  if (workspaceAgentTasks.has(activeWsId)) {
    return;
  }

  // The workspace was mounted before the saga started — replay.
  yield* fork(watchWorkspaceAgentEventsForWorkspaceSaga, workspaceMounted(activeWsId));
}
