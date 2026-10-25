/** @vitest-environment jsdom */
/**
 * #5777 regression: mounts the real PanelLayout against the real store and
 * notes write saga, invokes its `onTabRename` wiring for a note tab, and drives
 * `notes.updateMetadata` to fail or succeed.
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/components/patterns/notify', async () => ({
  ...(await vi.importActual('$lib/components/ui/toast/toast-countdown')),
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(() => 'toast-id'),
    dismiss: vi.fn(),
  },
}));
vi.mock('../Panel.svelte', async () => ({
  default: (await import('./mocks/TabRenamePanel.svelte')).default,
}));

import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import { appClient } from '$lib/client';
import { notify } from '$lib/components/patterns/notify';
import { reversibleActions } from '$lib/utils/reversible-actions';
import {
  initializeLayout,
  setRestoreStatus,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { notesWriteSaga } from '$store/renderer/slices/workspace-notes/sagas/notes-write-saga';
import { loadWorkspaceNotesSucceeded } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import { ContentType, NoteVisibility, type Note } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
import PanelLayout from '../PanelLayout.svelte';

const STORE_CONTEXT = 'redux-store-context';
const WORKSPACE_ID = 'note-rename-failure-5777';
const NOTE_ID = 'note-5777';
const NOW = '2026-01-01T00:00:00.000Z';
let storeContext: ReduxStoreContext | undefined;
let cancelWriteSaga: (() => void) | undefined;

const seedNote: Note = {
  id: NoteId(NOTE_ID),
  workspaceId: WorkspaceId(WORKSPACE_ID),
  title: 'Old Title',
  content: 'body',
  contentType: ContentType.Markdown,
  tags: [],
  isPinned: false,
  isArchived: false,
  visibility: NoteVisibility.Workspace,
  rev: 3,
  createdAt: NOW,
  updatedAt: NOW,
};

function noteTitle(): string | undefined {
  const state = appStore.state as unknown as {
    workspaceNotes: {
      byWorkspaceId: Record<string, { notes: { map: Record<string, Note> } } | undefined>;
    };
  };
  return state.workspaceNotes.byWorkspaceId[WORKSPACE_ID]?.notes.map[NOTE_ID]?.title;
}

async function mountAndRename() {
  appStore.dispatch(loadWorkspaceNotesSucceeded([WORKSPACE_ID], { [WORKSPACE_ID]: [seedNote] }));
  appStore.dispatch(
    initializeLayout(WORKSPACE_ID, {
      root: { type: 'panel', panelId: 'note-panel' },
      panels: {
        'note-panel': {
          id: 'note-panel',
          tabs: [
            { id: 'note-tab', type: 'note', title: 'Old Title', noteId: NOTE_ID, closable: true },
          ],
          activeTabId: 'note-tab',
        },
      },
      focusedPanelId: 'note-panel',
      canvasWidth: 400,
    }),
  );
  appStore.dispatch(setRestoreStatus(WORKSPACE_ID, 'restored'));
  const result = render(PanelLayout, {
    props: { workspaceId: WORKSPACE_ID, layoutId: WORKSPACE_ID, contained: true },
    context: new Map([[STORE_CONTEXT, storeContext]]),
  });
  const tabButton = () =>
    result.container.querySelector<HTMLElement>('[data-tab-id="note-tab"]') ?? undefined;
  await waitFor(() => expect(tabButton()).toBeTruthy());
  await fireEvent.click(tabButton()!);
  return { tabTitle: () => tabButton()?.dataset.tabTitle };
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  });
  vi.spyOn(appClient.notes, 'supportsTruncatedRead').mockResolvedValue(false);
  storeContext = initAppStore(appStore);
  cancelWriteSaga = appStore.runSaga(notesWriteSaga);
});

afterEach(() => {
  cleanup();
  cancelWriteSaga?.();
  cancelWriteSaga = undefined;
  reversibleActions.cancelAll();
  storeContext?.dispose();
  storeContext = undefined;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('PanelLayout note tab rename (#5777)', () => {
  it('restores the tab title and shows only the save error toast when the save fails', async () => {
    const updateMetadata = vi
      .spyOn(appClient.notes, 'updateMetadata')
      .mockResolvedValue({ success: false, error: 'disk full' });

    const { tabTitle } = await mountAndRename();

    // Wait for the saga's failure handling, then let the rename handler settle
    // so an un-reverted tab title cannot pass by being read too early.
    await waitFor(() => expect(notify.error).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(tabTitle()).toBe('Old Title');
    expect(noteTitle()).toBe('Old Title');
    expect(updateMetadata.mock.calls[0]?.slice(0, 2)).toEqual([NOTE_ID, { title: 'New Title' }]);
    // The saga's single update-title error toast; no Renamed/Undo or extra error.
    expect(notify.error).toHaveBeenCalledTimes(1);
    expect(notify.warning).not.toHaveBeenCalled();
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('keeps the new tab title and shows the Undo toast when the save succeeds', async () => {
    const updateMetadata = vi
      .spyOn(appClient.notes, 'updateMetadata')
      .mockResolvedValue({ success: true });

    const { tabTitle } = await mountAndRename();

    await waitFor(() => expect(notify.warning).toHaveBeenCalledTimes(1));
    expect(updateMetadata).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(tabTitle()).toBe('New Title'));
    expect(noteTitle()).toBe('New Title');
    expect(notify.error).not.toHaveBeenCalled();
  });
});
