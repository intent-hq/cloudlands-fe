import { registerAllTabTypes } from '$features/layout/tab-types/register-all';
import { assistantPanelLayoutId } from '$shared/assistant-panel-layout';
import { AgentId, CHIEF_WORKSPACE_ID, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus, WorkspaceStatus, type AgentSession } from '$shared/types';
import { store } from '$store/renderer/store';
import {
  clearPanelLayout,
  consumePanelReveal,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { selectPanelLayoutWorkspace } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { setAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import {
  closePanel,
  setChiefActiveAgentId,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import {
  setNoteViewMode,
  type NoteViewMode,
} from '$store/renderer/slices/transient-ui/transient-ui-slice';
import { selectNoteViewMode } from '$store/renderer/slices/transient-ui/transient-ui-selectors';
import { installMockElectronBridge } from '../../test/ct-mock-electron-bridge';
import { navigateToRoute } from '$lib/utils/navigation.client';
import { routeDaemonEventsNotification } from '$features/events/daemon-events-bridge.client';

function assistantThread(id: string): AgentSession {
  return {
    id: AgentId(id),
    workspaceId: CHIEF_WORKSPACE_ID,
    backendSessionId: null,
    name: id,
    status: AgentStatus.Active,
    createdAt: '2026-10-05T00:00:00Z',
    updatedAt: '2026-10-05T00:00:00Z',
    messages: [],
    messageCount: 1,
  };
}

function contentSnapshot(agentId: string) {
  const layout = selectPanelLayoutWorkspace.select(store.state, assistantPanelLayoutId(agentId));
  return {
    tabs: Object.values(layout.panels).flatMap((panel) =>
      panel.tabs.map(({ type, noteId, workspaceId }) => ({
        type,
        ...(noteId ? { noteId } : {}),
        workspaceId,
      })),
    ),
    activeTabId: layout.panels['assistant-content']?.activeTabId ?? null,
    focusedPanelId: layout.focusedPanelId,
    pendingPanelReveal: layout.pendingPanelReveal,
  };
}

function emitAppEvent(type: string, data: Record<string, unknown>) {
  routeDaemonEventsNotification('events.event', {
    event: {
      id: crypto.randomUUID(),
      type,
      timestamp: '2026-10-05T00:00:00Z',
      actor: { type: 'system', id: 'daemon' },
      data,
    },
  });
}

interface AssistantPanelsControl {
  calls: Array<{ noteId: string; workspaceId: string }>;
  addThread(): void;
  selectThread(agentId: string): void;
  setNoteMode(mode: NoteViewMode): void;
  navigate(route: string, agentId?: string): void;
  navigateBackground(route: string, agentId: string): Promise<void>;
  navigateWithoutCaller(route: string): Promise<void>;
  openWorkspace(agentId: string): void;
  leaveAssistant(): void;
  holdNextRead(): void;
  release(): void;
  snapshot(): {
    path: string;
    destination: string | null;
    selectedThread: string | null;
    planViewMode: NoteViewMode;
    layouts: {
      source: ReturnType<typeof contentSnapshot>;
      other: ReturnType<typeof contentSnapshot>;
    };
  };
}

declare global {
  interface Window {
    __assistantPanels?: AssistantPanelsControl;
  }
}

export function setupAssistantPanelsFixture() {
  const previousBridge = window.electronAPI;
  registerAllTabTypes();
  store.dispatch(clearPanelLayout(assistantPanelLayoutId(null)));
  for (const id of ['assistant-source', 'assistant-other']) {
    store.dispatch(clearPanelLayout(assistantPanelLayoutId(id)));
    store.dispatch(removeSession(id));
  }
  const threads = [assistantThread('assistant-source')];
  store.dispatch(setAgents(CHIEF_WORKSPACE_ID, threads));
  store.dispatch(bulkUpsertSessions(threads));
  store.dispatch(setChiefActiveAgentId('assistant-source'));
  const calls: AssistantPanelsControl['calls'] = [];
  let holdNextRead = false;
  let release = () => {};
  window.__assistantPanels = {
    calls,
    addThread() {
      threads.push(assistantThread('assistant-other'));
      store.dispatch(setAgents(CHIEF_WORKSPACE_ID, threads));
      store.dispatch(bulkUpsertSessions(threads));
    },
    selectThread(agentId) {
      store.dispatch(setChiefActiveAgentId(agentId));
    },
    setNoteMode(mode) {
      store.dispatch(setNoteViewMode(CHIEF_WORKSPACE_ID, 'plan', mode));
    },
    navigate(route, agentId) {
      emitAppEvent('app:ui-navigate', {
        route,
        workspaceId: CHIEF_WORKSPACE_ID,
        ...(agentId ? { agentId } : {}),
      });
    },
    navigateBackground(route, agentId) {
      return navigateToRoute(route, { assistantContent: true, assistantAgentId: agentId });
    },
    navigateWithoutCaller(route) {
      return navigateToRoute(route, { assistantContent: true });
    },
    openWorkspace(agentId) {
      emitAppEvent('app:workspace-open', {
        workspaceId: 'example-workspace',
        agentId,
        openInNewWindow: false,
      });
    },
    leaveAssistant() {
      store.dispatch(closePanel());
      const layoutId = assistantPanelLayoutId('assistant-source');
      const reveal = selectPanelLayoutWorkspace.select(store.state, layoutId).pendingPanelReveal;
      if (reveal) store.dispatch(consumePanelReveal(layoutId, reveal.requestId));
      history.replaceState(null, '', '/workspace/kept');
    },
    holdNextRead() {
      holdNextRead = true;
    },
    release() {
      release();
    },
    snapshot() {
      return {
        path: location.pathname,
        destination: store.state.sidebarNav.panelItem,
        selectedThread: store.state.sidebarNav.chiefActiveAgentId,
        planViewMode: selectNoteViewMode.select(store.state, CHIEF_WORKSPACE_ID, 'plan'),
        layouts: {
          source: contentSnapshot('assistant-source'),
          other: contentSnapshot('assistant-other'),
        },
      };
    },
  };
  for (const id of ['plan', 'second'])
    store.dispatch(setNoteViewMode(CHIEF_WORKSPACE_ID, id, 'preview'));
  store.dispatch(setNoteViewMode('example-workspace', 'plan', 'preview'));
  installMockElectronBridge({
    'note.get': async (raw) => {
      const { noteId, workspaceId } = raw as { noteId: string; workspaceId: string };
      calls.push({ noteId, workspaceId });
      if (holdNextRead) {
        holdNextRead = false;
        await new Promise<void>((resolve) => (release = resolve));
      }
      if (noteId === 'missing') return { note: null };
      return {
        note: {
          id: noteId,
          workspaceId,
          title:
            noteId === 'second'
              ? 'Second plan'
              : workspaceId === 'example-workspace'
                ? 'Workspace plan'
                : 'Repository plan',
          content:
            noteId === 'second'
              ? '# Second plan\n\nKeep earlier panels in the header picker.'
              : workspaceId === 'example-workspace'
                ? '# Workspace plan\n\nA separate plan from another workspace.'
                : '# Plan for the repository\n\nThe Assistant can show this note beside the conversation.\n\n- Open links in the content panel.\n- Keep your chat draft.\n- Reopen earlier notes from the header.',
          contentType: 'markdown',
          tags: [],
          isPinned: false,
          isArchived: false,
          visibility: 'workspace',
          rev: 1,
          createdAt: '2026-10-05T00:00:00Z',
          updatedAt: '2026-10-05T00:00:00Z',
        },
      };
    },
    'principal.me': () => ({ id: 'assistant-preview-owner' }),
    'note.presence.subscribe': () => ({ subscriptionId: 'assistant-preview-presence' }),
    'note.presence.unsubscribe': () => ({ ok: true }),
    'workspace.get': () => ({
      workspace: {
        id: WorkspaceId('example-workspace'),
        title: 'Example workspace',
        branch: 'main',
        status: WorkspaceStatus.Active,
        createdAt: '2026-10-05T00:00:00Z',
        updatedAt: '2026-10-05T00:00:00Z',
        changesets: [],
        timeline: [],
        conversationInfo: [],
      },
    }),
  });
  return () => {
    release();
    delete window.__assistantPanels;
    window.electronAPI = previousBridge;
  };
}

export function showPlanFromAssistant() {
  return window.__assistantPanels?.navigate('intent://local/note/plan', 'assistant-source');
}
