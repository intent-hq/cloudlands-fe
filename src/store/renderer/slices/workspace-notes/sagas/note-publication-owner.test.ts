import { runSaga } from 'redux-saga';
import { call } from 'typed-redux-saga';
import { describe, expect, it, vi } from 'vitest';
import {
  connectionStatusChanged,
  daemonHealthReducer,
} from '../../daemon-health/daemon-health-slice';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  initialState,
  loadWorkspaceNotesSucceeded,
  noteDeleteViewChanged,
  workspaceNotesReducer,
} from '../workspace-notes-slice';
import type { WorkspaceNotesState } from '../workspace-notes-types';
import {
  captureNotePublicationOwner,
  isNotePublicationLifetimeCurrent,
  isNotePublicationOwnerCurrent,
  type NotePublicationOwner,
} from './note-publication-owner';

const ALLOCATION = 'workspaceNotes/ensureNotePublicationLifetime';
function harness(seed: WorkspaceNotesState = initialState) {
  let workspaceNotes = seed;
  let daemonHealth = daemonHealthReducer(undefined, connectionStatusChanged('connected'));
  const actions: Parameters<typeof workspaceNotesReducer>[1][] = [];
  const dispatch = (action: Parameters<typeof workspaceNotesReducer>[1]) => {
    workspaceNotes = workspaceNotesReducer(workspaceNotes, action);
    daemonHealth = daemonHealthReducer(daemonHealth, action);
    actions.push(action);
    return action;
  };
  const env = { getState: () => ({ workspaceNotes, daemonHealth }), dispatch };
  return {
    env,
    actions,
    dispatch,
    state: () => workspaceNotes,
    capture: (id: string) => runSaga(env, captureNotePublicationOwner, id).toPromise(),
    current: (owner: NotePublicationOwner) =>
      runSaga(env, isNotePublicationOwnerCurrent, owner).toPromise(),
    lifetimeCurrent: (owner: NotePublicationOwner) =>
      runSaga(env, isNotePublicationLifetimeCurrent, owner).toPromise(),
  };
}

describe('note publication ownership across workspaces', () => {
  it('keeps an unhydrated target valid when another workspace allocates and clears its state', async () => {
    const h = harness();
    const owner = await h.capture('first');
    h.dispatch(loadWorkspaceNotesSucceeded(['second'], { second: [] }));
    expect(await h.current(owner)).toBe(true);
    h.dispatch(workspaceUnmounted('second'));
    expect(await h.current(owner)).toBe(true);
    expect(Object.keys(h.state().byWorkspaceId)).toEqual(['first']);
  });

  it('allocates the target before IO without claiming successful hydration', async () => {
    const h = harness();
    const io = vi.fn((owner: NotePublicationOwner) => {
      const target = h.state().byWorkspaceId.first;
      expect(target.publicationLifetime).toBe(owner.workspaceLifetime);
      expect(owner.workspaceLifetime).toBeTypeOf('number');
      expect(target.initialized).toBe(false);
      expect(target.loading).toBe(false);
      expect(target.notes.map).toEqual({});
    });
    await runSaga(h.env, function* () {
      const owner = yield* captureNotePublicationOwner('first');
      yield* call(io, owner);
    }).toPromise();
    expect(io).toHaveBeenCalledTimes(1);
    expect(h.actions.map((action) => action.type)).toEqual([ALLOCATION]);
  });

  it('reuses an allocated target across concurrent captures without allocating again', async () => {
    const h = harness();
    const [first, second] = await Promise.all([h.capture('first'), h.capture('first')]);
    expect(first).toEqual(second);
    expect(h.actions.map((action) => action.type)).toEqual([ALLOCATION]);
    expect(h.state().nextPublicationLifetime).toBe(1);
    const other = await h.capture('second');
    expect(other.workspaceLifetime).not.toBe(first.workspaceLifetime);
    expect(await h.current(first)).toBe(true);
  });

  it.each([workspaceUnmounted, workspaceDeleted])(
    'invalidates only the removed workspace on %s and never reuses its identity',
    async (remove) => {
      const h = harness();
      const first = await h.capture('first');
      const other = await h.capture('second');
      h.dispatch(remove('first'));
      expect(h.state().byWorkspaceId.first).toBeUndefined();
      expect(await h.current(first)).toBe(false);
      expect(await h.current(other)).toBe(true);
      const replacement = await h.capture('first');
      expect(replacement.workspaceLifetime).not.toBe(first.workspaceLifetime);
      expect(await h.current(first)).toBe(false);
      expect(await h.current(replacement)).toBe(true);
      expect(await h.current(other)).toBe(true);
      expect(Object.keys(h.state().byWorkspaceId)).toHaveLength(2);
    },
  );

  it('rejects a pre-reconnect capture while admitting a new capture of the same workspace', async () => {
    const h = harness();
    const first = await h.capture('first');
    h.dispatch(connectionStatusChanged('disconnected'));
    h.dispatch(connectionStatusChanged('connected'));
    const replacement = await h.capture('first');
    expect(replacement.workspaceLifetime).toBe(first.workspaceLifetime);
    expect(replacement.backendGeneration).not.toBe(first.backendGeneration);
    expect(await h.current(first)).toBe(false);
    expect(await h.current(replacement)).toBe(true);
  });

  it('keeps deletion authority separate from the allocated workspace lifetime', async () => {
    const h = harness();
    const first = await h.capture('first');
    h.dispatch(
      noteDeleteViewChanged({
        workspaceId: 'first',
        noteId: 'note',
        noteInstanceId: 'original',
        backendGeneration: first.backendGeneration!,
        owner: 'terminal-owner',
        phase: 'deleted',
        held: true,
        hidden: true,
        canCancel: false,
        terminalAbsent: { epoch: 'epoch', sequence: 5 },
      }),
    );
    expect(await h.current(first)).toBe(false);
    expect(await h.lifetimeCurrent(first)).toBe(true);
    const fresh = await h.capture('first');
    expect(fresh.workspaceLifetime).toBe(first.workspaceLifetime);
    expect(fresh.readAuthority).not.toBe(first.readAuthority);
    expect(await h.current(fresh)).toBe(true);
  });

  it('poisons publication at allocator exhaustion without wrapping or creating a vacant owner', async () => {
    const h = harness({ ...initialState, nextPublicationLifetime: Number.MAX_SAFE_INTEGER - 1 });
    const last = await h.capture('last');
    expect(last.workspaceLifetime).toBe(Number.MAX_SAFE_INTEGER);
    expect(await h.current(last)).toBe(true);
    const refused = await h.capture('overflow');
    expect(h.state().publicationAuthorityExhausted).toBe(true);
    expect(h.state().nextPublicationLifetime).toBe(Number.MAX_SAFE_INTEGER);
    expect(h.state().byWorkspaceId.overflow).toBeUndefined();
    expect(await h.current(last)).toBe(false);
    expect(await h.current(refused)).toBe(false);
    const count = h.actions.length;
    const again = await h.capture('overflow');
    expect(h.actions).toHaveLength(count);
    expect(await h.current(again)).toBe(false);
  });

  it('fails closed if no reducer establishes a concrete target lifetime', async () => {
    const env = { getState: () => ({ workspaceNotes: initialState }), dispatch: vi.fn() };
    const owner = await runSaga(env, captureNotePublicationOwner, 'first').toPromise();
    expect(await runSaga(env, isNotePublicationOwnerCurrent, owner).toPromise()).toBe(false);
    expect(env.dispatch).toHaveBeenCalledTimes(1);
  });
});
