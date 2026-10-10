import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { daemonEventsSubscribed } from '$store/renderer/slices/workspace-events/workspace-events-slice';
import type { Note } from '$shared/types';
import { store as appStore } from '$store/renderer/store';
import { startWorkspaceNotesSagaFixture } from './workspace-notes-saga-fixture';
import { installMockElectronBridge } from '../ct-mock-electron-bridge';

export function bindPaletteFixtureConnection() {
  const current = appStore.state.connections;
  appStore.dispatch(
    connectionsListReceived({
      connections: getItems(current.connections),
      activeId: current.activeId,
      windowBackendId: current.windowBackendId,
    }),
  );
  appStore.dispatch(connectionStatusChanged('connected'));
  if (!appStore.state.workspaceEvents.subscriptionGeneration)
    appStore.dispatch(daemonEventsSubscribed());
}

export function setupPaletteNoteSearch(notes: Note[] = []) {
  bindPaletteFixtureConnection();
  const previousBridge = window.electronAPI;
  installMockElectronBridge({
    'search.notes': (raw) => {
      const { query, limit } = raw as { query: string; limit: number };
      const term = query.toLowerCase();
      return {
        requestId: 'preview-palette-search',
        indexed: true,
        matches: notes
          .filter((note) => `${note.title} ${note.tags.join(' ')}`.toLowerCase().includes(term))
          .slice(0, limit)
          .map((note) => ({
            noteId: note.id,
            workspaceId: note.workspaceId,
            title: note.title,
            preview: note.content,
            score: 1,
            updatedAt: note.updatedAt,
            isArchived: note.isArchived,
            workspaceArchived: false,
          })),
      };
    },
  });
  const bridge = window.electronAPI;
  const [stopNotes] = startWorkspaceNotesSagaFixture(appStore);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    stopNotes();
    if (window.electronAPI === bridge) window.electronAPI = previousBridge;
  };
}
