import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Link,
} from '@tanstack/react-router';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { WorkspaceFileBrowser } from './workspace-file-browser';
import { store } from '@/store';
import { fileExplorerSaga } from '@/store/file-explorer/sagas/file-explorer-saga';
import { selectFileExplorerState } from '@/store/file-explorer/file-explorer-selectors';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { workspaceMounted } from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { refreshFileExplorer } from '../../../../../src/store/renderer/slices/file-explorer/file-explorer-slice';
import {
  loadFileContentSucceeded,
  updateFileContent,
} from '../../../../../src/store/renderer/slices/files/files-slice';
import { getFileContentEntry } from '../../../../../src/store/renderer/slices/files/files-projections';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import type { Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/features/backend/backend-transport', () => ({ backendRequest: request }));
const ws = WorkspaceId('explorer');
const rootPath = '/owned/repo';
let dispose: () => void,
  cancel: () => void,
  root: ReturnType<typeof createRoot>,
  container: HTMLDivElement;
let listings: Record<string, unknown>, error: string | null;
const rootRoute = createRootRoute();
const route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workspaces/$workspaceId',
  validateSearch: (s: Record<string, unknown>) => ({
    file: typeof s.file === 'string' ? s.file : undefined,
  }),
  component: Host,
});
function Host() {
  const { file } = route.useSearch();
  return (
    <>
      <WorkspaceFileBrowser workspaceId={ws} hidden={Boolean(file)} />
      {file && (
        <div data-opened={file}>
          <Link to="/workspaces/$workspaceId" params={{ workspaceId: ws }} search={{}}>
            Back
          </Link>
        </div>
      )}
    </>
  );
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
  error = null;
  listings = {
    '': [
      { name: 'z.txt', type: 'file' },
      { name: 'nested', type: 'directory' },
    ],
    nested: [{ name: 'deeper', type: 'directory' }],
    'nested/deeper': [{ name: 'résumé #1.txt', type: 'file' }],
  };
  request.mockReset().mockImplementation(async (_method, params, options) => {
    options?.onDispatch?.();
    if (_method === 'search.fileNames')
      return {
        files: ['left/same.txt', 'right/same.txt'],
        truncated: false,
        requestId: 'daemon-search',
      };
    if (error && params.path === 'nested') throw new Error(error);
    return listings[params.path] ?? [];
  });
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(
    setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: rootPath } as Workspace),
  );
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  store.dispatch(workspaceMounted(ws));
  cancel = store.runSaga(fileExplorerSaga);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/workspaces/explorer'] }),
  });
  await act(async () => root.render(<RouterProvider router={router} />));
  await vi.waitFor(() =>
    expect(container.querySelector('[data-explorer-path="/owned/repo/nested"]')).not.toBeNull(),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  cancel();
  dispose();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function row(path: string) {
  return container.querySelector<HTMLButtonElement>(`[data-explorer-path="${rootPath}/${path}"]`)!;
}
async function click(path: string) {
  await act(async () => row(path).click());
}

it('loads only expanded levels with canonical folder ordering and exact Back focus', async () => {
  expect(
    [...container.querySelectorAll('[role=treeitem]')].map((n) =>
      n.getAttribute('data-explorer-path'),
    ),
  ).toEqual([rootPath + '/nested', rootPath + '/z.txt']);
  expect(request.mock.calls.map((c) => c[1].path)).toEqual(['']);
  await click('nested');
  await vi.waitFor(() => expect(row('nested/deeper')).not.toBeNull());
  expect(request.mock.calls.map((c) => c[1].path)).toEqual(['', 'nested']);
  await click('nested/deeper');
  await vi.waitFor(() => expect(row('nested/deeper/résumé #1.txt')).not.toBeNull());
  await click('nested/deeper/résumé #1.txt');
  await vi.waitFor(() =>
    expect(container.querySelector('[data-opened]')?.getAttribute('data-opened')).toBe(
      'nested/deeper/résumé #1.txt',
    ),
  );
  await act(async () => container.querySelector<HTMLAnchorElement>('a')!.click());
  await vi.waitFor(() => expect(document.activeElement).toBe(row('nested/deeper/résumé #1.txt')));
  expect(row('nested').getAttribute('aria-expanded')).toBe('true');
  expect(request.mock.calls.every((c) => c[0] === 'file.list')).toBe(true);
});

it('retains a collapsed hierarchy and follows shared arrow navigation', async () => {
  await click('nested');
  await vi.waitFor(() => expect(row('nested/deeper')).not.toBeNull());
  await act(async () => {
    row('nested/deeper').focus();
    row('nested/deeper').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    );
  });
  expect(document.activeElement).toBe(row('nested'));
  await click('nested');
  await vi.waitFor(() => expect(row('nested/deeper')).toBeNull());
  expect(
    selectFileExplorerState.select(store.state, ws).nodes.map[rootPath + '/nested/deeper'],
  ).toBeDefined();
});

