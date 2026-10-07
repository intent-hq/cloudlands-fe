import { startNoteFixtureReads } from '../../test/note-fixture-sagas';
import { registerAllTabTypes } from '$features/layout/tab-types/register-all';
import { assistantPanelLayoutId } from '$shared/assistant-panel-layout';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { store } from '$store/renderer/store';
import { clearPanelLayout } from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { setNoteViewMode } from '$store/renderer/slices/transient-ui/transient-ui-slice';
import { installMockElectronBridge } from '../../test/ct-mock-electron-bridge';
import { navigateToRoute } from '$lib/utils/navigation.client';

export function setupAssistantPanelsFixture(noteContent?: string) {
  const previousBridge = window.electronAPI;
  registerAllTabTypes();
  store.dispatch(clearPanelLayout(assistantPanelLayoutId(null)));
  for (const id of ['plan', 'second'])
    store.dispatch(setNoteViewMode(CHIEF_WORKSPACE_ID, id, 'preview'));
  store.dispatch(setNoteViewMode('example-workspace', 'plan', 'preview'));
  installMockElectronBridge({
    'note.get': (raw) => {
      const { noteId, workspaceId } = raw as { noteId: string; workspaceId: string };
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
                : (noteContent ??
                  '# Plan for the repository\n\nThe Assistant can show this note beside the conversation.\n\n- Open links in the content panel.\n- Keep your chat draft.\n- Reopen earlier notes from the header.'),
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
  });
  // Standalone previews need the owner of note-read actions as well as the mock bridge.
  const stopNotes = startNoteFixtureReads(store);
  return () => {
    stopNotes();
    window.electronAPI = previousBridge;
  };
}

export function showPlanFromAssistant() {
  return navigateToRoute('intent://local/note/plan');
}
