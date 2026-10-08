import { runSaga } from 'redux-saga';
import {
  captureNotePublicationOwner,
  isNotePublicationOwnerCurrent,
} from '$store/renderer/slices/workspace-notes/sagas/note-publication-owner';
import { workspaceUnmounted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import {
  setRetainedNoteDraft,
  setNoteContentPending,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import {
  noteDeleteViewChanged,
  noteDeleteViewRetired,
  applyNoteDeleted,
  loadWorkspaceNotesSucceeded,
  applyNoteUpdated,
  applyNoteCreated,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import type { NoteDeleteView } from '$store/renderer/slices/workspace-notes/note-delete-state';
import type { Note } from '$shared/types';
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
  isNoteDeleteHeld,
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

function terminalView(): NoteDeleteView {
  return {
    backendGeneration: 1,
    workspaceId: 'ws',
    noteId: 'note',
    noteInstanceId: 'original',
    owner: 'terminal-owner',
    phase: 'deleted',
    held: true,
    hidden: true,
    canCancel: false,
    terminalAbsent: { epoch: 'epoch', sequence: 5 },
  };
}
it('pins terminal operation history only while an actual editor or retained draft still owns it', () => {
  const owner = scope('old-editor');
  const release = reserveNoteDeleteDraft(owner)!;
  const draft = { ...owner, content: 'unsaved input', baseContent: 'strict base', rev: 4 };
  retainNoteDeleteDraft(draft);
  const values: boolean[] = [];
  const stop = subscribeNoteDeleteHold('ws', 'note', (held) => values.push(held));
  const view = terminalView();
  store.dispatch(noteDeleteViewChanged(view));
  (store as unknown as { emitState(): void }).emitState();
  store.dispatch(noteDeleteViewRetired(view));
  (store as unknown as { emitState(): void }).emitState();
  expect(Object.keys(control.state.workspaceNotes.deleteOperations)).toHaveLength(1);
  expect(isNoteDeleteHeld('ws', 'note')).toBe(true);
  expect(values).toEqual([false, true]);
  release();
  expect(isNoteDeleteHeld('ws', 'note')).toBe(true);
  expect(control.state.workspaceNotes.deleteRecoveryDrafts[noteDeleteDraftKey(owner)]).toEqual(
    draft,
  );
  store.dispatch(noteDeleteRecoveryDiscarded(owner));
  store.dispatch(noteDeleteViewRetired(view));
  (store as unknown as { emitState(): void }).emitState();
  expect(isNoteDeleteHeld('ws', 'note')).toBe(false);
  expect(values).toEqual([false, true, false]);
  stop();
});
it('rejects stale metadata resurrection after operation retirement and protects a fresh replacement', () => {
  const old = { id: 'note', workspaceId: 'ws', title: 'old', content: 'old', rev: 4 } as Note;
  store.dispatch(loadWorkspaceNotesSucceeded(['ws'], { ws: [old] }));
  const view = terminalView();
  store.dispatch(noteDeleteViewChanged(view));
  store.dispatch(applyNoteDeleted('ws', 'note'));
  store.dispatch(noteDeleteViewRetired(view));
  store.dispatch(loadWorkspaceNotesSucceeded(['ws'], { ws: [old] }));
  store.dispatch(applyNoteUpdated('ws', 'note', old));
  store.dispatch(applyNoteCreated('ws', old));
  expect(control.state.workspaceNotes.byWorkspaceId.ws.notes.map.note).toBeUndefined();
  const authority = control.state.workspaceNotes.byWorkspaceId.ws.deleteReadAuthority;
  const replacement = { ...old, content: 'replacement', rev: 1 };
  store.dispatch(loadWorkspaceNotesSucceeded(['ws'], { ws: [replacement] }, { ws: authority }));
  store.dispatch(applyNoteUpdated('ws', 'note', old));
  expect(control.state.workspaceNotes.byWorkspaceId.ws.notes.map.note.content).toBe('replacement');
});
it('does not let stale retirement remove a newer unresolved view or a newer generation hold', () => {
  const old = terminalView();
  store.dispatch(noteDeleteViewChanged(old));
  const replacement = {
    ...old,
    owner: 'new-owner',
    phase: 'uncertain' as const,
    terminalAbsent: undefined,
  };
  store.dispatch(noteDeleteViewChanged(replacement));
  store.dispatch(noteDeleteViewRetired(old));
  expect(Object.values(control.state.workspaceNotes.deleteOperations)).toEqual([replacement]);
  expect(isNoteDeleteHeld('ws', 'note')).toBe(true);
  control.state.daemonHealth.connectionGeneration = 2;
  expect(isNoteDeleteHeld('ws', 'note')).toBe(false);
});

it('retains the terminal hold until both strict draft and pending content ownership settle', () => {
  const view = terminalView();
  store.dispatch(noteDeleteViewChanged(view));
  store.dispatch(
    setRetainedNoteDraft('ws', 'note', {
      workspaceId: 'ws',
      noteId: 'note',
      content: 'strict draft',
      rev: 4,
      error: 'unacknowledged',
    }),
  );
  store.dispatch(setNoteContentPending('ws', 'note', true));
  store.dispatch(noteDeleteViewRetired(view));
  expect(isNoteDeleteHeld('ws', 'note')).toBe(true);
  store.dispatch(setRetainedNoteDraft('ws', 'note', undefined));
  store.dispatch(noteDeleteViewRetired(view));
  expect(isNoteDeleteHeld('ws', 'note')).toBe(true);
  store.dispatch(setNoteContentPending('ws', 'note', false));
  store.dispatch(noteDeleteViewRetired(view));
  expect(isNoteDeleteHeld('ws', 'note')).toBe(false);
});

it('never reuses read authority when a retained terminal owner is checked after another deletion', () => {
  const release = reserveNoteDeleteDraft(scope('editor-a'))!;
  const a = terminalView();
  const oldB = { id: 'b', workspaceId: 'ws', title: 'old b', content: 'old b', rev: 9 } as Note;
  store.dispatch(loadWorkspaceNotesSucceeded(['ws'], { ws: [oldB] }));
  store.dispatch(noteDeleteViewChanged(a));
  const tokenA = control.state.workspaceNotes.byWorkspaceId.ws.deleteReadAuthority;
  const b = { ...a, noteId: 'b', owner: 'owner-b', noteInstanceId: 'instance-b' };
  store.dispatch(noteDeleteViewChanged(b));
  store.dispatch(applyNoteDeleted('ws', 'b'));
  store.dispatch(noteDeleteViewRetired(b));
  const tokenB = control.state.workspaceNotes.byWorkspaceId.ws.deleteReadAuthority;
  const replacement = { ...oldB, content: 'replacement b', rev: 1 };
  store.dispatch(loadWorkspaceNotesSucceeded(['ws'], { ws: [replacement] }, { ws: tokenB }));
  store.dispatch(noteDeleteViewChanged({ ...a }));
  const refreshedToken = control.state.workspaceNotes.byWorkspaceId.ws.deleteReadAuthority;
  expect(refreshedToken).not.toBe(tokenA);
  store.dispatch(loadWorkspaceNotesSucceeded(['ws'], { ws: [oldB] }, { ws: tokenA }));
  store.dispatch(applyNoteUpdated('ws', 'b', oldB, tokenA));
  store.dispatch(applyNoteCreated('ws', oldB, tokenA));
  expect(control.state.workspaceNotes.byWorkspaceId.ws.notes.map.b.content).toBe('replacement b');
  expect(isNoteDeleteHeld('ws', 'note')).toBe(true);
  expect(Object.keys(control.state.workspaceNotes.deleteRecoveryReservations)).toHaveLength(1);
  store.dispatch(
    applyNoteUpdated('ws', 'b', { ...replacement, content: 'fresh b', rev: 2 }, refreshedToken),
  );
  expect(control.state.workspaceNotes.byWorkspaceId.ws.notes.map.b.content).toBe('fresh b');
  release();
});

it.each(['deleteReadAuthoritySequence', 'nextPublicationLifetime'] as const)(
  'fails closed when %s cannot allocate another exactly representable authority',
  async (counter) => {
    const old = { id: 'note', workspaceId: 'ws', title: 'old', content: 'old', rev: 4 } as Note;
    store.dispatch(loadWorkspaceNotesSucceeded(['ws'], { ws: [old] }));
    const view = terminalView();
    store.dispatch(noteDeleteViewChanged(view));
    const authority = control.state.workspaceNotes.byWorkspaceId.ws.deleteReadAuthority;
    control.state.workspaceNotes = {
      ...control.state.workspaceNotes,
      [counter]: Number.MAX_SAFE_INTEGER,
    };
    const capture = await runSaga(
      { getState: () => control.state },
      captureNotePublicationOwner,
      'ws',
    ).toPromise();
    if (counter === 'deleteReadAuthoritySequence')
      store.dispatch(noteDeleteViewChanged({ ...view }));
    else store.dispatch(workspaceUnmounted('ws'));
    expect(control.state.workspaceNotes.publicationAuthorityExhausted).toBe(true);
    store.dispatch(loadWorkspaceNotesSucceeded(['ws'], { ws: [old] }, { ws: authority }));
    store.dispatch(
      applyNoteUpdated('ws', 'note', { ...old, content: 'stale', rev: 99 }, authority),
    );
    store.dispatch(applyNoteCreated('ws', { ...old, id: 'resurrected' } as Note, authority));
    expect(control.state.workspaceNotes.byWorkspaceId.ws?.notes.map.note?.content).not.toBe(
      'stale',
    );
    expect(control.state.workspaceNotes.byWorkspaceId.ws?.notes.map.resurrected).toBeUndefined();
    expect(
      await runSaga(
        { getState: () => control.state },
        isNotePublicationOwnerCurrent,
        capture,
      ).toPromise(),
    ).toBe(false);
    const after = await runSaga(
      { getState: () => control.state },
      captureNotePublicationOwner,
      'ws',
    ).toPromise();
    expect(
      await runSaga(
        { getState: () => control.state },
        isNotePublicationOwnerCurrent,
        after,
      ).toPromise(),
    ).toBe(false);
    expect(isNoteDeleteHeld('ws', 'note')).toBe(true);
  },
);
