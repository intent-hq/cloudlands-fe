import { routeDaemonEventsNotification } from '$features/events/daemon-events-bridge.client';
import { ensureWorkspaceDetail } from '$features/workspace/workspace-detail-hydration';
import { appClient } from '$lib/client';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import {
  WorkspaceStatus,
  type Workspace,
  type AttentionReminderReason,
  type WorkspaceDisplayStatus,
  type Result,
} from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { store } from '$store/renderer/store';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import {
  replaceWorkspaceList,
  loadWorkspacesRequested,
  removeWorkspaceEntity,
  resetWorkspaceState,
  setPendingCreation,
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import { setRepos } from '$store/renderer/slices/known-repos/known-repos-slice';
import { resetHomeWorkspaceView } from './home-workspaces-slice';
import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
import { workspaceOperationsSaga } from '$store/renderer/slices/workspace-operations/sagas/workspace-operations-saga';
import { lifecycleReadSaga } from '$store/renderer/slices/workspace-lifecycle/sagas/lifecycle-read-saga';
import {
  backendReconnected,
  workspaceLoadRequested,
} from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { selectWorkspaceLoadState } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-selectors';
import { workspaceLoadSaga } from '$store/renderer/slices/workspace-lifecycle/sagas/workspace-load-saga';
import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
import {
  principalContextChanged,
  principalReceived,
} from '$store/renderer/slices/principal/principal-slice';
import {
  selectPrincipalActionContext,
  selectPrincipalConnectionContext,
} from '$store/renderer/slices/principal/principal-selectors';
import {
  daemonEventsSubscribed,
  daemonEventsSubscribing,
} from '$store/renderer/slices/workspace-events/workspace-events-slice';
import {
  openWorkspaceTab,
  closeWorkspaceTab,
} from '$store/renderer/slices/tab-state/tab-state-slice';
import {
  selectHudWorkspaceCards,
  selectHudAttentionItems,
  selectWorkspaceTabStatuses,
} from '$store/renderer/slices/hud/hud-selectors';

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
interface AdmissionListRead {
  principalId: string;
  context: string | null;
  status: 'held' | 'passed' | 'failed';
  workspaces?: Workspace[];
}
interface AdmissionDetailRead {
  principalId: string;
  context: string | null;
  status: 'held' | 'passed' | 'failed';
  workspace: Workspace;
  notFound?: boolean;
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
      addReason: (publish?: boolean) => void;
      resolveAddedReason: () => void;
      snapshot: () => Workspace;
      setStatus: (status: 'blocked' | 'failed' | 'in_progress') => void;
      setActivity: (activity: 'idle' | 'agent_running') => void;
      changePrincipal: (principalId: string, failList?: boolean) => void;
      reconnect: () => void;
      releaseList: (principalId?: string) => void;
      refreshAdmission: () => void;
      holdNextList: () => void;
      startListRead: () => void;
      listResults: Array<{ principalId: string; workspaces?: Workspace[]; error?: string }>;
      listReads: AdmissionListRead[];
      holdNextDetail: () => void;
      failNextDetail: () => void;
      stagePendingReminder: () => void;
      startDetailRead: () => void;
      startMissingEntityRead: () => void;
      startActivityRead: () => void;
      workspaceExists: () => boolean;
      releaseDetail: () => void;
      detailReads: AdmissionDetailRead[];
      detailResults: Array<{ principalId: string; workspace?: Workspace }>;
      holdNextOpenReply: () => void;
      releaseOpenReply: () => void;
      startOpenRead: () => void;
      startLoadRead: () => void;
      beginBootLoad: (missing?: boolean) => void;
      leaveSelectedWorkspace: () => void;
      selectWorkspace: () => void;
      bootLoadSnapshot: () => {
        selectedId: string | null;
        workspace: Workspace | null;
        loadState: ReturnType<typeof selectWorkspaceLoadState.select>;
        principalId: string | null;
        detailReads: AdmissionDetailRead[];
        openReplies: AdmissionDetailRead[];
      };
      openReplies: AdmissionDetailRead[];
      openResults: Array<{ principalId: string; result: Result<Workspace, string> }>;
      addPendingCreation: () => void;
      admissionSnapshot: () => {
        principalId: string | null;
        context: string | null;
        workspace: Workspace;
        pendingCreation: Workspace | null;
        listReads: AdmissionListRead[];
        listError: string | null;
        listLoading: boolean;
        loadState: ReturnType<typeof selectWorkspaceLoadState.select>;
        hudCard: ReturnType<typeof selectHudWorkspaceCards.select>[number] | undefined;
        attentionItems: ReturnType<typeof selectHudAttentionItems.select>;
        tabStatus: ReturnType<typeof selectWorkspaceTabStatuses.select>[string] | undefined;
      };
    };
  }
}

