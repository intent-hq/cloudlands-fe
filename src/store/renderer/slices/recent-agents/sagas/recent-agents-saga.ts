/**
 * Recent Agents Saga
 *
 * Mirrors main's app-wide recent list into the slice (first read plus every
 * `recent-agents:changed` push), reports each agent, browser tab and terminal
 * tab the user brings up in this window, forgets workspaces this window's
 * machine reports deleted or archived, and opens a switcher entry through the
 * existing routes: a notification-style navigation on this window's machine,
 * `connections:open` on another one.
 */

import {
  takeEveryFromSelector,
  takeLatestFromSelector,
  type SelectorChannelPayload,
} from '@themislib/themis/saga';
import { buffers, eventChannel, type EventChannel } from 'redux-saga';
import { all, call, fork, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { handleNotificationNavigate } from '$features/notifications/notification-navigation';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  RECENT_AGENTS_CHANGED_EVENT,
  recentEntryKey,
  type RecentEntry,
} from '$shared/recent-agents';
import { routedWorkspaceId } from '../../../utils/routed-workspace-id';
import {
  selectActiveTab,
  selectAllTabs,
  selectHiddenTabs,
  selectRestoreStatus,
} from '../../panel-layout/panel-layout-selectors';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';
import { selectCurrentConnectionId } from '../../connections/connections-selectors';
import { openConnectionRequested } from '../../connections/connections-slice';
import { markAgentAsViewed } from '../../unread-tracking/unread-tracking-slice';
import { selectCurrentlyViewedAgentId } from '../../unread-tracking/unread-tracking-selectors';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { workspaceDeleted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { selectRecentAgentsBinding, selectShownPanelTabKey } from '../recent-agents-selectors';
import {
  recentAgentOpenRequested,
  recentAgentsReceived,
  recentAgentsWorkspaceArchived,
} from '../recent-agents-slice';

const logger = createLogger('RecentAgentsSaga');
const RECENT_AGENTS = IPC_CHANNELS.RECENT_AGENTS;

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type Visit = DistributiveOmit<RecentEntry, 'visitedAt'> & { viewed?: boolean };

function getApi(): Window['electronAPI'] | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined;
}

/** One function per request, each naming its channel, so the wire surface stays auditable. */
const requests = {
  list: async (): Promise<RecentEntry[] | null> => {
    const api = getApi();
    if (!api) return null;
    return (await api.invoke(RECENT_AGENTS.LIST, {})) as RecentEntry[];
  },
  record: async (visit: Visit): Promise<void> => {
    await getApi()?.invoke(RECENT_AGENTS.RECORD, visit);
  },
  setPageChord: async (binding: string): Promise<void> => {
    await getApi()?.invoke(RECENT_AGENTS.SET_PAGE_CHORD, { binding });
  },
  forgetWorkspace: async (connectionId: string, workspaceId: string): Promise<void> => {
    await getApi()?.invoke(RECENT_AGENTS.FORGET_WORKSPACE, { connectionId, workspaceId });
  },
  forgetEntry: async (key: string): Promise<void> => {
    await getApi()?.invoke(RECENT_AGENTS.FORGET_ENTRY, { key });
  },
};

function createChangedChannel(): EventChannel<RecentEntry[]> {
  return eventChannel<RecentEntry[]>((emit) => {
    const api = getApi();
    if (!api?.on) return () => {};
    const listenerId = api.on(RECENT_AGENTS_CHANGED_EVENT, (entries: RecentEntry[]) =>
      emit(entries),
    );
    return () => api.offById(RECENT_AGENTS_CHANGED_EVENT, listenerId);
  }, buffers.sliding<RecentEntry[]>(1));
}

