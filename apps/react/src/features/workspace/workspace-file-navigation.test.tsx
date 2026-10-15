import { act, useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { WorkspaceFileNavigation } from './workspace-file-navigation';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import {
  loadFileContentSucceeded,
  updateFileContent,
  removeFileContentEntry,
  fileSaveOperationQueued,
  fileSaveOperationStarted,
  fileSaveOperationSettled,
} from '../../../../../src/store/renderer/slices/files/files-slice';
import {
  getFileContentEntry,
  getFileSaveOperation,
} from '../../../../../src/store/renderer/slices/files/files-projections';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { selectGitWriteContext } from '@/store/git/git-write-selectors';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { Workspace } from '$shared/types';

const ws = WorkspaceId('navigation'),
  path = 'a.txt';
let dispose: () => void, root: ReturnType<typeof createRoot>, container: HTMLDivElement;
function FileHost() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(
    () => () => {
      store.dispatch(removeFileContentEntry(ws, path));
    },
    [],
  );
  return (
    <div ref={ref}>
      <textarea defaultValue="original" />
      <WorkspaceFileNavigation workspaceId={ws} path={path} editorHost={ref} />
    </div>
  );
}
const rootRoute = createRootRoute();
const fileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workspaces/$workspaceId',
  component: FileHost,
});
const otherRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <div data-away />,
});
function setupRouter() {
  const history = createMemoryHistory({
    initialEntries: ['/', '/workspaces/navigation?file=a.txt'],
  });
  return createRouter({ routeTree: rootRoute.addChildren([fileRoute, otherRoute]), history });
}
let router: ReturnType<typeof setupRouter>;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(
    setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: '/owned/repo' } as Workspace),
  );
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  store.dispatch(workspaceMounted(ws));
  store.dispatch(
    loadFileContentSucceeded(
      ws,
      path,
      '/owned/repo/a.txt',
      { kind: 'editable-text', content: 'original' },
      false,
    ),
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  router = setupRouter();
  await act(async () => {
    await router.load();
    root.render(<RouterProvider router={router} />);
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const entry = () => getFileContentEntry(store.state, ws, path);
async function edit(content = 'edited') {
  await act(async () => {
    store.dispatch(
      updateFileContent(ws, path, { kind: 'editable-text', content }, { autoSave: false }),
    );
  });
}
async function back() {
  await act(async () => {
    void router.navigate({ to: '/' });
  });
}
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
async function dialog() {
  await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).not.toBeNull());
}
async function away() {
  await vi.waitFor(() => expect(router.state.location.pathname).toBe('/'));
}
it('blocks router departure; Stay preserves canonical draft, route, selection and focus without a write', async () => {
  await edit();
  const before = entry();
  const textarea = container.querySelector('textarea')!;
  textarea.focus();
  textarea.setSelectionRange(2, 4);
  await back();
  await dialog();
  await click('Stay');
  expect(router.state.location.pathname).toBe('/workspaces/navigation');
  expect(entry()).toBe(before);
  await vi.waitFor(() => expect(document.activeElement).toBe(textarea));
  expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([2, 4]);
  expect(store.state.files.saveOperations?.ids ?? []).toEqual([]);
});
it('explicit discard releases the old cache and never starts a save', async () => {
  await edit();
  await back();
  await dialog();
  await click('Discard unsaved edits');
  await away();
  expect(entry()).toBeUndefined();
  expect(store.state.files.saveOperations?.ids ?? []).toEqual([]);
});
it('clean files leave normally', async () => {
  await back();
  await away();
});
it('rejects an old confirmation when newer edits arrive, including an edit reverted to the same text', async () => {
  await edit();
  await back();
  await dialog();
  const discard = [...document.querySelectorAll('button')].find(
    (b) => b.textContent === 'Discard unsaved edits',
  )!;
  await act(async () => {
    store.dispatch(
      updateFileContent(ws, path, { kind: 'editable-text', content: 'newer' }, { autoSave: false }),
    );
    store.dispatch(
      updateFileContent(
        ws,
        path,
        { kind: 'editable-text', content: 'edited' },
        { autoSave: false },
      ),
    );
    discard.click();
  });
  expect(router.state.location.pathname).toBe('/workspaces/navigation');
  expect(entry()?.localContent).toBe('edited');
  await back();
  await dialog();
  await click('Stay');
});
it.each(['running', 'uncertain', 'failed'] as const)(
  'retains %s ownership when discarding after a save',
  async (status) => {
    await edit();
    await act(async () => {
      store.dispatch(
        fileSaveOperationQueued({
          requestId: 'save',
          workspaceId: ws,
          path,
          absolutePath: '/owned/repo/a.txt',
          authority: selectGitWriteContext.select(store.state, ws)!,
          status: 'queued',
        }),
      );
      store.dispatch(fileSaveOperationStarted('save'));
      if (status !== 'running') store.dispatch(fileSaveOperationSettled('save', status, 'refused'));
    });
    await back();
    await dialog();
    if (status !== 'failed')
      await vi.waitFor(async () => {
        await act(async () => {});
        expect(document.body.textContent).toContain('does not cancel a write already sent');
      });
    await click('Discard unsaved edits');
    await away();
    expect(getFileSaveOperation(store.state, 'save')?.status).toBe(status);
  },
);
it('retires an unresolved dialog on workspace authority loss without accepting stale navigation', async () => {
  await edit();
  await back();
  await dialog();
  const discard = [...document.querySelectorAll('button')].find(
    (b) => b.textContent === 'Discard unsaved edits',
  )!;
  await act(async () => {
    store.dispatch(workspaceUnmounted(ws));
    discard.click();
  });
  expect(router.state.location.pathname).toBe('/workspaces/navigation');
});
it('allows same-file line navigation but blocks a different file or workspace', async () => {
  await edit();
  await act(async () => {
    void router.navigate({
      to: '/workspaces/$workspaceId',
      params: { workspaceId: ws },
      search: { file: path, line: 2 } as never,
    });
  });
  expect(document.querySelector('[role=dialog]')).toBeNull();
  await act(async () => {
    void router.navigate({
      to: '/workspaces/$workspaceId',
      params: { workspaceId: ws },
      search: { file: 'other.txt' } as never,
    });
  });
  await dialog();
  await click('Stay');
  await act(async () => {
    void router.navigate({
      to: '/workspaces/$workspaceId',
      params: { workspaceId: 'other' },
      search: { file: path } as never,
    });
  });
  await dialog();
  await click('Stay');
  expect(entry()?.localContent).toBe('edited');
});
it('supersedes an unresolved navigation without letting its old confirmation accept the new destination', async () => {
  await edit();
  await back();
  await dialog();
  const oldDiscard = [...document.querySelectorAll('button')].find(
    (b) => b.textContent === 'Discard unsaved edits',
  )!;
  await act(async () => {
    void router.navigate({
      to: '/workspaces/$workspaceId',
      params: { workspaceId: 'other' },
      search: { file: path } as never,
    });
  });
  await dialog();
  await click('Stay');
  await act(async () => oldDiscard.click());
  expect(router.state.location.pathname).toBe('/workspaces/navigation');
  expect(entry()?.localContent).toBe('edited');
});

it('a newer navigation supersedes an accepted dialog before its Promise commits', async () => {
  await edit();
  await back();
  await dialog();
  const discard = [...document.querySelectorAll('button')].find(
    (b) => b.textContent === 'Discard unsaved edits',
  )!;
  await act(async () => {
    discard.click();
    void router.navigate({
      to: '/workspaces/$workspaceId',
      params: { workspaceId: 'newer-destination' },
      search: { file: path } as never,
    });
  });
  // The newer request has not been accepted. The old accepted request must be retired.
  expect(router.state.location.pathname).toBe('/workspaces/navigation');
  expect(entry()?.localContent).toBe('edited');
  expect(document.querySelector('[role=dialog]')).not.toBeNull();
});
