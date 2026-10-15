import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceNoteCreate } from './workspace-note-create';
import { store } from '@/store';
import { notesWriteSaga } from '@/store/workspace-notes/sagas/notes-write-saga';
import { selectExplicitNoteCreateOperations } from '@/store/workspace-notes/note-create-selectors';
import { selectNoteById } from '@/store/workspace-notes/workspace-notes-selectors';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import * as notes from '../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-slice';
import { type Workspace, type Note, ContentType, NoteVisibility } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';

const f = vi.hoisted(() => ({
  backendRequest: vi.fn(),
  created: vi.fn(),
  submit: () => {},
  cancel: () => {},
  change: (_s: string) => {},
}));
vi.mock('@/features/backend/backend-transport', () => ({ backend: f }));
vi.mock('@/components/patterns/confirm', () => ({
  FormDialog: (props: {
    onSubmit: () => void;
    onCancel: () => void;
    children: React.ReactNode;
  }) => {
    f.submit = props.onSubmit;
    f.cancel = props.onCancel;
    return <div data-form>{props.children}</div>;
  },
}));
vi.mock('@/components/ui/input', () => ({
  Input: (props: { onChange: (event: { target: { value: string } }) => void; value: string }) => {
    f.change = (value) => props.onChange({ target: { value } });
    return <input value={props.value} readOnly />;
  },
}));
const ws = WorkspaceId('create-note-ui');
const note = (id: string): Note => ({
  id: NoteId(id),
  workspaceId: ws,
  title: 'Café 日本語',
  content: '',
  rev: 0,
  contentType: ContentType.Markdown,
  tags: [],
  isDefault: false,
  isPinned: false,
  isArchived: false,
  visibility: NoteVisibility.Workspace,
  createdAt: '',
  updatedAt: '',
});
let root: ReturnType<typeof createRoot>,
  host: HTMLDivElement,
  dispose: () => void,
  stop: () => void;
const operations = () => selectExplicitNoteCreateOperations.select(store.state, ws);
async function open() {
  await act(async () => host.querySelector('button')!.click());
  await vi.waitFor(() => expect(host.querySelector('input')).not.toBeNull());
}
async function title(value = 'Café 日本語') {
  await act(async () => f.change(value));
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  f.created.mockReset();
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(
    setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: '/owned/create' } as Workspace),
  );
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  store.dispatch(notes.loadWorkspaceNotesSucceeded([ws], { [ws]: [] }));
  f.backendRequest.mockReset().mockImplementation(async (_method, _params, options) => {
    options.onDispatch();
    return { note: note('actual') };
  });
  stop = store.runSaga(notesWriteSaga);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(<WorkspaceNoteCreate workspaceId={ws} onCreated={f.created} />),
  );
  await open();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  stop();
  dispose();
  vi.unstubAllGlobals();
});
it('blank title and cancellation send no write; stale submitted callbacks cannot use a replacement form', async () => {
  await title('   ');
  await act(async () => f.submit());
  expect(f.backendRequest).not.toHaveBeenCalled();
  await title();
  const stale = f.submit;
  await act(async () => f.cancel());
  await open();
  await act(async () => stale());
  expect(f.backendRequest).not.toHaveBeenCalled();
  expect(operations()).toEqual([]);
});
it('opens only the returned ID despite another creation and duplicate activation', async () => {
  let release!: (value: unknown) => void;
  f.backendRequest.mockImplementationOnce((_method, _params, options) => {
    options.onDispatch();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  await title();
  const submit = f.submit;
  await act(async () => {
    submit();
    submit();
  });
  expect(f.backendRequest).toHaveBeenCalledOnce();
  await act(async () => {
    store.dispatch(notes.addOptimisticNote(ws, note('sibling')));
    release({ note: note('actual') });
  });
  await vi.waitFor(() => expect(f.created).toHaveBeenCalledExactlyOnceWith('actual'));
  expect(selectNoteById.select(store.state, ws, 'sibling')).toBeDefined();
  expect(selectNoteById.select(store.state, ws, 'actual')).toMatchObject({ rev: 0, content: '' });
  expect(f.backendRequest.mock.calls[0].slice(0, 2)).toEqual([
    'note.create',
    {
      workspaceId: ws,
      title: 'Café 日本語',
      content: '',
      tags: [],
      idempotencyKey: expect.any(String),
    },
  ]);
});
it('closing a dispatched form retains the real receipt without navigating or resending on reentry', async () => {
  let release!: (value: unknown) => void;
  f.backendRequest.mockImplementationOnce((_method, _params, options) => {
    options.onDispatch();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  await title();
  await act(async () => f.submit());
  await act(async () => f.cancel());
  await act(async () => release({ note: note('background') }));
  await vi.waitFor(() => expect(operations().at(-1)?.status).toBe('confirmed'));
  expect(f.created).not.toHaveBeenCalled();
  expect(f.backendRequest).toHaveBeenCalledOnce();
});
it('a known refusal retains title and permits deliberate fresh creation', async () => {
  f.backendRequest.mockImplementationOnce(async (_method, _params, options) => {
    options.onDispatch();
    throw Object.assign(new Error('Forbidden'), { rpcCode: -32003 });
  });
  await title();
  await act(async () => f.submit());
  await vi.waitFor(() => expect(operations().at(-1)?.status).toBe('failed'));
  expect(host.querySelector('input')!.value).toBe('Café 日本語');
  expect(f.created).not.toHaveBeenCalled();
  await act(async () => f.submit());
  await vi.waitFor(() => expect(f.created).toHaveBeenCalledExactlyOnceWith('actual'));
  expect(f.backendRequest).toHaveBeenCalledTimes(2);
});
it('a lost acknowledgement stays unknown across close and blocks a fresh key', async () => {
  f.backendRequest.mockImplementationOnce(async (_method, _params, options) => {
    options.onDispatch();
    throw new Error('Disconnected');
  });
  await title();
  await act(async () => f.submit());
  await vi.waitFor(() => expect(operations().at(-1)?.status).toBe('unknown'));
  await act(async () => f.cancel());
  await vi.waitFor(() => expect(host.querySelector('button')!.disabled).toBe(true));
  expect(f.backendRequest).toHaveBeenCalledOnce();
  expect(f.created).not.toHaveBeenCalled();
});
it('workspace departure during async transport preflight cannot dispatch even after same-workspace return', async () => {
  let resume!: () => void;
  const wire = vi.fn();
  f.backendRequest.mockImplementationOnce(async (_method, _params, options) => {
    await new Promise<void>((resolve) => {
      resume = resolve;
    });
    options.onDispatch();
    wire();
    return { note: note('stale') };
  });
  await title();
  await act(async () => f.submit());
  await act(async () => {
    store.dispatch(workspaceUnmounted(ws));
    store.dispatch(workspaceMounted(ws));
    resume();
  });
  await vi.waitFor(() => expect(operations().at(-1)?.status).toBe('failed'));
  expect(wire).not.toHaveBeenCalled();
  expect(f.created).not.toHaveBeenCalled();
});
