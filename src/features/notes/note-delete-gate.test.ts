import { beforeEach, expect, it, vi } from 'vitest';
const control = vi.hoisted(() => ({ state: {} as any, dispatch: vi.fn() }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => control.state, dispatch: control.dispatch });
});
import { store } from '$store/renderer/store';
import { workspaceNotesReducer } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import { noteDeleteDraftKey } from '$store/renderer/slices/workspace-notes/note-delete-state';
import { noteDeleteRecoveryDiscarded } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import {
  reserveNoteDeleteDraft,
  retainNoteDeleteDraft,
  subscribeNoteDeleteHold,
} from './note-delete-gate';
const scope = (ownerId: string) => ({
  backendGeneration: 1,
  workspaceId: 'ws',
  noteId: 'note',
  ownerId,
});
beforeEach(() => {
  control.state = {
    daemonHealth: { connectionGeneration: 1 },
    workspaceNotes: workspaceNotesReducer(undefined, { type: 'test/init' }),
  };
  control.dispatch.mockImplementation((action) => {
    control.state.workspaceNotes = workspaceNotesReducer(control.state.workspaceNotes, action);
  });
});
it('reserves recovery before editing and never seeks a new slot while unmounting', () => {
  const releases = Array.from({ length: 256 }, (_, n) => reserveNoteDeleteDraft(scope(String(n))));
  expect(releases.every(Boolean)).toBe(true);
  expect(reserveNoteDeleteDraft(scope('overflow'))).toBeUndefined();
  expect(
    retainNoteDeleteDraft({
      ...scope('0'),
      content: 'unsaved Unicode 🧑🏽‍💻',
      baseContent: 'base',
      rev: 4,
    }),
  ).toBe(true);
  releases[0]!();
  expect(
    control.state.workspaceNotes.deleteRecoveryDrafts[noteDeleteDraftKey(scope('0'))].content,
  ).toBe('unsaved Unicode 🧑🏽‍💻');
  expect(reserveNoteDeleteDraft(scope('overflow'))).toBeUndefined();
  store.dispatch(noteDeleteRecoveryDiscarded(scope('0')));
  const replacement = reserveNoteDeleteDraft(scope('overflow'));
  expect(replacement).toBeTypeOf('function');
  replacement!();
  releases.forEach((release) => release!());
});
it('keeps independent strict bases for competing editors and rejects unadmitted retention', () => {
  expect(retainNoteDeleteDraft({ ...scope('none'), content: 'draft', baseContent: 'base' })).toBe(
    false,
  );
  const first = reserveNoteDeleteDraft(scope('one'))!;
  const second = reserveNoteDeleteDraft(scope('two'))!;
  retainNoteDeleteDraft({ ...scope('one'), content: 'first', baseContent: 'base-a', rev: 3 });
  retainNoteDeleteDraft({ ...scope('two'), content: 'second', baseContent: 'base-b', rev: 4 });
  first();
  second();
  expect(Object.values(control.state.workspaceNotes.deleteRecoveryDrafts)).toEqual([
    expect.objectContaining({ content: 'first', baseContent: 'base-a', rev: 3 }),
    expect.objectContaining({ content: 'second', baseContent: 'base-b', rev: 4 }),
  ]);
});
it('notifies a backend generation change even when the hold boolean is unchanged', () => {
  const values: boolean[] = [];
  const stop = subscribeNoteDeleteHold('ws', 'note', (held) => values.push(held));
  control.state.daemonHealth.connectionGeneration = 2;
  (store as unknown as { emitState(): void }).emitState();
  expect(values).toEqual([false, false]);
  stop();
});
