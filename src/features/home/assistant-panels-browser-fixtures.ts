import { registerAllTabTypes } from '$features/layout/tab-types/register-all';
import { assistantPanelLayoutId } from '$shared/assistant-panel-layout';
import { AgentId, CHIEF_WORKSPACE_ID, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus, WorkspaceStatus, type AgentSession } from '$shared/types';
import { store } from '$store/renderer/store';
import {
  clearPanelLayout,
  consumePanelReveal,
  initializeLayout,
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
import { startWorkspaceNotesSagaFixture } from '../../test/fixtures/workspace-notes-saga-fixture';
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

export interface AssistantNoteSaveControl {
  holdNext(): void;
  readonly pending: boolean;
  settle(error?: string): void;
}

export function setupAssistantPanelsFixture(
  noteContent?: string,
  workspaceView?: 'editor' | 'raw',
) {
  const previousBridge = window.electronAPI;
  const fixtureWindow = window as typeof window & {
    assistantNoteRequests?: Array<{ method: string; params: unknown }>;
    assistantNoteSaveControl?: AssistantNoteSaveControl;
  };
  const previousRequests = fixtureWindow.assistantNoteRequests;
  const requests: Array<{ method: string; params: unknown }> = [];
  fixtureWindow.assistantNoteRequests = requests;
  const previousSaveControl = fixtureWindow.assistantNoteSaveControl;
  let holdNextSave = false;
  let settleSave: ((error?: string) => void) | undefined;
  const saveControl: AssistantNoteSaveControl = {
    holdNext() {
      holdNextSave = true;
    },
    get pending() {
      return !!settleSave;
    },
    settle(error) {
      settleSave?.(error);
    },
  };
  fixtureWindow.assistantNoteSaveControl = saveControl;
  const savedNotes = new Map<string, { content: string; rev: number }>();
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
  const previousPanelsControl = window.__assistantPanels;
  const panelsControl: AssistantPanelsControl = {
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
  window.__assistantPanels = panelsControl;
  for (const id of ['plan', 'second', 'empty', 'long'])
    store.dispatch(setNoteViewMode(CHIEF_WORKSPACE_ID, id, 'preview'));
  store.dispatch(setNoteViewMode('example-workspace', 'plan', 'preview'));
  store.dispatch(clearPanelLayout('example-workspace'));
  if (workspaceView) {
    store.dispatch(
      initializeLayout('example-workspace', {
        root: { type: 'panel', panelId: 'workspace-note-panel' },
        panels: {
          'workspace-note-panel': {
            id: 'workspace-note-panel',
            activeTabId: 'workspace-note-tab',
            tabs: [
              {
                id: 'workspace-note-tab',
                type: 'note',
                noteId: 'plan',
                title: 'Workspace plan',
                closable: true,
              },
            ],
          },
        },
        focusedPanelId: 'workspace-note-panel',
      }),
    );
    store.dispatch(setNoteViewMode('example-workspace', 'plan', workspaceView));
  }
  function readFixtureNote(raw: unknown) {
    const { noteId, workspaceId } = raw as { noteId: string; workspaceId: string };
    if (noteId === 'missing') return { note: null };
    const saved = savedNotes.get(`${workspaceId}/${noteId}`);
    return {
      note: {
        id: noteId,
        workspaceId,
        title:
          noteId === 'empty'
            ? 'Empty note'
            : noteId === 'long'
              ? 'Long note'
              : noteId === 'second'
                ? 'Second plan'
                : workspaceId === 'example-workspace'
                  ? 'Workspace plan'
                  : 'Repository plan',
        content:
          saved?.content ??
          (noteId === 'empty'
            ? ''
            : noteId === 'long'
              ? '# Long note\n\n' +
                Array.from(
                  { length: 80 },
                  (_, index) =>
                    `## Checkpoint ${index + 1}\n\nReview the plan and keep the note editable.`,
                ).join('\n\n')
              : noteId === 'second'
                ? '# Second plan\n\nKeep earlier panels in the header picker.'
                : workspaceId === 'example-workspace'
                  ? '# Workspace plan\n\nA separate plan from another workspace.'
                  : (noteContent ??
                    '# Plan for the repository\n\nThe Assistant can show this note beside the conversation.\n\n- Open links in the content panel.\n- Keep your chat draft.\n- Reopen earlier notes from the header.')),
        contentType: 'markdown',
        tags: [],
        isPinned: false,
        isArchived: false,
        visibility: 'workspace',
        rev: saved?.rev ?? 1,
        createdAt: '2026-10-05T00:00:00Z',
        updatedAt: '2026-10-05T00:00:00Z',
      },
    };
  }
  installMockElectronBridge({
    'workspace.get': (raw) => {
      requests.push({ method: 'workspace.get', params: raw });
      const { workspaceId } = raw as { workspaceId: string };
      if (workspaceId === 'failing-workspace') throw new Error('Workspace lookup failed');
      return {
        workspace:
          workspaceId === 'unavailable-workspace'
            ? null
            : {
                id: WorkspaceId(workspaceId),
                title: workspaceId === CHIEF_WORKSPACE_ID ? 'Assistant' : 'Example workspace',
                branch: '',
                status: WorkspaceStatus.Active,
                changesets: [],
                timeline: [],
                conversationInfo: [],
                createdAt: '2026-10-05T00:00:00Z',
                updatedAt: '2026-10-05T00:00:00Z',
              },
      };
    },
    'note.get': async (raw) => {
      const { noteId, workspaceId } = raw as { noteId: string; workspaceId: string };
      calls.push({ noteId, workspaceId });
      if (holdNextRead) {
        holdNextRead = false;
        await new Promise<void>((resolve) => (release = resolve));
      }
      return readFixtureNote(raw);
    },
    'note.update': async (raw) => {
      requests.push({ method: 'note.update', params: raw });
      const { workspaceId, noteId, content, expectedVersion } = raw as {
        workspaceId: string;
        noteId: string;
        content: string;
        expectedVersion: number;
      };
      if (
        typeof workspaceId !== 'string' ||
        typeof noteId !== 'string' ||
        typeof content !== 'string' ||
        !Number.isSafeInteger(expectedVersion)
      )
        throw new Error('Invalid strict note update');
      if (
        ![CHIEF_WORKSPACE_ID, 'example-workspace'].includes(workspaceId) ||
        !['plan', 'second', 'empty', 'long'].includes(noteId)
      )
        throw new Error('Note not found');
      if (holdNextSave) {
        holdNextSave = false;
        await new Promise<void>((resolve, reject) => {
          settleSave = (error) => {
            settleSave = undefined;
            if (error) reject(new Error(error));
            else resolve();
          };
        });
      }
      const key = `${workspaceId}/${noteId}`;
      const current = readFixtureNote({ workspaceId, noteId }).note;
      if (!current) throw new Error('Note not found');
      if (current.rev !== expectedVersion)
        throw Object.assign(new Error('Conflict'), { rpcCode: -32005 });
      savedNotes.set(key, { content, rev: current.rev + 1 });
      return readFixtureNote({ workspaceId, noteId });
    },
    'note.setContent': async (raw) => {
      requests.push({ method: 'note.setContent', params: raw });
      if (holdNextSave) {
        holdNextSave = false;
        await new Promise<void>((resolve, reject) => {
          settleSave = (error) => {
            settleSave = undefined;
            if (error) reject(new Error(error));
            else resolve();
          };
        });
      }
      const { workspaceId, noteId, content } = raw as {
        workspaceId: string;
        noteId: string;
        content: string;
      };
      const key = `${workspaceId}/${noteId}`;
      const rev = (savedNotes.get(key)?.rev ?? 1) + 1;
      savedNotes.set(key, { content, rev });
      return { ok: true, noteId, newContent: content, rev };
    },
    'comment.list': () => ({ threads: [] }),
    'note.lineAttribution.load': () => null,
    'principal.me': () => ({ id: 'assistant-preview-owner' }),
    'note.presence.subscribe': () => ({ subscriptionId: 'assistant-preview-presence' }),
    'note.presence.unsubscribe': () => ({ ok: true }),
    'note.presence.update': () => ({ ok: true }),
  });
  const bridge = window.electronAPI;
  const stopNotes = startWorkspaceNotesSagaFixture(store);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    for (const stop of stopNotes) stop();
    release();
    if (window.__assistantPanels === panelsControl)
      window.__assistantPanels = previousPanelsControl;
    saveControl.settle('Assistant fixture disposed');
    if (fixtureWindow.assistantNoteSaveControl === saveControl)
      fixtureWindow.assistantNoteSaveControl = previousSaveControl;
    if (window.electronAPI === bridge) window.electronAPI = previousBridge;
    if (fixtureWindow.assistantNoteRequests === requests)
      fixtureWindow.assistantNoteRequests = previousRequests;
  };
}

export function showPlanFromAssistant() {
  return window.__assistantPanels?.navigate('intent://local/note/plan', 'assistant-source');
}
