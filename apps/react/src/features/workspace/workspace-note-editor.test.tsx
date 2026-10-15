import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useSearch,
} from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { WorkspaceNoteEditor } from './workspace-note-editor';
import { notesWriteSaga } from '@/store/workspace-notes/sagas/notes-write-saga';
import { selectExplicitNoteEditor } from '@/store/workspace-notes/note-edit-selectors';
import {
  selectPrincipalActionContext,
  selectPrincipalConnectionContext,
} from '@/store/principal/principal-selectors';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { workspaceMounted } from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { connectionStatusChanged } from '../../../../../src/store/renderer/slices/daemon-health/daemon-health-slice';
import * as notes from '../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-slice';
import { ContentType, NoteVisibility, type Note, type Workspace } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
const f = vi.hoisted(() => ({
  change: (_value: string) => {},
  save: () => {},
  view: vi.fn(),
  backendRequest: vi.fn(),
}));
vi.mock('@/features/backend/backend-transport', () => ({ backend: f }));
vi.mock('@/components/editor/code-editor', () => ({
  CodeEditor: (props: {
    value: string;
    onChange: (s: string) => void;
    onSave: () => void;
    readOnly: boolean;
    ariaLabel: string;
  }) => {
    f.change = props.onChange;
    f.save = props.onSave;
    return (
      <textarea
        aria-label={props.ariaLabel}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        readOnly={props.readOnly}
      />
    );
  },
}));
const ws = WorkspaceId('note-ui'),
  id = NoteId('ordinary');
let root: ReturnType<typeof createRoot>,
  host: HTMLDivElement,
  dispose: () => void,
  stop: () => void;
function Host() {
  const search = useSearch({ strict: false }) as { note?: string };
  return search.note ? (
    <WorkspaceNoteEditor
      key={search.note}
      workspaceId={ws}
      noteId={search.note}
      consumerId="consumer"
      onView={f.view}
    />
  ) : (
    <div data-list />
  );
}
function setupRouter() {
  const parent = createRootRoute();
  const noteRoute = createRoute({
    getParentRoute: () => parent,
    path: '/workspaces/$workspaceId',
    component: Host,
  });
  const home = createRoute({
    getParentRoute: () => parent,
    path: '/',
    component: () => <div data-away />,
  });
  return createRouter({
    routeTree: parent.addChildren([noteRoute, home]),
    history: createMemoryHistory({ initialEntries: ['/workspaces/note-ui?note=ordinary'] }),
  });
}
let router: ReturnType<typeof setupRouter>;
const editor = () =>
  selectExplicitNoteEditor.select(
    store.state,
    store.state.workspaceNotes.explicitEditors.ids.at(-1)!,
  );
