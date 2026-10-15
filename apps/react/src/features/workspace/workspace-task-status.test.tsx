import { selectNoteById } from '@/store/workspace-notes/workspace-notes-selectors';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { store } from '@/store';
import { WorkspaceTaskStatus } from './workspace-task-status';
import { taskStatusSaga } from '@/store/workspace-tasks/sagas/task-status-saga';
import {
  selectPrincipalActionContext,
  selectPrincipalConnectionContext,
} from '@/store/principal/principal-selectors';
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
import { getExplicitTaskStatusOperations } from '../../../../../src/store/renderer/slices/workspace-tasks/workspace-tasks-projections';
import { ContentType, NoteVisibility, type Note, type Workspace } from '$shared/types';
import { AgentId, NoteId, WorkspaceId } from '$shared/types/branded-ids';
const f = vi.hoisted(() => ({
  open: (_v: boolean) => {},
  change: (_s: string) => {},
  backendRequest: vi.fn(),
}));
vi.mock('@/features/backend/backend-transport', () => ({ backend: f }));
vi.mock('@/components/ui/select', () => ({
  Select: (props: {
    onOpenChange: typeof f.open;
    onValueChange: typeof f.change;
    disabled: boolean;
    value: string;
  }) => {
    f.open = props.onOpenChange;
    f.change = props.onValueChange;
    return <button disabled={props.disabled}>{props.value}</button>;
  },
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectItem: () => null,
  SelectContent: () => null,
}));
const ws = WorkspaceId('task-ui'),
  id = NoteId('task-one');
let dispose: () => void,
  stop: () => void,
  root: ReturnType<typeof createRoot>,
  host: HTMLDivElement,
  seed: Note;
const operations = () => getExplicitTaskStatusOperations(store.state, ws, id);
const writes = () =>
  f.backendRequest.mock.calls.filter(([method]) => method === 'task.updateNoteStatus');
const current = () => selectNoteById.select(store.state, ws, id)!;
async function select(status: string) {
  await act(async () => {
    f.open(true);
    f.change(status);
  });
}
function ready(requestId = 'read') {
  store.dispatch(notes.noteContentViewRequested('consumer', requestId, ws, id));
  store.dispatch(
    notes.noteContentViewFinished(
      ws,
      'consumer',
      requestId,
      selectPrincipalConnectionContext.select(store.state),
    ),
  );
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(
    setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: '/owned/task-ui' } as Workspace),
  );
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  seed = {
    id,
    workspaceId: ws,
    title: 'Task Ω',
    content: 'Body remains unchanged\n',
    rev: 1,
    contentType: ContentType.Markdown,
    visibility: NoteVisibility.Workspace,
    tags: [],
    isPinned: false,
    isArchived: false,
    createdAt: '',
    updatedAt: '',
    metadata: { task: { status: 'not_started' } },
  } as Note;
  store.dispatch(notes.loadWorkspaceNotesSucceeded([ws], { [ws]: [seed] }));
  ready();
  f.backendRequest.mockReset().mockImplementation(async (_method, params, options) => {
    if (_method === 'task.list') return { tasks: [], stats: {} };
    options.onDispatch();
    return {
      ok: true,
      noteId: id,
      status: params.status,
      note: { ...seed, rev: 2, metadata: { task: { status: params.status } } },
    };
  });
  stop = store.runSaga(taskStatusSaga);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(<WorkspaceTaskStatus workspaceId={ws} noteId={id} consumerId="consumer" />),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  stop();
  dispose();
  vi.unstubAllGlobals();
});
it('sends one captured identity/revision and publishes the accepted status without changing body', async () => {
  await select('complete');
  expect(writes()).toHaveLength(1);
  expect(writes()[0].slice(0, 2)).toEqual([
    'task.updateNoteStatus',
    { workspaceId: ws, noteId: id, status: 'complete', expectedVersion: 1 },
  ]);
  expect(current().metadata?.task?.status).toBe('complete');
  expect(current().content).toBe(seed.content);
  expect(operations()[0].status).toBe('confirmed');
});
it('rejects blank, same status and a cancelled option callback without writes', async () => {
  await select('');
  await select('not_started');
  await act(async () => {
    f.open(true);
    f.open(false);
    f.change('complete');
  });
  expect(writes()).toHaveLength(0);
});
it('captures revision when the menu opens and rejects newer authoritative state', async () => {
  await act(async () => {
    f.open(true);
    store.dispatch(notes.applyNoteUpdated(ws, id, { ...seed, rev: 2 }));
    f.change('complete');
  });
  expect(writes()).toHaveLength(0);
});
it('retired content lease cannot be revived in one render interval', async () => {
  await act(async () => {
    f.open(true);
    store.dispatch(notes.noteContentViewReleased(ws, 'consumer'));
    ready('replacement');
    f.change('complete');
  });
  expect(writes()).toHaveLength(0);
});
it('workspace departure followed by reentry cannot revive a captured option', async () => {
  await act(async () => {
    f.open(true);
    store.dispatch(workspaceUnmounted(ws));
    store.dispatch(workspaceMounted(ws));
    f.change('complete');
  });
  expect(writes()).toHaveLength(0);
});
it('blocks duplicate pending choices and does not overwrite a newer event with old acknowledgement', async () => {
  let resolve!: (v: unknown) => void;
  f.backendRequest.mockImplementation((_m, _p, opts) => {
    if (_m === 'task.list') return Promise.resolve({ tasks: [], stats: {} });
    opts.onDispatch();
    return new Promise((r) => {
      resolve = r;
    });
  });
  await select('in_progress');
  await select('complete');
  expect(writes()).toHaveLength(1);
  await act(async () => {
    store.dispatch(
      notes.applyNoteUpdated(ws, id, {
        ...seed,
        rev: 5,
        metadata: { task: { status: 'waiting' } },
      }),
    );
    resolve({
      ok: true,
      noteId: id,
      status: 'in_progress',
      note: { ...seed, rev: 2, metadata: { task: { status: 'in_progress' } } },
    });
  });
  expect(current().metadata?.task?.status).toBe('waiting');
  expect(current().rev).toBe(5);
});
it('keeps unknown result blocked through remount and never retries on a read', async () => {
  f.backendRequest.mockImplementation(async (_m, _p, opts) => {
    if (_m === 'task.list') return Promise.resolve({ tasks: [], stats: {} });
    opts.onDispatch();
    throw new Error('Lost acknowledgement');
  });
  await select('complete');
  expect(operations()[0].status).toBe('unknown');
  await act(async () => root.render(null));
  await act(async () => {
    store.dispatch(notes.applyNoteUpdated(ws, id, { ...seed, rev: 2 }));
    root.render(<WorkspaceTaskStatus workspaceId={ws} noteId={id} consumerId="consumer" />);
  });
  await select('complete');
  expect(writes()).toHaveLength(1);
  expect(host.textContent).toContain('outcome is unknown');
});
it('waits for a read after a pre-write revision receipt, then admits a deliberate second change', async () => {
  f.backendRequest.mockImplementation(async (_m, params, opts) => {
    if (_m === 'task.list') return Promise.resolve({ tasks: [], stats: {} });
    opts.onDispatch();
    return {
      ok: true,
      noteId: id,
      status: params.status,
      note: { ...seed, rev: 1, metadata: { task: { status: params.status } } },
    };
  });
  await select('in_progress');
  expect(current().rev).toBe(1);
  expect(current().metadata?.task?.status).toBe('not_started');
  await select('complete');
  expect(writes()).toHaveLength(1);
  await act(async () =>
    store.dispatch(
      notes.applyNoteUpdated(ws, id, {
        ...seed,
        rev: 2,
        metadata: { task: { status: 'in_progress' } },
      }),
    ),
  );
  await select('complete');
  expect(writes()).toHaveLength(2);
  expect(writes()[1][1].expectedVersion).toBe(2);
});
it('rechecks authority at final transport dispatch', async () => {
  let dispatch!: () => void, reject!: (e: Error) => void;
  f.backendRequest.mockImplementation((_m, _p, opts) => {
    if (_m === 'task.list') return Promise.resolve({ tasks: [], stats: {} });
    dispatch = opts.onDispatch;
    return new Promise((_r, no) => {
      reject = no;
    });
  });
  await select('complete');
  await act(async () => {
    store.dispatch(
      setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: '/different-root' } as Workspace),
    );
    try {
      dispatch();
    } catch (e) {
      reject(e as Error);
    }
  });
  expect(operations()[0].status).toBe('failed');
  expect(current().metadata?.task?.status).toBe('not_started');
});
it('does not offer a control for assigned or ordinary non-task notes', async () => {
  await act(async () =>
    store.dispatch(
      notes.applyNoteUpdated(ws, id, {
        ...seed,
        rev: 2,
        metadata: { task: { status: 'not_started', assignedAgentIds: [AgentId('agent-one')] } },
      }),
    ),
  );
  await vi.waitFor(() => expect(host.querySelector('button')).toBeNull());
  await act(async () =>
    store.dispatch(notes.applyNoteUpdated(ws, id, { ...seed, rev: 3, metadata: {} })),
  );
  await vi.waitFor(() => expect(host.querySelector('button')).toBeNull());
});

