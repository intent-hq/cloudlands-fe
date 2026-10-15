import { m } from '$shared/paraglide/messages.js';
import { setGitStatus } from '../../../../../src/store/renderer/slices/git/git-slice';
import { principalContextChanged } from '../../../../../src/store/renderer/slices/principal/principal-slice';
import { fileExplorerSaga } from '@/store/file-explorer/sagas/file-explorer-saga';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { DesktopFiles } from './desktop-files';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { workspaceMounted } from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { openWorkspaceTab } from '../../../../../src/store/renderer/slices/tab-state/tab-state-slice';
import { resetLayout } from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-slice';
import {
  setRootNode,
  setFileExplorerWorkspacePath,
  setFileExplorerInitialized,
  addExpandedPath,
} from '../../../../../src/store/renderer/slices/file-explorer/file-explorer-slice';
import { selectDesktopLayout } from '@/store/desktop/desktop-selectors';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { WorkspaceId } from '$shared/types/branded-ids';
import { GitFileStatus, type Workspace, type FileNode } from '$shared/types';
const ui = vi.hoisted(() => ({ rows: new Map<string, any>(), search: undefined as any }));
vi.mock('@/components/ui/list', async (original) => {
  const actual = await original<typeof import('@/components/ui/list')>();
  return {
    ...actual,
    ListItem: (props: any) => {
      ui.rows.set(props.title, props);
      return <actual.ListItem {...props} />;
    },
  };
});
const request = vi.hoisted(() => vi.fn());
vi.mock('@/features/backend/backend-transport', () => ({ backendRequest: request }));
vi.mock('@/components/workspace/sidebar/expandable-file-search', async (original) => {
  const actual =
    await original<typeof import('@/components/workspace/sidebar/expandable-file-search')>();
  return {
    ExpandableFileSearch: (props: any) => {
      ui.search = props;
      return <actual.ExpandableFileSearch {...props} />;
    },
  };
});
const ws = WorkspaceId('desktop-tree-host'),
  other = WorkspaceId('other');
const workspace = {
  id: ws,
  title: 'Tree',
  myRole: 'owner',
  canManage: true,
  repositoryPath: '/owned/repo',
} as Workspace;
let dispose: () => void, root: ReturnType<typeof createRoot>, host: HTMLDivElement;
const unavailable = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(setWorkspaceEntity(workspace));
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  store.dispatch(workspaceMounted(ws));
  store.dispatch(resetLayout(ws));
  store.dispatch(openWorkspaceTab(ws));
  store.dispatch(setFileExplorerWorkspacePath(ws, '/owned/repo'));
  store.dispatch(
    setRootNode(ws, {
      name: 'repo',
      path: '/owned/repo',
      type: 'directory',
      children: [
        {
          name: 'src',
          path: '/owned/repo/src',
          type: 'directory',
          children: [{ name: 'main.ts', path: '/owned/repo/src/main.ts', type: 'file' }],
        },
        { name: 'readme.txt', path: '/owned/repo/readme.txt', type: 'file' },
      ],
    } as FileNode),
  );
  store.dispatch(addExpandedPath(ws, '/owned/repo'));
  store.dispatch(addExpandedPath(ws, '/owned/repo/src'));
  store.dispatch(setFileExplorerInitialized(ws, true));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  ui.rows.clear();
  unavailable.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  dispose();
  vi.unstubAllGlobals();
});
const render = (active = true, visible = true) =>
  act(async () =>
    root.render(
      <DesktopFiles
        workspaceId={ws}
        active={active}
        visible={visible}
        onClose={() => {}}
        onUnavailable={unavailable}
      />,
    ),
  );
const tabs = () =>
  Object.values(selectDesktopLayout.select(store.state, ws).panels).flatMap((p) => p.tabs);
