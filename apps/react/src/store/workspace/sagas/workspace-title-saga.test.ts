import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { workspaceTitleSaga } from './workspace-title-saga';
import { selectHomeWorkspaceIds, selectWorkspaceById } from '../workspace-selectors';
import {
  selectWorkspaceTitleAuthority,
  selectWorkspaceTitleContext,
  selectWorkspaceTitleOperations,
  selectWorkspaceTitleRevision,
} from '../workspace-title-selectors';
import { createAdmittedLegacyPrincipal } from '../../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
  renameWorkspaceTitleRequested,
  workspaceTitleViewOpened,
  workspaceTitleViewReleased,
} from '../../../../../../src/store/renderer/slices/workspace/workspace-slice';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '../../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import type { Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { connectionStatusChanged } from '../../../../../../src/store/renderer/slices/daemon-health/daemon-health-slice';
import {
  principalContextChanged,
  principalReceived,
} from '../../../../../../src/store/renderer/slices/principal/principal-slice';
import { getPrincipalConnectionContext } from '../../../../../../src/store/renderer/slices/principal/principal-context';
import { daemonEventsSubscribed } from '../../../../../../src/store/renderer/slices/workspace-events/workspace-events-slice';
const transport = vi.hoisted(() => ({ backendRequest: vi.fn() }));
vi.mock('@/features/backend/backend-transport', () => ({ backend: transport }));
const ws = WorkspaceId('title-workspace');
let dispose: () => void;
let stop: () => void;
let view = 0;
beforeEach(() => {
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(
    setWorkspaceEntity({
      id: ws,
      title: 'Original',
      myRole: 'owner',
      worktreePath: '/owned/workspace',
    } as Workspace),
  );
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  view = 1;
  open();
  transport.backendRequest.mockReset().mockImplementation(async (_method, params, options) => {
    options?.onDispatch?.();
    return { workspace: { id: ws, title: params.title } };
  });
  stop = store.runSaga(workspaceTitleSaga);
});
afterEach(() => {
  stop();
  dispose();
});
function open() {
  store.dispatch(
    workspaceTitleViewOpened(
      `view-${view}`,
      ws,
      selectWorkspaceTitleAuthority.select(store.state, ws)!,
    ),
  );
}
function action(title = 'Renamed', previousTitle = 'Original') {
  return renameWorkspaceTitleRequested({
    workspaceId: ws,
    title,
    previousTitle,
    expectedRevision: selectWorkspaceTitleRevision.select(store.state, ws),
    token: 1,
    requestId: crypto.randomUUID(),
    authority: selectWorkspaceTitleAuthority.select(store.state, ws)!,
    context: selectWorkspaceTitleContext.select(store.state, ws)!,
    viewId: `view-${view}`,
  });
}
const operations = () => selectWorkspaceTitleOperations.select(store.state, ws);
function reconnect(principalId = 'principal') {
  const snapshot = store.state.principal.snapshot!;
  store.dispatch(connectionStatusChanged('disconnected'));
  store.dispatch(connectionStatusChanged('connected'));
  store.dispatch(daemonEventsSubscribed(store.state.workspaceEvents.subscriptionAttempt));
  const context = getPrincipalConnectionContext(store.state)!;
  store.dispatch(principalContextChanged(context));
  store.dispatch(
    principalReceived(
      { context, invalidation: 0, presentationVersion: 0 },
      { ...snapshot, principal: { ...snapshot.principal, id: principalId } },
    ),
  );
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  store.dispatch(workspaceMounted(ws));
  view++;
  open();
}
it('keeps unknown receipts visible to the same principal after reconnect without replay', async () => {
  const authority = selectWorkspaceTitleAuthority.select(store.state, ws);
  const context = selectWorkspaceTitleContext.select(store.state, ws);
  transport.backendRequest.mockImplementationOnce(async (_method, _params, options) => {
    options.onDispatch();
    throw new Error('lost acknowledgement');
  });
  await store.dispatch(action());
  reconnect();
  expect(selectWorkspaceTitleContext.select(store.state, ws)).not.toBe(context);
  expect(selectWorkspaceTitleAuthority.select(store.state, ws)).toBe(authority);
  expect(
    operations()
      .filter((op) => op.authority === authority)
      .at(-1)?.status,
  ).toBe('unknown');
  await store.dispatch(action('Another'));
  expect(transport.backendRequest).toHaveBeenCalledTimes(1);
});
it('does not publish or expose an old principal receipt after identity replacement', async () => {
  let resolve!: (response: unknown) => void;
  transport.backendRequest.mockImplementation((_method, _params, options) => {
    options.onDispatch();
    return new Promise((done) => {
      resolve = done;
    });
  });
  const pending = store.dispatch(action());
  reconnect('replacement');
  resolve({ workspace: { id: ws, title: 'Renamed' } });
  await pending;
  expect(selectWorkspaceById.select(store.state, ws)?.title).toBe('Original');
  const authority = selectWorkspaceTitleAuthority.select(store.state, ws);
  expect(operations().filter((op) => op.authority === authority)).toEqual([]);
});
it('publishes the confirmed title into the canonical heading/sidebar entity and Home search', async () => {
  await store.dispatch(action('Projet café 日本語'));
  expect(transport.backendRequest).toHaveBeenCalledTimes(1);
  expect(transport.backendRequest.mock.calls[0].slice(0, 2)).toEqual([
    'workspace.update',
    { workspaceId: ws, title: 'Projet café 日本語' },
  ]);
  expect(selectWorkspaceById.select(store.state, ws)?.title).toBe('Projet café 日本語');
  expect(selectHomeWorkspaceIds.select(store.state, '日本語', 'all')).toEqual([ws]);
});
it('declines stale queued callbacks after release and same-context reentry', async () => {
  const captured = action();
  store.dispatch(workspaceTitleViewReleased('view-1'));
  store.dispatch(workspaceUnmounted(ws));
  store.dispatch(workspaceMounted(ws));
  view++;
  open();
  await store.dispatch(captured);
  expect(transport.backendRequest).not.toHaveBeenCalled();
});
it('retires title admission on canonical workspace departure before the DOM cleanup runs', async () => {
  const captured = action();
  store.dispatch(workspaceUnmounted(ws));
  store.dispatch(workspaceMounted(ws));
  await store.dispatch(captured);
  expect(transport.backendRequest).not.toHaveBeenCalled();
});
it('checks retirement after asynchronous transport preparation before the wire', async () => {
  let dispatch!: () => void;
  let resume!: () => void;
  let wire = 0;
  transport.backendRequest.mockImplementation(async (_method, _params, options) => {
    await new Promise<void>((resolve) => {
      resume = resolve;
      dispatch = options.onDispatch;
    });
    dispatch();
    wire++;
    return { workspace: { id: ws, title: 'Renamed' } };
  });
  const promise = store.dispatch(action());
  await vi.waitFor(() => expect(resume).toBeTypeOf('function'));
  store.dispatch(workspaceTitleViewReleased('view-1'));
  resume();
  await promise;
  expect(wire).toBe(0);
  expect(operations().at(-1)?.status).toBe('failed');
});
it('retains unknown outcomes across departure and refuses a new rename without replay', async () => {
  let reject!: (error: Error) => void;
  transport.backendRequest.mockImplementation((_method, _params, options) => {
    options.onDispatch();
    return new Promise((_resolve, fail) => {
      reject = fail;
    });
  });
  const first = store.dispatch(action());
  store.dispatch(workspaceTitleViewReleased('view-1'));
  store.dispatch(workspaceUnmounted(ws));
  reject(new Error('lost acknowledgement'));
  await first;
  store.dispatch(workspaceMounted(ws));
  view++;
  open();
  await store.dispatch(action('Another'));
  expect(transport.backendRequest).toHaveBeenCalledTimes(1);
  expect(operations()[0].status).toBe('unknown');
  expect(selectWorkspaceById.select(store.state, ws)?.title).toBe('Original');
});
it('does not overwrite a newer authoritative title with a late response', async () => {
  let resolve!: (response: unknown) => void;
  transport.backendRequest.mockImplementation((_method, _params, options) => {
    options.onDispatch();
    return new Promise((done) => {
      resolve = done;
    });
  });
  const pending = store.dispatch(action());
  store.dispatch(
    setWorkspaceEntity({
      ...selectWorkspaceById.select(store.state, ws)!,
      title: 'External title',
    }),
  );
  resolve({ workspace: { id: ws, title: 'Renamed' } });
  await pending;
  expect(selectWorkspaceById.select(store.state, ws)?.title).toBe('External title');
  expect(operations()[0].status).toBe('confirmed');
});
it('retains a dispatched result after view departure without recreating removed state', async () => {
  let resolve!: (response: unknown) => void;
  transport.backendRequest.mockImplementation((_method, _params, options) => {
    options.onDispatch();
    return new Promise((done) => {
      resolve = done;
    });
  });
  const pending = store.dispatch(action());
  store.dispatch(workspaceTitleViewReleased('view-1'));
  store.dispatch(workspaceUnmounted(ws));
  resolve({ workspace: { id: ws, title: 'Renamed' } });
  await pending;
  expect(operations()[0].status).toBe('confirmed');
  expect(selectWorkspaceById.select(store.state, ws)?.title).toBe('Renamed');
});
it('does not send blank, unchanged or stale-base edits', async () => {
  await store.dispatch(action('   '));
  await store.dispatch(action(' Original '));
  store.dispatch(
    setWorkspaceEntity({ ...selectWorkspaceById.select(store.state, ws)!, title: 'External' }),
  );
  await store.dispatch(action());
  expect(transport.backendRequest).not.toHaveBeenCalled();
});
it('allows deliberate recovery after a known predispatch failure', async () => {
  transport.backendRequest.mockRejectedValueOnce(new Error('not connected'));
  await store.dispatch(action());
  expect(operations().at(-1)?.status).toBe('failed');
  await store.dispatch(action());
  expect(operations().at(-1)?.status).toBe('confirmed');
  expect(selectWorkspaceById.select(store.state, ws)?.title).toBe('Renamed');
});
