import { call, takeEvery } from 'typed-redux-saga';
import { store } from '$store/renderer/store';
import { searchNotesRequested } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import { bindPaletteFixtureConnection } from '../../test/fixtures/command-palette-note-search-fixture';
import { paletteNoteSearchRequested } from '$store/renderer/slices/palette/palette-slice';
import { selectAllNotes } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
import { installMockElectronBridge } from '../../test/ct-mock-electron-bridge';
import { startWorkspaceNotesSagaFixture } from '../../test/fixtures/workspace-notes-saga-fixture';

const listeners = new Set<(query: string) => void>();

/** Observe settlement for this element; the preview setup owns its bridge and note saga. */
export function paletteNoteSearchFixture(node: HTMLElement) {
  const destroy = observePaletteNoteSearchFixture((query) => {
    node.dataset.searchSettled = query;
  });
  return { destroy };
}

function* observePaletteFixtureSearches() {
  yield* takeEvery([searchNotesRequested, paletteNoteSearchRequested], function* (action) {
    const query =
      action.type === paletteNoteSearchRequested.type ? action.payload[2] : action.payload[0];
    if (!query?.trim()) return;
    const recipients = [...listeners];
    try {
      yield* call(() => action.promise);
      for (const listener of recipients) {
        if (listeners.has(listener)) listener(query);
      }
    } catch {
      // Failed requests are not successful settlement evidence.
    }
  });
}

function observePaletteNoteSearchFixture(onSettled: (query: string) => void) {
  listeners.add(onSettled);
  const stopObserver = store.runSaga(observePaletteFixtureSearches);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    listeners.delete(onSettled);
    stopObserver();
  };
}

/** Serial legacy preview mounts exercise local discovery, including all 16 seeded notes. */
export function setupPaletteNoteSearchFixture(onSettled?: (query: string) => void) {
  bindPaletteFixtureConnection();
  const previousBridge = window.electronAPI;
  installMockElectronBridge({
    'search.notes': (raw) => {
      const { query, limit, includeArchived } = raw as {
        query: string;
        limit: number;
        includeArchived: boolean;
      };
      const needle = query.trim().toLocaleLowerCase();
      return {
        requestId: `palette-fixture:${query}`,
        // Older daemons omit indexed; their matches must not replace local discovery.
        matches: (needle
          ? Object.keys(store.state.workspaceNotes.byWorkspaceId)
              .flatMap((workspaceId) => selectAllNotes.select(store.state, workspaceId))
              .filter(
                (note) =>
                  (includeArchived || !note.isArchived) &&
                  [note.title, note.content, ...note.tags].some((text) =>
                    text.toLocaleLowerCase().includes(needle),
                  ),
              )
          : []
        )
          .slice(0, limit)
          .map((note) => ({
            noteId: note.id,
            workspaceId: note.workspaceId,
            title: note.title,
            preview: note.content.slice(0, 120),
            score: null,
          })),
      };
    },
  });
  const bridge = window.electronAPI;
  const stopObserver = onSettled ? observePaletteNoteSearchFixture(onSettled) : () => {};
  const [stopNotes] = startWorkspaceNotesSagaFixture(store);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    stopObserver();
    stopNotes();
    if (window.electronAPI === bridge) window.electronAPI = previousBridge;
  };
}