const event = { metaKey: false, ctrlKey: false };
async function click(name = 'main.ts') {
  await act(async () => ui.rows.get(name).onClick(event));
}
async function key(value: string, extra: KeyboardEventInit = {}) {
  await act(async () =>
    host
      .querySelector('[role=tree]')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra }),
      ),
  );
}
it('opens the genuine canonical path and uses adjacent placement on modifier click', async () => {
  await render();
  await click();
  expect(tabs().some((t) => t.filePath === 'src/main.ts')).toBe(true);
  await act(async () => ui.rows.get('readme.txt').onClick({ ...event, ctrlKey: true }));
  expect(Object.keys(selectDesktopLayout.select(store.state, ws).panels)).toHaveLength(2);
});
it('tree Enter discloses Rename while Space and Right retain source open semantics', async () => {
  await render();
  await key('End');
  await key('Enter');
  expect(unavailable).toHaveBeenCalledWith('Rename');
  expect(tabs().some((t) => t.type === 'file')).toBe(false);
  await key(' ');
  expect(tabs().some((t) => t.filePath === 'readme.txt')).toBe(true);
});
it('Ctrl-Enter opens rather than invoking Rename', async () => {
  await render();
  await key('End');
  await key('Enter', { ctrlKey: true });
  expect(unavailable).not.toHaveBeenCalled();
  expect(tabs().some((t) => t.filePath === 'readme.txt')).toBe(true);
});
it.each(['park', 'hide', 'unmount', 'workspace', 'root'] as const)(
  'rejects captured row after %s retirement',
  async (kind) => {
    await render();
    const callback = ui.rows.get('main.ts').onClick;
    if (kind === 'park') await render(false);
    if (kind === 'hide') await render(true, false);
    if (kind === 'unmount') await act(async () => root.render(null));
    await act(async () => {
      if (kind === 'workspace') store.dispatch(openWorkspaceTab(other));
      if (kind === 'root')
        store.dispatch(setWorkspaceEntity({ ...workspace, repositoryPath: '/other' }));
      callback(event);
    });
    expect(tabs().some((t) => t.type === 'file')).toBe(false);
  },
);
it('preserves canonical expanded nodes while hidden and reopens without a second cache', async () => {
  await render();
  const nodes = store.state.fileExplorer.byWorkspaceId[ws].nodes;
  await render(false, false);
  expect(store.state.fileExplorer.byWorkspaceId[ws].nodes).toBe(nodes);
  await render();
  expect(ui.rows.has('main.ts')).toBe(true);
});
it('rejects a captured row removed from the canonical tree before React rerenders', async () => {
  await render();
  const callback = ui.rows.get('main.ts').onClick;
  await act(async () => {
    store.dispatch(
      setRootNode(ws, { name: 'repo', path: '/owned/repo', type: 'directory', children: [] }),
    );
    callback(event);
  });
  expect(tabs().some((t) => t.type === 'file')).toBe(false);
});

it.each(['root', 'role', 'workspace'] as const)(
  'permanently rejects old row after same-turn %s ABA',
  async (kind) => {
    await render();
    const callback = ui.rows.get('main.ts').onClick;
    await act(async () => {
      if (kind === 'workspace') {
        store.dispatch(openWorkspaceTab(other));
        store.dispatch(openWorkspaceTab(ws));
      } else {
        store.dispatch(
          setWorkspaceEntity({
            ...workspace,
            ...(kind === 'root'
              ? { repositoryPath: '/other' }
              : { myRole: 'viewer', canManage: false }),
          } as Workspace),
        );
        store.dispatch(setWorkspaceEntity(workspace));
      }
      callback(event);
    });
    expect(tabs().some((t) => t.type === 'file')).toBe(false);
  },
);

