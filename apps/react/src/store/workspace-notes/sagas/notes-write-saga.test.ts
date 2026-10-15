import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { notesWriteSaga } from './notes-write-saga';
import { selectNoteById } from '../workspace-notes-selectors';
import {
  selectNoteEditAuthority,
  selectNoteEditContext,
  selectExplicitNoteEditor,
  selectExplicitNoteSaveOperations,
} from '../note-edit-selectors';
import {
  selectPrincipalActionContext,
  selectPrincipalConnectionContext,
} from '@/store/principal/principal-selectors';
import { createAdmittedLegacyPrincipal } from '../../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../../src/store/renderer/slices/workspace/workspace-slice';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '../../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import * as notes from '../../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-slice';
import { ContentType, NoteVisibility, type Note, type Workspace } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
import { connectionStatusChanged } from '../../../../../../src/store/renderer/slices/daemon-health/daemon-health-slice';
import {
  principalContextChanged,
  principalReceived,
} from '../../../../../../src/store/renderer/slices/principal/principal-slice';
import { daemonEventsSubscribed } from '../../../../../../src/store/renderer/slices/workspace-events/workspace-events-slice';
const transport = vi.hoisted(() => ({ backendRequest: vi.fn() }));
vi.mock('@/features/backend/backend-transport', () => ({ backend: transport }));
const ws = WorkspaceId('note-workspace'),
  id = NoteId('ordinary');
