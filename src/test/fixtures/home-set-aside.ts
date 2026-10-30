import { take } from 'typed-redux-saga';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '$store/renderer/store';
import { startHomePreviewFixtures } from '$features/home/home-preview-lifecycle';
import { homeWorkspacesSaga } from '$features/home/home-workspaces-saga';
import {
  hydrateHomeWorkspaceSettings,
  resetHomeWorkspaceView,
  updateHomeWorkspaceView,
} from '$features/home/home-workspaces-slice';
import { readHomePersistence } from '$features/home/home-workspaces-persistence';
import {
  selectHomePersistenceScope,
  selectHomeSetAsideWorkspaceIds,
} from '$features/home/home-workspaces-selectors';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus, WorkspaceStatus, type AgentSession, type Workspace } from '$shared/types';
import {
  replaceWorkspaceList,
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
  bulkUpdateWorkspaceEntities,
  updateWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import { setRepos } from '$store/renderer/slices/known-repos/known-repos-slice';
import {
  setAgents,
  setAgentsLoaded,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import {
  bulkUpsertSessions,
  updateSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  chatTranscriptSnapshotApplied,
  transcriptHydrationSettled,
  sendMessage,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import {
  closePanel,
  hydrateSidebarNav,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import {
  principalContextChanged,
  principalReceived,
} from '$store/renderer/slices/principal/principal-slice';
import { admitLegacyPrincipal } from './principal-state';
import { setShortcutOverride } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { workspaceDeleted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';

const timestamp = '2026-10-30T12:00:00Z';
const base: Workspace = {
  id: WorkspaceId('aside-idle'),
  title: 'Explore keyboard navigation',
  branch: 'feat/keyboard-navigation',
  status: WorkspaceStatus.Active,
  displayStatus: 'idle',
  activity: 'idle',
  createdAt: timestamp,
  updatedAt: timestamp,
  lastContentActivity: timestamp,
  repositoryOwner: 'acme',
  repositoryName: 'studio',
  repositoryPath: '/repos/studio',
  path: '/workspaces/aside-idle',
  changesets: [],
  timeline: [],
  conversationInfo: [],
};

export function setupHomeSetAsideFixtures(view: 'list' | 'board') {
  const dispose = startHomePreviewFixtures({ homePreferences: false });
  store.dispatch(hydrateHomeWorkspaceSettings(null, readHomePersistence(undefined)));
  admitLegacyPrincipal();
  store.dispatch(closePanel());
  store.dispatch(hydrateSidebarNav({ pinnedWorkspaceIds: [] }));
  const workspaces: Workspace[] = [
    base,
    {
      ...base,
      id: WorkspaceId('aside-running'),
      title: 'Improve search across workspaces',
      displayStatus: 'in_progress',
      activity: 'agent_running',
      scriptsRunning: true,
      backgroundTasksRunning: true,
      waiting: true,
      statusMessage: 'Building search while watching the release.',
    },
    {
      ...base,
      id: WorkspaceId('aside-review'),
      title: 'Review the onboarding flow',
      displayStatus: 'needs_attention',
      attention: 'review_required',
    },
    {
      ...base,
      id: WorkspaceId('aside-other-repo'),
      title: 'Plan the release follow-up',
      repositoryName: 'platform',
      repositoryPath: '/repos/platform',
    },
    {
      ...base,
      id: WorkspaceId('aside-archived'),
      title: 'Archived exploration',
      status: WorkspaceStatus.Archived,
    },
  ];
  store.dispatch(replaceWorkspaceList(workspaces));
  for (const workspace of workspaces) {
    store.dispatch(setWorkspaceEntity(workspace, { detailRead: true }));
    const id = AgentId(`agent-${workspace.id}`);
    const agent: AgentSession = {
      id,
      backendSessionId: null,
      workspaceId: workspace.id,
      name: 'Workspace agent',
      status: AgentStatus.RuntimeIdle,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [
        {
          id: `message-${workspace.id}`,
          role: 'assistant',
          timestamp,
          contentBlocks: [{ type: 'text', text: 'The workspace context stays here.' }],
        },
      ],
    };
    store.dispatch(bulkUpsertSessions([agent]));
    store.dispatch(setAgents(workspace.id, [agent]));
    store.dispatch(setAgentsLoaded(workspace.id, true));
    store.dispatch(
      chatTranscriptSnapshotApplied(id, {
        truncated: false,
        totalMessages: 1,
        nextToken: null,
        resumed: false,
      }),
    );
    store.dispatch(transcriptHydrationSettled(id));
  }
  store.dispatch(setWorkspaceHasLoaded(true, store.state.connections.windowBackendId));
  store.dispatch(
    setRepos([
      {
        path: '/repos/studio',
        name: 'studio',
        owner: 'acme',
        addedAt: timestamp,
        lastUsedAt: timestamp,
      },
      {
        path: '/repos/platform',
        name: 'platform',
        owner: 'acme',
        addedAt: timestamp,
        lastUsedAt: timestamp,
      },
    ]),
  );
  let stopSaga = store.runSaga(homeWorkspacesSaga);
  store.dispatch(updateHomeWorkspaceView({ view }));
  const actions: string[] = [];
  const stopRecording = store.runSaga(function* recordHomeActions() {
    while (true) {
      const action = yield* take('*');
      actions.push(action.type);
    }
  });
  const control = {
    snapshot() {
      const scope = selectHomePersistenceScope.select(store.state);
      return {
        asideIds: selectHomeSetAsideWorkspaceIds.select(store.state),
        scope,
        stored: scope ? localStorage.getItem(scope) : null,
        selectedId: store.state.homeWorkspaces.selectedId,
        workspaces: getItems(store.state.workspace.workspaces),
        actions,
        requests: window.__homeIntegrationBrowser?.calls ?? [],
      };
    },
    update(id: string, changes: Partial<Workspace>) {
      store.dispatch(bulkUpdateWorkspaceEntities([updateWorkspaceEntity(id, changes)]));
    },
    question(id: string, messageId: string) {
      store.dispatch(
        updateSession(AgentId(`agent-${id}`), {
          metadataPatch: { pendingQuestionsMessageId: { op: 'set', value: messageId } },
        }),
      );
    },
    send(id: string) {
      store.dispatch(sendMessage(`agent-${id}`, { wsId: id, text: 'Continue this work.' }));
    },
    remove(id: string) {
      store.dispatch(workspaceDeleted(id, [], 'deleted'));
    },
    archive(id: string) {
      store.dispatch(
        bulkUpdateWorkspaceEntities([
          updateWorkspaceEntity(id, { status: WorkspaceStatus.Archived }),
        ]),
      );
    },
    configure(changes: Parameters<typeof updateHomeWorkspaceView>[0]) {
      store.dispatch(updateHomeWorkspaceView(changes));
    },
    addMany() {
      for (let index = 0; index < 30; index += 1)
        store.dispatch(
          setWorkspaceEntity({
            ...base,
            id: WorkspaceId(`aside-extra-${index}`),
            title: `Explore a longer workspace title for navigation ${index}`,
            lastContentActivity: '2026-10-29T12:00:00Z',
          }),
        );
    },
    resetView() {
      store.dispatch(resetHomeWorkspaceView());
    },
    setShortcut(shortcut: string) {
      store.dispatch(setShortcutOverride('workspace.set-aside', shortcut));
    },
    reloadPreferences() {
      stopSaga();
      store.dispatch(hydrateHomeWorkspaceSettings(null, readHomePersistence(undefined)));
      stopSaga = store.runSaga(homeWorkspacesSaga);
    },
    switchIdentity(principalId: string, backendId = 'local') {
      const connections = store.state.connections;
      store.dispatch(
        connectionsListReceived({
          connections: getItems(connections.connections),
          activeId: backendId,
          windowBackendId: backendId,
        }),
      );
      admitLegacyPrincipal();
      const { context, snapshot } = store.state.principal;
      store.dispatch(principalContextChanged(context));
      store.dispatch(
        principalReceived(
          { context: context!, invalidation: 0, presentationVersion: 0 },
          { ...snapshot!, principal: { ...snapshot!.principal, id: principalId } },
        ),
      );
    },
  };
  window.__homeSetAside = control;
  return () => {
    stopRecording();
    stopSaga();
    delete window.__homeSetAside;
    dispose();
  };
}

declare global {
  interface Window {
    __homeSetAside?: {
      snapshot(): {
        asideIds: string[];
        scope: string | null;
        stored: string | null;
        selectedId: string | null;
        workspaces: Workspace[];
        actions: string[];
        requests: { method: string; params: Record<string, unknown> }[];
      };
      update(id: string, changes: Partial<Workspace>): void;
      question(id: string, messageId: string): void;
      send(id: string): void;
      remove(id: string): void;
      archive(id: string): void;
      configure(changes: Parameters<typeof updateHomeWorkspaceView>[0]): void;
      addMany(): void;
      resetView(): void;
      setShortcut(shortcut: string): void;
      reloadPreferences(): void;
      switchIdentity(principalId: string, backendId?: string): void;
    };
  }
}
