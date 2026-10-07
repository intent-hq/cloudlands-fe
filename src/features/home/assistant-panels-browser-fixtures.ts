import { registerAllTabTypes } from '$features/layout/tab-types/register-all';
import { assistantPanelLayoutId } from '$shared/assistant-panel-layout';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { store } from '$store/renderer/store';
import {
  clearPanelLayout,
  initializeLayout,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { setNoteViewMode } from '$store/renderer/slices/transient-ui/transient-ui-slice';
import { installMockElectronBridge } from '../../test/ct-mock-electron-bridge';
import { startWorkspaceNotesSagaFixture } from '../../test/fixtures/workspace-notes-saga-fixture';
import { navigateToRoute } from '$lib/utils/navigation.client';

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
                id: workspaceId,
                title: workspaceId === CHIEF_WORKSPACE_ID ? 'Assistant' : 'Example workspace',
                branch: '',
                status: 'active',
                changesets: [],
                timeline: [],
                conversationInfo: [],
                createdAt: '2026-10-05T00:00:00Z',
                updatedAt: '2026-10-05T00:00:00Z',
              },
      };
    },
    'note.get': readFixtureNote,
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
    saveControl.settle('Assistant fixture disposed');
    if (fixtureWindow.assistantNoteSaveControl === saveControl)
      fixtureWindow.assistantNoteSaveControl = previousSaveControl;
    if (window.electronAPI === bridge) window.electronAPI = previousBridge;
    if (fixtureWindow.assistantNoteRequests === requests)
      fixtureWindow.assistantNoteRequests = previousRequests;
  };
}

export function showPlanFromAssistant() {
  return navigateToRoute('intent://local/note/plan');
}