it('passes captured context through actual strict search admission and preserves empty-input caret keys', async () => {
  request.mockReset().mockImplementation(async (method, params, options) => {
    options?.onDispatch?.();
    if (method === 'search.fileNames')
      return { files: ['src/main.ts'], requestId: 'owned-search', truncated: false };
    throw Error(method);
  });
  const stop = store.runSaga(function* () {
    yield* fileExplorerSaga('desktop');
  });
  try {
    await render();
    await act(async () => ui.search.onQueryChange('main'));
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        'search.fileNames',
        { workspaceId: ws, pattern: 'main', limit: 100 },
        expect.anything(),
      ),
    );
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('main.ts'));
    });
    await act(async () =>
      ui.search.onKeydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })),
    );
    expect(tabs().some((t) => t.filePath === 'src/main.ts')).toBe(true);
    await act(async () => ui.search.onQueryChange(''));
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End', ' ']) {
      const event = new KeyboardEvent('keydown', { key, cancelable: true });
      ui.search.onKeydown(event);
      expect(event.defaultPrevented).toBe(false);
    }
  } finally {
    stop();
  }
});

function startSearch(paths: string[]) {
  request.mockReset().mockImplementation(async (method, params, options) => {
    options?.onDispatch?.();
    if (method === 'search.fileNames')
      return { files: paths, requestId: 'review-search', truncated: false };
    if (method === 'file.list') return [{ name: 'readme.txt', type: 'file' }];
    throw Error(method);
  });
  return store.runSaga(function* () {
    yield* fileExplorerSaga('desktop');
  });
}
async function searchKey(value: string) {
  await act(async () =>
    ui.search.onKeydown(new KeyboardEvent('keydown', { key: value, cancelable: true })),
  );
}
async function searchFor(value: string) {
  await act(async () => ui.search.onQueryChange(value));
  await act(async () => {
    await vi.waitFor(() =>
      expect(host.querySelector('.desktop-files-search-results')).not.toBeNull(),
    );
  });
}
it('filtering search resets navigation to the first surviving source result', async () => {
  const stop = startSearch(['src/main.ts', 'readme.txt', 'last.txt']);
  try {
    store.dispatch(
      setGitStatus(ws, {
        branch: 'main',
        ahead: 0,
        behind: 0,
        diverged: false,
        hasUncommittedChanges: true,
        hasUntrackedFiles: false,
        files: [{ path: 'src/main.ts', status: GitFileStatus.Modified, staged: false }],
      }),
    );
    await render();
    await searchFor('t');
    await searchKey('ArrowDown');
    await searchKey('ArrowDown');
    const button = host.querySelector(
      `[aria-label="${m.workspace_multiSelectSidebar_showOnlyChangedFiles_tooltip()}"]`,
    )!;
    await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await searchKey('Enter');
    expect(
      tabs()
        .filter((t) => t.type === 'file')
        .map((t) => t.filePath),
    ).toEqual(['src/main.ts']);
  } finally {
    stop();
  }
});
it('search arrow navigation asks the browser to reveal the selected result', async () => {
  const stop = startSearch(Array.from({ length: 40 }, (_, i) => `file${i}.txt`));
  const previous = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  const reveal = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: reveal });
  try {
    await render();
    await searchFor('file');
    reveal.mockClear();
    await searchKey('ArrowDown');
    expect(reveal).toHaveBeenCalledWith({ block: 'nearest' });
  } finally {
    if (previous) Object.defineProperty(Element.prototype, 'scrollIntoView', previous);
    else delete (Element.prototype as any).scrollIntoView;
    stop();
  }
});
it('a captured row is revoked when principal admission changes before render', async () => {
  const error = vi.spyOn(console, 'error');
  try {
    await render();
    const old = ui.rows.get('main.ts').onClick;
    await act(async () => {
      store.dispatch(principalContextChanged('review-principal'));
      old(event);
    });
    expect(tabs().some((t) => t.type === 'file')).toBe(false);
    expect(
      error.mock.calls.flat().some((value) => String(value).includes('Maximum update depth')),
    ).toBe(false);
  } finally {
    error.mockRestore();
  }
});
