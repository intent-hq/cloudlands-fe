import { beforeEach, describe, expect, it, vi } from 'vitest';

const control = vi.hoisted(() => ({ dispatch: vi.fn(), pending: false }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ dispatch: control.dispatch, state: {} });
});
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectHasPendingNoteContent: { select: () => control.pending },
}));

import {
  createNote,
  deleteNote,
  flushNoteContent,
  hasPendingNoteContent,
  settleNoteContent,
  updateNoteContent,
  updateNoteTitle,
} from './notes-write-service';

describe('notes write compatibility façade', () => {
  beforeEach(() => {
    control.dispatch.mockReset();
    control.pending = false;
  });

  it('routes content staging and pending selection through workspace notes', () => {
    updateNoteContent('ws-1', 'note-1', 'draft', { baseRev: 4 });
    expect(control.dispatch.mock.calls[0][0]).toMatchObject({
      type: 'workspaceNotes/updateNoteContent',
      payload: ['ws-1', 'note-1', 'draft', { baseRev: 4 }],
    });
    control.pending = true;
    expect(hasPendingNoteContent('ws-1', 'note-1')).toBe(true);
  });

  it('returns correlated mutation outcomes', async () => {
    control.dispatch.mockImplementation((action) => {
      const value = action.asyncActionType.endsWith('createNotePersistRequested')
        ? 'note-new'
        : undefined;
      return action.success(value);
    });
    await expect(createNote('ws-1', { title: 'New' })).resolves.toBe('note-new');
    await expect(flushNoteContent('ws-1', 'note-1')).resolves.toBeUndefined();
    await expect(settleNoteContent('ws-1', 'note-1')).resolves.toBeUndefined();
    await expect(updateNoteTitle('ws-1', 'note-1', 'Title')).resolves.toBeUndefined();
    await expect(deleteNote('ws-1', 'note-1')).resolves.toBeUndefined();
    expect(control.dispatch.mock.calls.map(([action]) => action.asyncActionType)).toEqual([
      'workspaceNotes/createNotePersistRequested',
      'workspaceNotes/flushNoteContentRequested',
      'workspaceNotes/settleNoteContentRequested',
      'workspaceNotes/updateNoteTitlePersistRequested',
      'workspaceNotes/deleteNotePersistRequested',
    ]);
  });
});
