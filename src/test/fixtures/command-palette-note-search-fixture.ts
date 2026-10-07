import type { Note } from '$shared/types';
import { store as appStore } from '$store/renderer/store';
import { notesReadSaga } from '$store/renderer/slices/workspace-notes/sagas/notes-read-saga';
import { installMockElectronBridge } from '../ct-mock-electron-bridge';

export function setupPaletteNoteSearch(notes: Note[] = []) {
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
    'search.messages': () => ({ matches: [] }),
    'search.fileNames': () => ({ files: [] }),
  });
  const fixtureBridge = window.electronAPI;
  const stopNotes = appStore.runSaga(notesReadSaga);
  return () => {
    stopNotes();
    if (window.electronAPI === fixtureBridge) window.electronAPI = previousBridge;
  };
}