it('distinguishes error and empty retry without discarding the canonical dirty editor', async () => {
  store.dispatch(
    loadFileContentSucceeded(
      ws,
      'z.txt',
      rootPath + '/z.txt',
      { kind: 'editable-text', content: 'original' },
      false,
    ),
  );
  store.dispatch(
    updateFileContent(
      ws,
      'z.txt',
      { kind: 'editable-text', content: 'unsaved' },
      { autoSave: false },
    ),
  );
  const entry = getFileContentEntry(store.state, ws, 'z.txt');
  error = 'Listing refused';
  await click('nested');
  await vi.waitFor(() => expect(container.textContent).toContain('Listing refused'));
  expect(container.textContent).not.toContain('Empty directory');
  error = null;
  listings.nested = [];
  const retry = [...container.querySelectorAll('button')].find((n) => n.textContent === 'Retry')!;
  await act(async () => retry.click());
  await vi.waitFor(() => expect(container.textContent).toContain('Empty directory'));
  await act(async () => store.dispatch(refreshFileExplorer(ws)));
  expect(getFileContentEntry(store.state, ws, 'z.txt')).toBe(entry);
});

it('retires an in-flight read without recreating removed explorer state', async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementation((_m, _p, o) => {
    o?.onDispatch?.();
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await click('nested');
  await act(async () => root.unmount());
  await act(async () => finish([{ name: 'late.txt', type: 'file' }]));
  expect(store.state.fileExplorer.byWorkspaceId[ws]).toBeUndefined();
  root = createRoot(container);
});

async function searchFor(query: string) {
  if (!container.querySelector('input')) {
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-sidebar-search=files] button',
    )!;
    await act(async () => trigger.click());
  }
  const input = container.querySelector<HTMLInputElement>('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, query);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}

it('finds unchanged duplicate names, restores the exact result on Back and retains expanded tree state on clear', async () => {
  await click('nested');
  await vi.waitFor(() => expect(row('nested/deeper')).not.toBeNull());
  const input = await searchFor('same');
  const result = () =>
    container.querySelector<HTMLButtonElement>('[data-finder-path="right/same.txt"]');
  await vi.waitFor(() => expect(result()).not.toBeNull());
  expect(container.querySelector('[role=tree]')).toBeNull();
  expect(request.mock.calls.filter((c) => c[0] === 'search.fileNames').map((c) => c[1])).toEqual([
    { workspaceId: ws, pattern: 'same', limit: 100 },
  ]);
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
  });
  expect(document.activeElement).toBe(result());
  await act(async () => result()!.click());
  await vi.waitFor(() =>
    expect(container.querySelector('[data-opened]')?.getAttribute('data-opened')).toBe(
      'right/same.txt',
    ),
  );
  await act(async () => container.querySelector<HTMLAnchorElement>('a')!.click());
  await vi.waitFor(() => expect(document.activeElement).toBe(result()));
  expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('same');
  await searchFor('');
  await vi.waitFor(() => expect(row('nested/deeper')).not.toBeNull());
  expect(row('nested').getAttribute('aria-expanded')).toBe('true');
  expect(request.mock.calls.filter((c) => c[0] === 'search.fileNames')).toHaveLength(1);
});

