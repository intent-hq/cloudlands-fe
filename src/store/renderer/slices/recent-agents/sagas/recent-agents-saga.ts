/**
 * Recent Agents Saga
 *
 * Mirrors main's app-wide recent-agent list into the slice (first read plus
 * every `recent-agents:changed` push), reports each agent the user opens in
 * this window, forgets workspaces this window's machine reports deleted or
 * archived, and opens a switcher entry through the existing routes: a
 * notification-style navigation on this window's machine, `connections:open`
 * on another one.
 */

import { takeLatestFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import { buffers, eventChannel, type EventChannel } from 'redux-saga';
import { all, call, fork, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { handleNotificationNavigate } from '$features/notifications/notification-navigation';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { RECENT_AGENTS_CHANGED_EVENT, type RecentAgentEntry } from '$shared/recent-agents';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';
import { selectCurrentConnectionId } from '../../connections/connections-selectors';
import { openConnectionRequested } from '../../connections/connections-slice';
import { markAgentAsViewed } from '../../unread-tracking/unread-tracking-slice';
import { selectCurrentlyViewedAgentId } from '../../unread-tracking/unread-tracking-selectors';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { workspaceDeleted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { selectRecentAgentsBinding } from '../recent-agents-selectors';
import {
  recentAgentOpenRequested,
  recentAgentsReceived,
  recentAgentsWorkspaceArchived,
} from '../recent-agents-slice';

const logger = createLogger('RecentAgentsSaga');
const RECENT_AGENTS = IPC_CHANNELS.RECENT_AGENTS;

type Visit = Omit<RecentAgentEntry, 'visitedAt'> & { viewed?: boolean };

function getApi(): Window['electronAPI'] | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined;
}

/** One function per request, each naming its channel, so the wire surface stays auditable. */
const requests = {
  list: async (): Promise<RecentAgentEntry[] | null> => {
    const api = getApi();
    if (!api) return null;
    return (await api.invoke(RECENT_AGENTS.LIST, {})) as RecentAgentEntry[];
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
};

function createChangedChannel(): EventChannel<RecentAgentEntry[]> {
  return eventChannel<RecentAgentEntry[]>((emit) => {
    const api = getApi();
    if (!api?.on) return () => {};
    const listenerId = api.on(RECENT_AGENTS_CHANGED_EVENT, (entries: RecentAgentEntry[]) =>
      emit(entries),
    );
    return () => api.offById(RECENT_AGENTS_CHANGED_EVENT, listenerId);
  }, buffers.sliding<RecentAgentEntry[]>(1));
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

/** Coming back to a window makes the agent it shows the most recent one. */
function* watchFocus(): SagaGenerator<void> {
  const channel = yield* call(createFocusChannel);
  try {
    while (true) {
      yield* take(channel);
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

function* handleOpen(action: ReturnType<typeof recentAgentOpenRequested>): SagaGenerator<void> {
  const [entry] = action.payload;
  const connectionId = yield* selectCurrentConnectionId.effect();
  const target = { workspaceId: entry.workspaceId, agentId: entry.agentId };
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
  yield* all([
    takeEvery(markAgentAsViewed, handleViewed),
    takeEvery(workspaceDeleted, handleWorkspaceDeleted),
    takeEvery(recentAgentsWorkspaceArchived, handleWorkspaceArchived),
    takeEvery(recentAgentOpenRequested, handleOpen),
  ]);
}