function createFocusChannel(): EventChannel<true> {
  return eventChannel<true>((emit) => {
    if (typeof window === 'undefined') return () => {};
    const onFocus = () => emit(true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, buffers.sliding<true>(1));
}

function* watchChanges(): SagaGenerator<void> {
  const channel = yield* call(createChangedChannel);
  try {
    const entries = yield* call(requests.list);
    if (entries) yield* put(recentAgentsReceived(entries));
  } catch (error) {
    logger.warn('Could not read recent agents', error);
  }
  try {
    while (true) yield* put(recentAgentsReceived(yield* take(channel)));
  } finally {
    channel.close();
  }
}

/** Report `agentId` as opened in this window, when the window knows the agent. */
function* recordVisit(agentId: string, viewed = false): SagaGenerator<void> {
  const session = yield* selectAgentSession.effect(agentId);
  if (!session?.workspaceId) return;
  const connectionId = yield* selectCurrentConnectionId.effect();
  if (!connectionId) return;
  const workspace = yield* selectWorkspaceById.effect(session.workspaceId);
  yield* call(reportVisit, {
    kind: 'agent' as const,
    connectionId,
    workspaceId: session.workspaceId,
    workspaceTitle: workspace?.title || null,
    agentId,
    agentName: session.name ?? '',
    ...(viewed ? { viewed } : {}),
  });
}

function* reportVisit(visit: Visit): SagaGenerator<void> {
  try {
    yield* call(requests.record, visit);
  } catch (error) {
    logger.warn('Could not record a recent agent', error);
  }
}

/** A chat became the one on screen. Main skips background windows restoring a layout. */
function* handleViewed(action: ReturnType<typeof markAgentAsViewed>): SagaGenerator<void> {
  const [agentId] = action.payload;
  if (agentId) yield* call(recordVisit, agentId, true);
}

/**
 * Report the focused tab of the workspace this window displays: a browser or terminal tab, or
 * a chat (whose view event does not fire again when focus only moves between panels). Returns
 * whether it reported one.
 */
function* recordFocusedTab(viewed: boolean): SagaGenerator<boolean> {
  const workspaceId = routedWorkspaceId();
  if (!workspaceId) return false;
  const tab = yield* selectActiveTab.effect(workspaceId);
  if (tab?.type === 'agent' && tab.agentId) {
    yield* call(recordVisit, tab.agentId, viewed);
    return true;
  }
  if (tab?.type !== 'browser' && tab?.type !== 'terminal') return false;
  const connectionId = yield* selectCurrentConnectionId.effect();
  if (!connectionId) return false;
  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  const url = tab.type === 'browser' ? (tab.browserRequestedUrl ?? tab.browserUrl) : undefined;
  yield* call(reportVisit, {
    kind: tab.type,
    connectionId,
    workspaceId,
    workspaceTitle: workspace?.title || null,
    tabId: tab.id,
    title: tab.title,
    ...(url ? { url } : {}),
    ...(tab.type === 'browser' && tab.faviconUrl ? { faviconUrl: tab.faviconUrl } : {}),
    ...(viewed ? { viewed } : {}),
  });
  return true;
}

/** Focus moved to another panel, tab or workspace in this window. */
function* handleShownTab({
  payload,
  prevPayload,
}: SelectorChannelPayload<string | null>): SagaGenerator<void> {
  if (payload && payload !== prevPayload) yield* call(recordFocusedTab, true);
}

/** Coming back to a window makes the agent or tab it shows the most recent one. */
function* watchFocus(): SagaGenerator<void> {
  const channel = yield* call(createFocusChannel);
  try {
    while (true) {
      yield* take(channel);
      if (yield* call(recordFocusedTab, false)) continue;
      const agentId = yield* selectCurrentlyViewedAgentId.effect();
      if (agentId) yield* call(recordVisit, agentId);
    }
  } finally {
    channel.close();
  }
}

function* forgetWorkspace(workspaceId: string): SagaGenerator<void> {
  const connectionId = yield* selectCurrentConnectionId.effect();
  if (!connectionId) return;
  try {
    yield* call(requests.forgetWorkspace, connectionId, workspaceId);
  } catch (error) {
    logger.warn('Could not forget a workspace in recent agents', error);
  }
}

function* handleWorkspaceDeleted(action: ReturnType<typeof workspaceDeleted>): SagaGenerator<void> {
  const [workspaceId, , cause] = action.payload;
  if (cause === 'deleted') yield* call(forgetWorkspace, workspaceId);
}

function* handleWorkspaceArchived(
  action: ReturnType<typeof recentAgentsWorkspaceArchived>,
): SagaGenerator<void> {
  yield* call(forgetWorkspace, action.payload[0]);
}

/** Whether the restored layout of `workspaceId` no longer holds `tabId`. */
function* isTabGone(workspaceId: string, tabId: string): SagaGenerator<boolean> {
  if ((yield* selectRestoreStatus.effect(workspaceId)) !== 'restored') return false;
  const tabs = [
    ...(yield* selectAllTabs.effect(workspaceId)),
    ...(yield* selectHiddenTabs.effect(workspaceId)),
  ];
  return !tabs.some((tab) => tab.id === tabId);
}

function* openLocalTab(entry: Extract<RecentEntry, { tabId: string }>): SagaGenerator<void> {
  yield* call(handleNotificationNavigate, { workspaceId: entry.workspaceId, tabId: entry.tabId });
  if (yield* call(isTabGone, entry.workspaceId, entry.tabId)) {
    try {
      yield* call(requests.forgetEntry, recentEntryKey(entry));
    } catch (error) {
      logger.warn('Could not forget a closed tab in recent agents', error);
    }
    return;
  }
  // The tab may already be the focused one, which brings no focus change: record it here.
  yield* call(recordFocusedTab, false);
}

function* handleOpen(action: ReturnType<typeof recentAgentOpenRequested>): SagaGenerator<void> {
  const [entry] = action.payload;
  const connectionId = yield* selectCurrentConnectionId.effect();
  const target =
    entry.kind === 'agent'
      ? { workspaceId: entry.workspaceId, agentId: entry.agentId }
      : { workspaceId: entry.workspaceId, tabId: entry.tabId };
  if (entry.connectionId === connectionId && entry.kind !== 'agent') {
    yield* call(openLocalTab, entry);
    return;
  }
  if (entry.connectionId === connectionId) {
    // The opened chat may already be the active tab of its workspace, which
    // views it again without a new view event: record the visit here.
    const { visitedAt: _visitedAt, ...visit } = entry;
    yield* call(reportVisit, visit);
    yield* call(handleNotificationNavigate, target);
    return;
  }
  // Main connects when needed, brings up (or opens) the machine's window and
  // queues the agent for it, as Settings → Devices and notification clicks do.
  yield* put(openConnectionRequested(entry.connectionId, target));
}

/** Main forwards this chord from browser-panel pages, so it follows the user's binding. */
function* reportPageChord({
  payload: binding,
}: SelectorChannelPayload<string>): SagaGenerator<void> {
  try {
    yield* call(requests.setPageChord, binding);
  } catch (error) {
    logger.warn('Could not report the switcher chord', error);
  }
}

export function* recentAgentsSaga(): SagaGenerator<void> {
  yield* fork(watchChanges);
  yield* takeLatestFromSelector(selectRecentAgentsBinding, reportPageChord);
  yield* fork(watchFocus);
  yield* takeEveryFromSelector(selectShownPanelTabKey, handleShownTab);
  yield* all([
    takeEvery(markAgentAsViewed, handleViewed),
    takeEvery(workspaceDeleted, handleWorkspaceDeleted),
    takeEvery(recentAgentsWorkspaceArchived, handleWorkspaceArchived),
    takeEvery(recentAgentOpenRequested, handleOpen),
  ]);
}