let dispose: () => void, stop: () => void;
const seed = {
  id,
  workspaceId: ws,
  title: 'Ordinary note',
  content: 'one\ntwo\n',
  rev: 4,
  contentType: ContentType.Markdown,
  tags: [],
  isPinned: false,
  isArchived: false,
  visibility: NoteVisibility.Workspace,
  createdAt: '',
  updatedAt: '',
} as Note;
const editor = () => selectExplicitNoteEditor.select(store.state, 'view');
const operations = () => selectExplicitNoteSaveOperations.select(store.state, ws, id);
function ready() {
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  store.dispatch(workspaceMounted(ws));
  store.dispatch(notes.noteContentViewRequested('consumer', 'read', ws, id));
  store.dispatch(
    notes.noteContentViewFinished(
      ws,
      'consumer',
      'read',
      selectPrincipalConnectionContext.select(store.state),
    ),
  );
}
function identity() {
  return {
    workspaceId: ws,
    noteId: id,
    viewId: 'view',
    authority: selectNoteEditAuthority.select(store.state, ws, id)!,
    context: selectNoteEditContext.select(store.state, ws, id)!,
  };
}
function save() {
  return notes.explicitNoteSaveRequested({
    ...identity(),
    requestId: crypto.randomUUID(),
    draftSeq: editor()!.draftSeq,
  });
}
async function settled() {
  await vi.waitFor(() => expect(operations().at(-1)?.status).not.toMatch(/queued|running/));
}
function reconnect(principalId = 'principal') {
  const snapshot = store.state.principal.snapshot!;
  store.dispatch(connectionStatusChanged('disconnected'));
  store.dispatch(connectionStatusChanged('connected'));
  store.dispatch(daemonEventsSubscribed(store.state.workspaceEvents.subscriptionAttempt));
  const context = selectPrincipalConnectionContext.select(store.state)!;
  store.dispatch(principalContextChanged(context));
  store.dispatch(
    principalReceived(
      { context, invalidation: 0, presentationVersion: 0 },
      { ...snapshot, principal: { ...snapshot.principal, id: principalId } },
    ),
  );
  ready();
  store.dispatch(notes.explicitNoteEditorRebound(identity()));
}
beforeEach(() => {
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(
    setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: '/owned/workspace' } as Workspace),
  );
  store.dispatch(notes.loadWorkspaceNotesSucceeded([ws], { [ws]: [seed] }));
  ready();
  transport.backendRequest.mockReset().mockImplementation(async (_method, params, options) => {
    options.onDispatch();
    return { ok: true, noteId: id, newContent: params.content, rev: 5 };
  });
  stop = store.runSaga(notesWriteSaga);
  store.dispatch(notes.explicitNoteEditorOpened(identity()));
  store.dispatch(notes.explicitNoteDraftChanged('view', 'local\ntwo\n'));
});
afterEach(() => {
  stop();
  dispose();
});
it('sends the explicit workspace/base and publishes authoritative merged content without changing title', async () => {
  transport.backendRequest.mockImplementationOnce(async (_method, _params, options) => {
    options.onDispatch();
    return { ok: true, noteId: id, newContent: 'local\nremote\n', rev: 6 };
  });
  store.dispatch(save());
  await settled();
  expect(transport.backendRequest.mock.calls[0].slice(0, 2)).toEqual([
    'note.setContent',
    { workspaceId: ws, noteId: id, content: 'local\ntwo\n', expectedVersion: 4 },
  ]);
  expect(selectNoteById.select(store.state, ws, id)).toMatchObject({
    title: seed.title,
    content: 'local\nremote\n',
    rev: 6,
  });
  expect(editor()).toMatchObject({
    content: 'local\nremote\n',
    baseContent: 'local\nremote\n',
    baseRev: 6,
  });
});
it('rebases edits made while acknowledgement is pending and keeps them dirty', async () => {
  let resolve!: (value: unknown) => void;
  transport.backendRequest.mockImplementationOnce((_method, _params, options) => {
    options.onDispatch();
    return new Promise((done) => {
      resolve = done;
    });
  });
  store.dispatch(save());
  await vi.waitFor(() => expect(resolve).toBeDefined());
  store.dispatch(notes.explicitNoteDraftChanged('view', 'newer\ntwo\n'));
  resolve({ ok: true, noteId: id, newContent: 'local\nremote\n', rev: 6 });
  await settled();
  expect(editor()).toMatchObject({
    content: 'newer\nremote\n',
    baseContent: 'local\nremote\n',
    baseRev: 6,
  });
});
it('retains a failed draft for explicit recovery without an automatic write', async () => {
  transport.backendRequest.mockRejectedValueOnce(new Error('local preflight unavailable'));
  store.dispatch(save());
  await settled();
  expect(operations().at(-1)?.status).toBe('failed');
  expect(editor()?.content).toBe('local\ntwo\n');
  expect(transport.backendRequest).toHaveBeenCalledTimes(1);
  store.dispatch(save());
  await settled();
  expect(operations().at(-1)?.status).toBe('confirmed');
  expect(transport.backendRequest).toHaveBeenCalledTimes(2);
});
it('keeps lost acknowledgements unknown after reconnect and declines another save', async () => {
  transport.backendRequest.mockImplementationOnce(async (_method, _params, options) => {
    options.onDispatch();
    throw new Error('lost response');
  });
  store.dispatch(save());
  await settled();
  reconnect();
  store.dispatch(save());
  expect(operations().some((op) => op.status === 'unknown')).toBe(true);
  expect(editor()?.content).toBe('local\ntwo\n');
  expect(transport.backendRequest).toHaveBeenCalledTimes(1);
});
it('rejects a captured save after departure and same-context reentry', async () => {
  const captured = save();
  store.dispatch(workspaceUnmounted(ws));
  ready();
  store.dispatch(captured);
  expect(transport.backendRequest).not.toHaveBeenCalled();
});
it('fences retirement during asynchronous transport preparation', async () => {
  let resume!: () => void;
  let wire = 0;
  transport.backendRequest.mockImplementationOnce(async (_method, params, options) => {
    await new Promise<void>((done) => {
      resume = done;
    });
    options.onDispatch();
    wire++;
    return { ok: true, noteId: id, newContent: params.content, rev: 5 };
  });
  store.dispatch(save());
  await vi.waitFor(() => expect(resume).toBeDefined());
  store.dispatch(notes.explicitNoteEditorReleased('view'));
  resume();
  await settled();
  expect(wire).toBe(0);
  expect(selectNoteById.select(store.state, ws, id)?.content).toBe(seed.content);
});
it('does not publish a dispatched response into a replacement principal', async () => {
  let resolve!: (value: unknown) => void;
  transport.backendRequest.mockImplementationOnce((_method, _params, options) => {
    options.onDispatch();
    return new Promise((done) => {
      resolve = done;
    });
  });
  store.dispatch(save());
  await vi.waitFor(() => expect(resolve).toBeDefined());
  reconnect('replacement');
  resolve({ ok: true, noteId: id, newContent: 'private response', rev: 5 });
  await settled();
  expect(selectNoteById.select(store.state, ws, id)?.content).toBe(seed.content);
});
it('refuses final dispatch if the loaded content becomes a task note', async () => {
  let resume!: () => void;
  let wire = 0;
  transport.backendRequest.mockImplementationOnce(async (_method, _params, options) => {
    await new Promise<void>((done) => {
      resume = done;
    });
    options.onDispatch();
    wire++;
    return {};
  });
  store.dispatch(save());
  await vi.waitFor(() => expect(resume).toBeDefined());
  store.dispatch(
    notes.loadWorkspaceNotesSucceeded([ws], {
      [ws]: [{ ...seed, metadata: { task: {} } } as Note],
    }),
  );
  resume();
  await settled();
  expect(wire).toBe(0);
});