it('never opens prior results while a newer query is pending and rejects an escaped result', async () => {
  await searchFor('same');
  await vi.waitFor(() => expect(container.querySelector('[data-finder-path]')).not.toBeNull());
  let finish!: (value: unknown) => void;
  request.mockImplementation((_method, _params, options) => {
    options?.onDispatch?.();
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const oldResult = container.querySelector<HTMLButtonElement>('[data-finder-path]')!;
  await searchFor('newer');
  await act(async () => oldResult.click());
  expect(container.querySelector('[data-opened]')).toBeNull();
  await vi.waitFor(() => expect(container.querySelector('[data-finder-path]')).toBeNull());
  await vi.waitFor(() => expect(finish).toBeDefined());
  await act(async () =>
    finish({ files: ['../escaped.txt'], truncated: false, requestId: 'unsafe' }),
  );
  await vi.waitFor(() => expect(container.querySelector('[role=alert]')).not.toBeNull());
  expect(container.querySelector('[data-finder-path]')).toBeNull();
  expect(container.querySelector('[data-opened]')).toBeNull();
});

it('retires pending search on release and leaves no search state or late result after unmount', async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementation((_method, _params, options) => {
    options?.onDispatch?.();
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await searchFor('held');
  await vi.waitFor(() => expect(finish).toBeDefined());
  await act(async () => root.unmount());
  await act(async () => finish({ files: ['late.txt'], truncated: false, requestId: 'late' }));
  expect(Object.keys(store.state.fileExplorer.searches.map)).toHaveLength(0);
  root = createRoot(container);
});

it('keeps a returned row anchored through sibling layout changes, then yields to user scrolling and disposes', async () => {
  const Native = globalThis.ResizeObserver;
  const observed: {
    callback: ResizeObserverCallback;
    disconnected: boolean;
    targets: Element[];
  }[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class extends Native {
      record: (typeof observed)[number];
      constructor(callback: ResizeObserverCallback) {
        super(callback);
        this.record = { callback, disconnected: false, targets: [] };
        observed.push(this.record);
      }
      observe(target: Element) {
        this.record.targets.push(target);
        super.observe(target);
      }
      disconnect() {
        this.record.disconnected = true;
        super.disconnect();
      }
    },
  );
  await searchFor('same');
  const result = () =>
    container.querySelector<HTMLButtonElement>('[data-finder-path="right/same.txt"]')!;
  await vi.waitFor(() => expect(result()).not.toBeNull());
  await act(async () => result().click());
  await vi.waitFor(() => expect(container.querySelector('[data-opened]')).not.toBeNull());
  await act(async () => container.querySelector<HTMLAnchorElement>('a')!.click());
  await vi.waitFor(() => expect(document.activeElement).toBe(result()));
  const anchor = observed.find((record) => record.targets.includes(document.body))!;
  expect(anchor).toBeDefined();
  vi.spyOn(result(), 'getBoundingClientRect').mockReturnValue({ y: 122 } as DOMRect);
  vi.mocked(window.scrollBy).mockClear();
  await act(async () => anchor.callback([], {} as ResizeObserver));
  expect(window.scrollBy).toHaveBeenCalledWith({ top: 122, behavior: 'instant' });
  await act(async () => window.dispatchEvent(new WheelEvent('wheel')));
  expect(anchor.disconnected).toBe(true);
  vi.mocked(window.scrollBy).mockClear();
  await act(async () => anchor.callback([], {} as ResizeObserver));
  expect(window.scrollBy).not.toHaveBeenCalled();
});