beforeEach(async () => {
  f.view.mockReset();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(
    setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: '/owned/workspace' } as Workspace),
  );
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  store.dispatch(workspaceMounted(ws));
  const seed = {
    id,
    workspaceId: ws,
    title: 'Note',
    content: 'original\n',
    rev: 1,
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    createdAt: '',
    updatedAt: '',
  } as Note;
  store.dispatch(notes.loadWorkspaceNotesSucceeded([ws], { [ws]: [seed] }));
  store.dispatch(notes.noteContentViewRequested('consumer', 'read', ws, id));
  store.dispatch(
    notes.noteContentViewFinished(
      ws,
      'consumer',
      'read',
      selectPrincipalConnectionContext.select(store.state),
    ),
  );
  f.backendRequest.mockReset().mockImplementation(async (_method, params, options) => {
    options.onDispatch();
    return { ok: true, noteId: id, newContent: params.content, rev: 2 };
  });
  stop = store.runSaga(notesWriteSaga);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  router = setupRouter();
  await act(async () => {
    await router.load();
    root.render(<RouterProvider router={router} />);
  });
  await vi.waitFor(() => expect(host.querySelector('textarea')).not.toBeNull());
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  stop();
  dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function edit(value = 'dirty\n') {
  await act(async () => f.change(value));
  await vi.waitFor(() => expect(host.querySelector('textarea')?.value).toBe(value));
}
async function leave() {
  await act(async () => {
    void router.navigate({ to: '/' });
  });
}
async function button(text: string) {
  const button = [...document.querySelectorAll('button')].find(
    (entry) => entry.textContent === text,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
async function dialog() {
  await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).not.toBeNull());
}
it('retains exact canonical draft and focus on Stay; explicit discard leaves without any write', async () => {
  await edit('café 日本語\n');
  const captured = editor();
  const input = host.querySelector('textarea')!;
  input.focus();
  input.setSelectionRange(2, 4);
  await leave();
  await dialog();
  await button('Stay');
  expect(editor()).toBe(captured);
  expect(router.state.location.pathname).toBe('/workspaces/note-ui');
  expect(input.selectionStart).toBe(2);
  expect(input.selectionEnd).toBe(4);
  await vi.waitFor(() => expect(document.activeElement).toBe(input));
  await leave();
  await dialog();
  await button('Discard unsaved edits');
  await vi.waitFor(() => expect(router.state.location.pathname).toBe('/'));
  expect(editor()).toBeUndefined();
  expect(store.state.workspaceNotes.revokedEditorViews[captured!.viewId]).toBe(true);
  expect(f.backendRequest).not.toHaveBeenCalled();
});
it('refuses stale Discard after a newer edit replaces the protected draft', async () => {
  await edit();
  await leave();
  await dialog();
  const confirm = [...document.querySelectorAll('button')].find(
    (entry) => entry.textContent === 'Discard unsaved edits',
  )!;
  await act(async () => {
    f.change('newer\n');
    confirm.click();
  });
  expect(router.state.location.pathname).toBe('/workspaces/note-ui');
  expect(editor()?.content).toBe('newer\n');
});
it('View saved note checks the current draft before retiring the editor', async () => {
  const view = [...host.querySelectorAll('button')].find(
    (entry) => entry.textContent === 'View saved note',
  )!;
  expect(view.disabled).toBe(false);
  await act(async () => {
    f.change('unsaved before the next selector emission\n');
    view.click();
  });
  expect(editor()?.content).toBe('unsaved before the next selector emission\n');
  expect(f.view).not.toHaveBeenCalled();
  expect(f.backendRequest).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(view.disabled).toBe(true));
  await act(async () => f.save());
  await vi.waitFor(() => expect(editor()?.content).toBe(editor()?.baseContent));
  await vi.waitFor(() => expect(view.disabled).toBe(false));
  await button('View saved note');
  expect(f.view).toHaveBeenCalledOnce();
});
it('keeps navigation protection during a disconnected read-only interval', async () => {
  await edit();
  await act(async () => store.dispatch(connectionStatusChanged('disconnected')));
  await vi.waitFor(() => expect(host.querySelector('textarea')).toBeNull());
  await leave();
  await dialog();
  await button('Stay');
  expect(editor()?.content).toBe('dirty\n');
  expect(router.state.location.pathname).toBe('/workspaces/note-ui');
  expect(f.backendRequest).not.toHaveBeenCalled();
});
it('a confirmed Save permits clean departure and repeated shortcut callbacks send only once', async () => {
  await edit();
  const save = f.save;
  await act(async () => {
    save();
    save();
  });
  await vi.waitFor(() => expect(editor()?.content).toBe(editor()?.baseContent));
  expect(f.backendRequest).toHaveBeenCalledTimes(1);
  await leave();
  await vi.waitFor(() => expect(router.state.location.pathname).toBe('/'));
});
it('a failed Save keeps the draft and departure confirmation', async () => {
  f.backendRequest.mockRejectedValueOnce(new Error('local preparation failed'));
  await edit();
  await act(async () => f.save());
  await vi.waitFor(() => expect(host.textContent).toContain('local preparation failed'));
  await leave();
  await dialog();
  await button('Stay');
  expect(editor()?.content).toBe('dirty\n');
});
it('a callback captured before note departure cannot alter a retired draft or save', async () => {
  const change = f.change,
    save = f.save;
  await leave();
  await vi.waitFor(() => expect(router.state.location.pathname).toBe('/'));
  await act(async () => {
    change('late');
    save();
  });
  expect(editor()).toBeUndefined();
  expect(f.backendRequest).not.toHaveBeenCalled();
});
