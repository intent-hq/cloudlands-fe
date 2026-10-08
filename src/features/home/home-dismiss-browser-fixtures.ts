import { routeDaemonEventsNotification } from '$features/events/daemon-events-bridge.client';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  WorkspaceStatus,
  type Workspace,
  type AttentionReminderReason,
  type WorkspaceDisplayStatus,
} from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { store } from '$store/renderer/store';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import {
  replaceWorkspaceList,
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import { setRepos } from '$store/renderer/slices/known-repos/known-repos-slice';
import { resetHomeWorkspaceView } from './home-workspaces-slice';
import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
import { workspaceOperationsSaga } from '$store/renderer/slices/workspace-operations/sagas/workspace-operations-saga';

const observedReasons = [
  { id: 'workspace:review', revision: 'review-1' },
  { id: 'agent:question', revision: 'question-1' },
];
const timestamp = '2026-10-07T12:00:00Z';
const dismissalRows: readonly (readonly [string, string, WorkspaceDisplayStatus])[] = [
  ['dismiss-review', 'Review onboarding', 'needs_attention'],
  ['dismiss-ready', 'Ready to merge', 'pr_ready'],
  ['dismiss-blocked', 'Blocked work', 'blocked'],
  ['dismiss-failed', 'Failed work', 'failed'],
  ['dismiss-legacy', 'Older daemon reminder', 'needs_attention'],
];
const dismissalWorkspaces: Workspace[] = dismissalRows.map(([id, title, displayStatus]) => ({
  id: WorkspaceId(id),
  title,
  displayStatus,
  branch: 'feat/dismiss',
  status: WorkspaceStatus.Active,
  changesets: [],
  timeline: [],
  conversationInfo: [],
  createdAt: timestamp,
  updatedAt: timestamp,
  myRole: 'owner',
  activity: 'idle',
  attention: id === 'dismiss-ready' ? 'none' : 'review_required',
  ...(id === 'dismiss-legacy'
    ? {}
    : {
        attentionReminder: {
          reasons: id === 'dismiss-ready' ? [] : observedReasons.map((reason) => ({ ...reason })),
          dismissed: false,
          displayStatus,
        },
      }),
}));
interface DismissCall {
  channel: string;
  method: string;
  params: { workspaceId: string; reasons: AttentionReminderReason[] };
}
declare global {
  interface Window {
    __homeDismiss?: {
      calls: DismissCall[];
      responses: Workspace[];
      reads: string[];
      unchangedEvents: () => void;
      invalidate: () => void;
      holdNext: () => void;
      holdNextResponse: () => void;
      failNext: () => void;
      release: () => void;
      refresh: () => void;
      addReason: () => void;
      setStatus: (status: 'blocked' | 'failed' | 'in_progress') => void;
      setActivity: (activity: 'idle' | 'agent_running') => void;
    };
  }
}

export function setupHomeDismissFixtures(collaborator = false) {
  const previous = window.electronAPI;
  if (!previous) throw new Error('Home preview bridge is unavailable');
  admitLegacyPrincipal(collaborator ? 'guest' : 'owner');
  store.dispatch(resetHomeWorkspaceView());
  store.dispatch(
    replaceWorkspaceList(
      dismissalWorkspaces.map((workspace) => ({
        ...workspace,
        myRole: collaborator ? 'collaborator' : 'owner',
      })),
    ),
  );
  store.dispatch(setWorkspaceHasLoaded(true));
  store.dispatch(setRepos([]));
  const calls: DismissCall[] = [];
  const responses: Workspace[] = [];
  const reads: string[] = [];
  const saved = new Map<string, Workspace>();
  let hold = false,
    fail = false,
    holdResponse = false;
  let release = () => {};
  const get = (id = 'dismiss-review'): Workspace => {
    const workspace = selectWorkspaceById.select(store.state, id);
    if (!workspace) throw new Error(`Missing dismissal fixture workspace: ${id}`);
    return workspace;
  };
  const reminderOf = (workspace: Workspace) => {
    const reminder = workspace.attentionReminder;
    if (!reminder) throw new Error(`Missing reminder projection: ${workspace.id}`);
    return reminder;
  };
  const patch = (workspace: Workspace) => store.dispatch(setWorkspaceEntity(workspace));
  window.__homeDismiss = {
    calls,
    responses,
    reads,
    unchangedEvents: () => {
      routeDaemonEventsNotification('events.event', {
        type: 'workspace:displayStatus-changed',
        workspaceId: 'dismiss-review',
        data: { workspaceId: 'dismiss-review', displayStatus: 'needs_attention' },
      });
      routeDaemonEventsNotification('events.event', {
        type: 'workspace:attention-changed',
        workspaceId: 'dismiss-review',
        data: { workspaceId: 'dismiss-review', attention: 'review_required' },
      });
      routeDaemonEventsNotification('events.event', {
        type: 'workspace:updated',
        workspaceId: 'dismiss-review',
        data: { changes: { title: 'Review onboarding' } },
      });
    },
    invalidate: () =>
      routeDaemonEventsNotification('events.event', {
        type: 'workspace:updated',
        workspaceId: 'dismiss-review',
        data: { changes: { attentionReminder: true } },
      }),
    holdNext: () => {
      hold = true;
    },
    holdNextResponse: () => {
      holdResponse = true;
    },
    failNext: () => {
      fail = true;
    },
    release: () => release(),
    refresh: () => {
      const current = get();
      patch(saved.get(current.id) ?? { ...current });
    },
    addReason: () => {
      const current = get();
      const workspace: Workspace = {
        ...current,
        attentionReminder: {
          reasons: [
            ...reminderOf(current).reasons,
            { id: 'agent:another:question', revision: 'question-2' },
          ],
          dismissed: false,
          displayStatus: 'needs_attention',
        },
      };
      saved.set(workspace.id, workspace);
      patch(workspace);
    },
    setActivity: (activity) => {
      const current = get();
      const server = saved.get(current.id) ?? current;
      saved.set(current.id, { ...server, activity });
      routeDaemonEventsNotification('events.event', {
        type: 'workspace:activity-changed',
        workspaceId: current.id,
        data: { workspaceId: current.id, activity },
      });
    },
    setStatus: (status) => {
      const current = get();
      patch({
        ...current,
        displayStatus: status,
        activity: status === 'in_progress' ? 'agent_running' : 'idle',
        attentionReminder: { ...reminderOf(current), displayStatus: status },
      });
    },
  };
  window.electronAPI = {
    ...previous,
    invoke: async (channel, payload) => {
      const request = payload as { method?: string; params?: DismissCall['params'] };
      if (channel === IPC_CHANNELS.BACKEND.REQUEST && request?.method === 'workspace.get') {
        const params = request.params;
        if (!params) throw new Error('Missing workspace.get parameters');
        reads.push(params.workspaceId);
        return {
          ok: true,
          result: {
            workspace: saved.get(params.workspaceId) ?? get(params.workspaceId),
          },
        };
      }
      if (
        channel !== IPC_CHANNELS.BACKEND.REQUEST ||
        request?.method !== 'workspace.dismissAttention'
      )
        return previous.invoke(channel, payload);
      const params = request.params;
      if (!params) throw new Error('Missing workspace.dismissAttention parameters');
      calls.push({ channel, method: request.method, params });
      const shouldFail = fail;
      fail = false;
      if (hold) {
        hold = false;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      if (shouldFail)
        return { ok: false, error: { code: 'DISMISS_REJECTED', message: 'Dismiss unavailable' } };
      const current = get(params.workspaceId);
      const reasons = reminderOf(current).reasons;
      const dismissed = reasons.every((reason) =>
        params.reasons.some((pair) => pair.id === reason.id && pair.revision === reason.revision),
      );
      const workspace: Workspace = {
        ...current,
        attentionReminder: {
          reasons,
          dismissed,
          displayStatus: dismissed
            ? current.activity === 'agent_running'
              ? 'in_progress'
              : 'waiting'
            : 'needs_attention',
        },
      };
      saved.set(workspace.id, workspace);
      if (holdResponse) {
        holdResponse = false;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      responses.push(workspace);
      return { ok: true, result: { workspace } };
    },
  };
  const stopSaga = store.runSaga(workspaceOperationsSaga);
  return () => {
    stopSaga();
    release();
    window.electronAPI = previous;
    delete window.__homeDismiss;
  };
}