export function setupHomeDismissFixtures(collaborator = false, admissions = false) {
  const previous = window.electronAPI;
  if (!previous) throw new Error('Home preview bridge is unavailable');
  admitLegacyPrincipal(collaborator ? 'guest' : 'owner');
  const originalPrincipal = store.state.principal.snapshot!;
  let principalId = originalPrincipal.principal.id;
  const initialWorkspaces = dismissalWorkspaces.map((workspace) => ({
    ...workspace,
    myRole: collaborator ? ('collaborator' as const) : ('owner' as const),
  }));
  store.dispatch(resetHomeWorkspaceView());
  if (admissions) store.dispatch(resetWorkspaceState());
  store.dispatch(replaceWorkspaceList(initialWorkspaces));
  store.dispatch(setWorkspaceHasLoaded(true));
  store.dispatch(setRepos([]));
  const calls: DismissCall[] = [];
  const responses: Workspace[] = [];
  const reads: string[] = [];
  const saved = new Map<string, Workspace>();
  const acknowledged = new Map<string, AttentionReminderReason[]>();
  const listReads: AdmissionListRead[] = [];
  const listResults: NonNullable<Window['__homeDismiss']>['listResults'] = [];
  const detailReads: AdmissionDetailRead[] = [];
  const detailResults: NonNullable<Window['__homeDismiss']>['detailResults'] = [];
  const openReplies: AdmissionDetailRead[] = [];
  const openResults: NonNullable<Window['__homeDismiss']>['openResults'] = [];
  let holdOpenReply = false;
  let releaseOpenReply = () => {};
  let stopLoads: (() => void) | null = null;
  let missingFor: string | null = null;
  const heldLists = new Map<AdmissionListRead, () => void>();
  let holdList = false;
  let failList = false;
  let holdDetail = false;
  let failDetail = false;
  let releaseDetail = () => {};
  const releaseLists = (caller?: string) => {
    for (const [entry, resolve] of heldLists) {
      if (caller && entry.principalId !== caller) continue;
      heldLists.delete(entry);
      resolve();
    }
  };
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
  const receiptKey = (workspaceId: string, caller = principalId) =>
    JSON.stringify([caller, workspaceId]);
  const projectReminder = (
    workspace: Workspace,
    reasons: AttentionReminderReason[],
    caller = principalId,
  ) => {
    const receipt = acknowledged.get(receiptKey(workspace.id, caller)) ?? [];
    const dismissed = reasons.every((reason) =>
      receipt.some((pair) => pair.id === reason.id && pair.revision === reason.revision),
    );
    return {
      reasons,
      dismissed,
      displayStatus: dismissed
        ? workspace.activity === 'agent_running'
          ? ('in_progress' as const)
          : ('waiting' as const)
        : ('needs_attention' as const),
    };
  };
  const projectWorkspace = (workspace: Workspace, caller = principalId): Workspace =>
    workspace.displayStatus === 'needs_attention' && workspace.attentionReminder
      ? {
          ...workspace,
          attentionReminder: projectReminder(
            workspace,
            workspace.attentionReminder.reasons,
            caller,
          ),
        }
      : workspace;
  const patch = (workspace: Workspace) => store.dispatch(setWorkspaceEntity(workspace));
  const admit = (caller: string, reconnect = false) => {
    principalId = caller;
    holdList = true;
    if (reconnect) store.dispatch(backendReconnected());
    store.dispatch(daemonEventsSubscribed());
    const context = selectPrincipalConnectionContext.select(store.state)!;
    store.dispatch(principalContextChanged(context));
    store.dispatch(
      principalReceived(
        { context, invalidation: 0, presentationVersion: 0 },
        { ...originalPrincipal, principal: { ...originalPrincipal.principal, id: caller } },
      ),
    );
    store.dispatch(loadWorkspacesRequested());
  };
  window.__homeDismiss = {
    calls,
    responses,
    reads,
    listResults,
    listReads,
    detailReads,
    detailResults,
    openReplies,
    openResults,
    holdNextOpenReply: () => {
      holdOpenReply = true;
    },
    releaseOpenReply: () => releaseOpenReply(),
    startOpenRead: () => {
      const caller = principalId;
      void workspaceClient
        .open(WorkspaceId('dismiss-review'))
        .then((result) => openResults.push({ principalId: caller, result }));
    },
    startLoadRead: () => {
      stopLoads ??= store.runSaga(workspaceLoadSaga);
      store.dispatch(workspaceLoadRequested('dismiss-review'));
    },
    beginBootLoad: (missing = false) => {
      saved.set('dismiss-review', { ...get() });
      missingFor = missing ? 'person-b' : null;
      store.dispatch(daemonEventsSubscribing());
      store.dispatch(principalContextChanged(null));
      store.dispatch(removeWorkspaceEntity('dismiss-review'));
      store.dispatch(openWorkspaceTab('dismiss-review'));
      stopLoads ??= store.runSaga(workspaceLoadSaga);
      store.dispatch(workspaceLoadRequested('dismiss-review'));
    },
    leaveSelectedWorkspace: () => store.dispatch(closeWorkspaceTab('dismiss-review')),
    selectWorkspace: () => store.dispatch(openWorkspaceTab('dismiss-review')),
    bootLoadSnapshot: () => ({
      selectedId: store.state.tabState.currentTabId,
      workspace: selectWorkspaceById.select(store.state, 'dismiss-review') ?? null,
      loadState: selectWorkspaceLoadState.select(store.state, 'dismiss-review'),
      principalId: store.state.principal.snapshot?.principal.id ?? null,
      detailReads,
      openReplies,
    }),
    changePrincipal: (caller, shouldFail = false) => {
      failList = shouldFail;
      admit(caller);
    },
    reconnect: () => admit(principalId, true),
    releaseList: releaseLists,
    refreshAdmission: () => {
      failList = false;
      store.dispatch(loadWorkspacesRequested());
    },
    holdNextList: () => {
      holdList = true;
    },
    startListRead: () => {
      const caller = principalId;
      void appClient.workspaces.list({ includeArchived: true }).then(
        (workspaces) => listResults.push({ principalId: caller, workspaces }),
        (error: unknown) => listResults.push({ principalId: caller, error: String(error) }),
      );
    },
    holdNextDetail: () => {
      holdDetail = true;
    },
    failNextDetail: () => {
      failDetail = true;
    },
    stagePendingReminder: () => store.dispatch(setPendingCreation({ ...get() })),
    startDetailRead: () => {
      const caller = principalId;
      void ensureWorkspaceDetail('dismiss-review').then((workspace) =>
        detailResults.push({ principalId: caller, workspace }),
      );
    },
    startMissingEntityRead: () => {
      store.dispatch(removeWorkspaceEntity('dismiss-review'));
      routeDaemonEventsNotification('events.event', {
        type: 'workspace:displayStatus-changed',
        workspaceId: 'dismiss-review',
        data: { workspaceId: 'dismiss-review', displayStatus: 'needs_attention' },
      });
    },
    startActivityRead: () => {
      store.dispatch(removeWorkspaceEntity('dismiss-review'));
      routeDaemonEventsNotification('events.event', {
        type: 'agent:idle',
        workspaceId: 'dismiss-review',
        data: { agentId: 'dismiss-agent', workspaceId: 'dismiss-review' },
      });
    },
    workspaceExists: () => !!selectWorkspaceById.select(store.state, 'dismiss-review'),
    releaseDetail: () => releaseDetail(),
    addPendingCreation: () => {
      store.dispatch(
        setPendingCreation({
          ...get(),
          id: WorkspaceId('pending-reminder'),
          title: 'Pending review',
        }),
      );
      store.dispatch(loadWorkspacesRequested());
    },
    admissionSnapshot: () => ({
      principalId: store.state.principal.snapshot?.principal.id ?? null,
      context: selectPrincipalActionContext.select(store.state),
      workspace: get(),
      pendingCreation:
        store.state.workspace.pendingCreations['pending-reminder'] ??
        store.state.workspace.pendingCreations['dismiss-review'] ??
        null,
      listReads,
      listError: store.state.workspace.error,
      listLoading: store.state.workspace.loading,
      loadState: selectWorkspaceLoadState.select(store.state, 'dismiss-review'),
      hudCard: selectHudWorkspaceCards
        .select(store.state)
        .find((card) => card.workspaceId === get().id),
      attentionItems: selectHudAttentionItems
        .select(store.state)
        .filter((item) => item.workspaceId === get().id),
      tabStatus: selectWorkspaceTabStatuses.select(store.state)[get().id],
    }),
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
    addReason: (publish = true) => {
      const current = saved.get(get().id) ?? get();
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
      if (publish) patch(workspace);
    },
    resolveAddedReason: () => {
      const current = get();
      const server = saved.get(current.id) ?? current;
      const reasons = reminderOf(server).reasons.filter(
        (reason) => reason.id !== 'agent:another:question',
      );
      const workspace = { ...current, attentionReminder: projectReminder(current, reasons) };
      saved.set(workspace.id, workspace);
      patch(workspace);
    },
    snapshot: () => get(),
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
      const caller = principalId;
      if (
        admissions &&
        channel === IPC_CHANNELS.BACKEND.REQUEST &&
        request?.method === 'workspace.list'
      ) {
        const shouldHold = holdList;
        const shouldFail = failList;
        holdList = false;
        const entry: AdmissionListRead = {
          principalId: caller,
          context: selectPrincipalActionContext.select(store.state),
          status: shouldHold ? 'held' : 'passed',
          workspaces: initialWorkspaces
            .filter((row) => caller !== missingFor || row.id !== 'dismiss-review')
            .map((row) => projectWorkspace(saved.get(row.id) ?? row, caller)),
        };
        listReads.push(entry);
        if (shouldHold) {
          await new Promise<void>((resolve) => heldLists.set(entry, resolve));
        }
        if (shouldFail) {
          entry.status = 'failed';
          return {
            ok: false,
            error: { code: 'LIST_UNAVAILABLE', message: 'Workspace list unavailable' },
          };
        }
        entry.status = 'passed';
        return { ok: true, result: { workspaces: entry.workspaces } };
      }
      if (channel === IPC_CHANNELS.BACKEND.REQUEST && request?.method === 'workspace.get') {
        const params = request.params;
        if (!params) throw new Error('Missing workspace.get parameters');
        reads.push(params.workspaceId);
        const server = saved.get(params.workspaceId) ?? get(params.workspaceId);
        const workspace = { ...projectWorkspace(server, caller) };
        const shouldFail = failDetail;
        failDetail = false;
        if (admissions) {
          const shouldHold = holdDetail;
          holdDetail = false;
          workspace.setupScript = 'detail-for-' + caller;
          const entry: AdmissionDetailRead = {
            principalId: caller,
            context: selectPrincipalActionContext.select(store.state),
            status: shouldHold ? 'held' : 'passed',
            workspace,
            ...(caller === missingFor ? { notFound: true } : {}),
          };
          detailReads.push(entry);
          if (shouldHold)
            await new Promise<void>((resolve) => {
              releaseDetail = resolve;
            });
          entry.status = shouldFail ? 'failed' : 'passed';
        }
        if (shouldFail)
          return {
            ok: false,
            error: { code: 'GET_UNAVAILABLE', message: 'Workspace get unavailable' },
          };
        if (caller === missingFor)
          return { ok: false, error: { code: 'NOT_FOUND', message: 'Workspace not found' } };
        return {
          ok: true,
          result: {
            workspace,
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
      const current = saved.get(params.workspaceId) ?? get(params.workspaceId);
      const reasons = reminderOf(current).reasons;
      const key = receiptKey(current.id, caller);
      const receipt = [...(acknowledged.get(key) ?? [])];
      for (const reason of reasons) {
        if (
          params.reasons.some(
            (pair) => pair.id === reason.id && pair.revision === reason.revision,
          ) &&
          !receipt.some((pair) => pair.id === reason.id && pair.revision === reason.revision)
        )
          receipt.push({ ...reason });
      }
      acknowledged.set(key, receipt);
      const workspace: Workspace = {
        ...current,
        attentionReminder: projectReminder(current, reasons, caller),
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
  const restoreList = admissions
    ? overrideMockIpcHandler(WORKSPACE_CHANNELS.LIST, async () => ({
        success: true,
        data: await appClient.workspaces.list({ includeArchived: true }),
      }))
    : null;
  const restoreOpen = admissions
    ? overrideMockIpcHandler(WORKSPACE_CHANNELS.OPEN, async (arg) => {
        const caller = principalId;
        const context = selectPrincipalActionContext.select(store.state);
        const shouldHold = holdOpenReply;
        holdOpenReply = false;
        const id = (arg as { id: string }).id;
        const workspace = await appClient.workspaces.open(id);
        if (!workspace) return { success: false, error: 'Workspace not found' };
        const entry: AdmissionDetailRead = {
          principalId: caller,
          context,
          status: shouldHold ? 'held' : 'passed',
          workspace,
        };
        openReplies.push(entry);
        if (shouldHold)
          await new Promise<void>((resolve) => {
            releaseOpenReply = resolve;
          });
        entry.status = 'passed';
        return { success: true, data: workspace };
      })
    : null;
  const stopSaga = store.runSaga(workspaceOperationsSaga);
  const stopReads = admissions ? store.runSaga(lifecycleReadSaga) : null;
  return () => {
    stopLoads?.();
    stopReads?.();
    stopSaga();
    releaseLists();
    releaseDetail();
    releaseOpenReply();
    release();
    restoreOpen?.();
    restoreList?.();
    window.electronAPI = previous;
    delete window.__homeDismiss;
  };
}
