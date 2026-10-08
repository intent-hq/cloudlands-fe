import { startHomePreview } from '$features/home/home-preview-lifecycle';
import { store } from '$store/renderer/store';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus, WorkspaceStatus, type AgentSession, type Workspace } from '$shared/types';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import {
  setAgents,
  setAgentsLoaded,
  setActiveAgentId,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import {
  bulkUpsertSessions,
  updateSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  chatTranscriptSnapshotApplied,
  transcriptHydrationSettled,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import {
  initializeLayout,
  setRestoreStatus,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { selectPanelLayoutWorkspace } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
import { panelLayoutSaga } from '$store/renderer/slices/panel-layout/sagas/panel-layout-saga';
import { workspaceNavigationTabSaga } from '$store/renderer/slices/workspace-navigation/sagas/workspace-navigation-tab-saga';
import { installMockElectronBridge } from '../ct-mock-electron-bridge';
import { registerMockIpcHandler, unregisterMockIpcHandler } from '$shared/ipc-mock-router';
import { admitLegacyPrincipal } from './principal-state';

export function setupHomeWorkspaceLinksFixtures({
  href,
  title,
  repository,
  nodeOwned,
}: {
  href: string;
  title: string;
  repository: boolean;
  nodeOwned: boolean;
}) {
  const ownerId = WorkspaceId('preview-owner');
  const targetId = WorkspaceId('preview-other');
  const agentId = AgentId('preview-link-agent');
  const timestamp = '2026-10-06T12:00:00Z';
  const workspace: Workspace = {
    id: ownerId,
    title,
    path: '/workspaces/preview-owner',
    worktreePath: '/workspaces/preview-owner',
    branch: 'fix/preview-links',
    baseRef: 'main',
    status: WorkspaceStatus.Active,
    createdAt: timestamp,
    updatedAt: timestamp,
    initialPrompt: 'Review links',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    ...(repository
      ? {
          repositoryOwner: 'acme',
          repositoryName: 'a-long-repository-name',
          repositoryPath: '/repos/studio',
        }
      : {}),
  } as Workspace;
  const previousBridge = window.electronAPI;
  const external: unknown[] = [];
  const requests: unknown[] = [];
  installMockElectronBridge({
    'agent.getQueue': (params) => {
      requests.push({ method: 'agent.getQueue', params });
      return { success: true, queue: [] };
    },
    'note.get': (params) => {
      requests.push({ method: 'note.get', params });
      const { workspaceId, noteId } = params as { workspaceId: string; noteId: string };
      return {
        note: {
          id: noteId,
          workspaceId,
          title: 'Review note',
          content: 'Review evidence',
          contentType: 'markdown',
          tags: [],
          isPinned: false,
          isArchived: false,
          visibility: 'workspace',
          rev: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      };
    },
  });
  registerMockIpcHandler('shell:openExternal', (payload) => {
    external.push(payload);
  });
  registerMockIpcHandler('browser:resolve-url', (payload) => ({
    ...(payload as object),
    rewritten: false,
  }));
  const dispose = startHomePreview(() => [
    store.runSaga(panelLayoutSaga),
    store.runSaga(workspaceNavigationTabSaga),
  ]);
  admitLegacyPrincipal();
  store.dispatch(setWorkspaceEntity(workspace, { detailRead: true }));
  store.dispatch(
    setWorkspaceEntity(
      { ...workspace, id: targetId, title: 'Explicit target workspace' },
      { detailRead: true },
    ),
  );
  const session: AgentSession = {
    id: agentId,
    backendSessionId: null,
    workspaceId: ownerId,
    name: 'Workspace link reviewer',
    status: AgentStatus.RuntimeIdle,
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [
      {
        id: 'preview-link-message',
        role: 'assistant',
        timestamp,
        contentBlocks: [{ type: 'text', text: `[Review destination](${href})` }],
      },
    ],
    ...(nodeOwned ? { nodePath: '/remote/node/checkout' } : {}),
  };
  store.dispatch(bulkUpsertSessions([session]));
  store.dispatch(setAgents(ownerId, [session]));
  store.dispatch(setAgentsLoaded(ownerId, true));
  store.dispatch(setActiveAgentId(ownerId, agentId));
  store.dispatch(
    chatTranscriptSnapshotApplied(agentId, {
      truncated: false,
      totalMessages: 1,
      nextToken: null,
      resumed: false,
    }),
  );
  store.dispatch(transcriptHydrationSettled(agentId));
  for (const id of [ownerId, targetId]) {
    const panelId = `source-${id}`;
    const tabId = `chat-${id}`;
    store.dispatch(
      initializeLayout(id, {
        root: { type: 'panel', panelId },
        focusedPanelId: panelId,
        canvasWidth: 1000,
        panels: {
          [panelId]: {
            id: panelId,
            activeTabId: tabId,
            tabs: [
              {
                id: tabId,
                type: 'agent',
                agentId,
                title: 'Workspace chat',
                workspaceId: id,
                closable: true,
              },
            ],
          },
        },
      }),
    );
    store.dispatch(setRestoreStatus(id, 'restored'));
  }
  const control = {
    snapshot() {
      return JSON.parse(
        JSON.stringify({
          selectedWorkspaceId: store.state.tabState.currentTabId,
          openWorkspaceTabs: store.state.tabState.openTabs,
          owner: selectPanelLayoutWorkspace.select(store.state, ownerId),
          target: selectPanelLayoutWorkspace.select(store.state, targetId),
          external,
          requests,
        }),
      );
    },
    blockAgentPath() {
      store.dispatch(updateSession(agentId, { nodePath: '/remote/node/checkout' }));
    },
  };
  (window as unknown as { __workspaceChatReview: typeof control }).__workspaceChatReview = control;
  return {
    workspace,
    agentId,
    agentName: session.name,
    dispose() {
      delete (window as unknown as { __workspaceChatReview?: typeof control })
        .__workspaceChatReview;
      unregisterMockIpcHandler('shell:openExternal');
      unregisterMockIpcHandler('browser:resolve-url');
      window.electronAPI = previousBridge;
      dispose();
    },
  };
}