it.each(['root', 'permission'])(
  'permanently retires the open menu across same-turn %s ABA',
  async (kind) => {
    await act(async () => {
      f.open(true);
      store.dispatch(
        setWorkspaceEntity({
          id: ws,
          myRole: kind === 'root' ? 'owner' : undefined,
          canManage: false,
          worktreePath: kind === 'root' ? '/replacement' : '/owned/task-ui',
        } as Workspace),
      );
      store.dispatch(
        setWorkspaceEntity({
          id: ws,
          myRole: 'owner',
          worktreePath: '/owned/task-ui',
        } as Workspace),
      );
      f.change('complete');
    });
    expect(writes()).toHaveLength(0);
  },
);

it('allows a fresh deliberate menu after root retirement without reviving the old callback', async () => {
  const oldChoice = f.change;
  await act(async () => {
    f.open(true);
    store.dispatch(
      setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: '/replacement' } as Workspace),
    );
    store.dispatch(
      setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: '/owned/task-ui' } as Workspace),
    );
  });
  await vi.waitFor(() =>
    expect(store.state.workspaceTasks.explicitStatusViews.ids).toHaveLength(1),
  );
  await vi.waitFor(() => expect(f.change).not.toBe(oldChoice));
  await act(async () => {
    f.open(true);
    oldChoice('complete');
  });
  expect(writes()).toHaveLength(0);
  await select('complete');
  expect(writes()).toHaveLength(1);
});

it('does not claim a conflict has reloaded while its authoritative read is still pending', async () => {
  const { BackendError } = await import('$lib/client/live/backend-transport-types');
  f.backendRequest.mockImplementation(async (method, _params, options) => {
    if (method === 'task.list') return { tasks: [], stats: {} };
    options.onDispatch();
    throw new BackendError({
      code: 'conflict',
      rpcCode: -32005,
      message: 'Conflict',
      data: {
        code: 'conflict',
        current: { ...seed, rev: 3, metadata: { task: { status: 'blocked' } } },
      },
    });
  });
  await select('complete');
  await vi.waitFor(() => expect(host.textContent).toContain('Refresh the saved task'));
  expect(host.textContent).not.toContain('reloaded the latest version');
  await select('in_progress');
  expect(writes()).toHaveLength(1);
});
