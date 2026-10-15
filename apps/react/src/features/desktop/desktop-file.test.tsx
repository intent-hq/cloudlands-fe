import { desktopFilePruneSaga } from '@/store/files/sagas/desktop-file-prune-saga';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { DesktopFile } from './desktop-file';
import { openDesktopFile, openDesktopFileLink } from './desktop-file-open';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { workspaceMounted } from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { loadFileContentSucceeded } from '../../../../../src/store/renderer/slices/files/files-slice';
import { openWorkspaceTab } from '../../../../../src/store/renderer/slices/tab-state/tab-state-slice';
import {
  openTab,
  resetLayout,
  closeTab,
} from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-slice';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { selectDesktopLayout } from '@/store/desktop/desktop-selectors';
import { selectFileContentEntry, selectFileSaveState } from '@/store/files/files-selectors';
import { filesSaveSaga } from '@/store/files/sagas/files-save-saga';
import { desktopFilesAutosaveSaga } from '@/store/files/sagas/desktop-files-autosave-saga';
import type { Workspace } from '$shared/types';
const ports = vi.hoisted(() => ({ props: null as any, request: vi.fn() }));
vi.mock('@/components/editor/code-editor', () => ({
  CodeEditor: (props: unknown) => {
    ports.props = props;
    return null;
  },
}));
vi.mock('@/features/backend/backend-transport', () => ({ backendRequest: ports.request }));
const ws = 'desktop-file-owned',
  path = 'src/a.ts',
  absolute = '/owned/src/a.ts';
let dispose: () => void,
  stopSave: () => void,
  stopAuto: () => void,
  stopPrune: () => void,
  root: ReturnType<typeof createRoot>,
  host: HTMLDivElement,
  panelId: string,
  tabId: string;
const writes: unknown[] = [];
const workspace = (root = '/owned', role = 'owner') =>
  ({ id: ws, worktreePath: root, myRole: role }) as Workspace;
const entry = () => selectFileContentEntry.select(store.state, ws, path);
const render = () =>
  act(async () =>
    root.render(
      <DesktopFile
        workspaceId={ws}
        path={path}
        panelId={panelId}
        tabId={tabId}
        active
        onUnavailable={() => {}}
      />,
    ),
  );
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(setWorkspaceEntity(workspace()));
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  store.dispatch(workspaceMounted(ws));
  store.dispatch(openWorkspaceTab(ws));
  store.dispatch(resetLayout(ws));
  panelId = selectDesktopLayout.select(store.state, ws).focusedPanelId!;
  store.dispatch(
    openTab(
      ws,
      { type: 'file', workspaceId: ws, filePath: path, title: 'a.ts', closable: true },
      panelId,
    ),
  );
  tabId = selectDesktopLayout.select(store.state, ws).panels[panelId].activeTabId!;
  store.dispatch(
    loadFileContentSucceeded(
      ws,
      path,
      absolute,
      { kind: 'editable-text', content: 'original\n' },
      false,
    ),
  );
  writes.length = 0;
  ports.request.mockReset().mockImplementation(async (method, params, options) => {
    options?.onDispatch?.();
    if (method === 'file.write') {
      writes.push(params);
      return { ok: true };
    }
    return { lockedAgentIds: [], lockedFilePaths: [] };
  });
  stopSave = store.runSaga(filesSaveSaga);
  stopAuto = store.runSaga(desktopFilesAutosaveSaga);
  stopPrune = store.runSaga(desktopFilePruneSaga);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await render();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(async () => {
  await act(async () => root.unmount());
  stopPrune();
  stopAuto();
  stopSave();
  dispose();
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('autosaves the latest canonical bytes through the existing strict write owner', async () => {
  await act(async () => {
    ports.props.onChange('edited café\n');
    await vi.advanceTimersByTimeAsync(1600);
  });
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ workspaceId: ws, path, content: 'edited café\n' });
  expect(entry()?.originalContent).toBe('edited café\n');
});
it('manual save flushes once and cancels the pending autosave timer', async () => {
  await act(async () => {
    ports.props.onChange('manual\n');
    ports.props.onSave();
    await vi.advanceTimersByTimeAsync(1600);
  });
  expect(writes).toHaveLength(1);
  expect(entry()?.originalContent).toBe('manual\n');
});
it('pane close flushes its edited resource and does not replay its retired timer', async () => {
  await act(async () => ports.props.onChange('close\n'));
  await act(async () => {
    store.dispatch(closeTab(ws, tabId, panelId));
    root.render(null);
    await vi.advanceTimersByTimeAsync(1600);
  });
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ content: 'close\n' });
  expect(entry()).toBeUndefined();
});
it.each(['root', 'role'])(
  'retires autosave across same-turn %s ABA without adopting the dirty draft',
  async (kind) => {
    await act(async () => ports.props.onChange('retired\n'));
    await act(async () => {
      store.dispatch(
        setWorkspaceEntity(
          kind === 'root' ? workspace('/other') : workspace('/owned', 'collaborator'),
        ),
      );
      store.dispatch(setWorkspaceEntity(workspace()));
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(writes).toHaveLength(0);
    expect(entry()?.localContent).toBe('retired\n');
    expect(store.state.files.saveOperations, 'retirement receipt').toMatchObject({
      ids: [expect.any(String)],
    });
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    await render();
    expect(ports.props.readOnly).toBe(true);
  },
);
it('blocks a stale captured editor callback after canonical pane closure before React emission', async () => {
  const change = ports.props.onChange;
  store.dispatch(closeTab(ws, tabId, panelId));
  change('stale\n');
  expect(entry()).toBeUndefined();
  expect(writes).toHaveLength(0);
});
it('retains unknown receipts after departure and never automatically replays them', async () => {
  ports.request.mockImplementation(async (method, params, options) => {
    options?.onDispatch?.();
    if (method === 'file.write') {
      writes.push(params);
      throw new Error('lost receipt');
    }
    return { lockedAgentIds: [], lockedFilePaths: [] };
  });
  await act(async () => {
    ports.props.onChange('unknown\n');
    await vi.advanceTimersByTimeAsync(1600);
  });
  expect(selectFileSaveState.select(store.state, ws, path).uncertain).toBe(true);
  await act(async () => {
    store.dispatch(closeTab(ws, tabId, panelId));
    root.render(null);
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(writes).toHaveLength(1);
});
it('opens the source line-suffix target through canonical panel placement and rejects outside paths', () => {
  expect(openDesktopFile(ws, 'src/a.ts:12', () => true, { sourcePanelId: panelId })).toBe(true);
  const layout = selectDesktopLayout.select(store.state, ws);
  const tab = layout.panels[panelId].tabs.find((t) => t.id === layout.panels[panelId].activeTabId)!;
  expect(tab.filePath).toBe(path);
  expect(tab.data?.line).toBe(12);
  expect(openDesktopFile(ws, '/else/a.ts', () => true)).toBe(false);
  expect(openDesktopFile(ws, '../a.ts', () => true)).toBe(false);
  expect(openDesktopFile(ws, path, () => false)).toBe(false);
});

it('decodes the genuine Markdown anchor through the source path policy', () => {
  expect(
    openDesktopFileLink(
      ws,
      'http://localhost/workspace/src/a.ts:12',
      { rawHref: 'src/a.ts:12', sourcePanelId: panelId },
      () => true,
    ),
  ).toBe(true);
  const layout = selectDesktopLayout.select(store.state, ws);
  const tab = layout.panels[panelId].tabs.find((t) => t.id === layout.panels[panelId].activeTabId)!;
  expect(tab.filePath).toBe(path);
  expect(tab.data?.line).toBe(12);
  expect(openDesktopFileLink(ws, 'file:///else/a.ts', {}, () => true)).toBe(false);
  expect(
    openDesktopFileLink(ws, 'http://localhost/%2e%2e/a.ts', { rawHref: '%2e%2e/a.ts' }, () => true),
  ).toBe(false);
});
it('holds newer close-flush bytes behind an earlier transport and prunes only after both settle', async () => {
  const releases: Array<() => void> = [];
  ports.request.mockImplementation(async (method, params, options) => {
    options?.onDispatch?.();
    if (method === 'file.write') {
      writes.push(params);
      await new Promise<void>((resolve) => releases.push(resolve));
      return { ok: true };
    }
    return { lockedAgentIds: [], lockedFilePaths: [] };
  });
  await act(async () => {
    ports.props.onChange('first\n');
    await vi.advanceTimersByTimeAsync(1600);
  });
  expect(writes).toHaveLength(1);
  await act(async () => {
    ports.props.onChange('newer close\n');
    store.dispatch(closeTab(ws, tabId, panelId));
    root.render(null);
  });
  expect(entry()?.localContent).toBe('newer close\n');
  expect(writes).toHaveLength(1);
  await act(async () => {
    releases[0]();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(writes).toHaveLength(2);
  expect(writes[1]).toMatchObject({ content: 'newer close\n' });
  expect(entry()?.originalContent).toBe('first\n');
  await act(async () => {
    releases[1]();
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(entry()).toBeUndefined();
  expect(writes).toHaveLength(2);
});

it('reopens a known failed draft visibly and retries only on deliberate user activation', async () => {
  ports.request.mockImplementation(async (method, params, options) => {
    options?.onDispatch?.();
    if (method === 'file.write') {
      writes.push(params);
      throw Object.assign(new Error('owned failure'), { rpcCode: -32000 });
    }
    return { lockedAgentIds: [], lockedFilePaths: [] };
  });
  await act(async () => {
    ports.props.onChange('failed draft\n');
    ports.props.onSave();
    await vi.advanceTimersByTimeAsync(1600);
  });
  expect(writes).toHaveLength(1);
  await act(async () => {
    store.dispatch(closeTab(ws, tabId, panelId));
    root.render(null);
  });
  // A settled failure is not automatically re-sent by close cleanup.
  expect(writes).toHaveLength(1);
  await act(async () => {
    store.dispatch(
      openTab(
        ws,
        { type: 'file', workspaceId: ws, filePath: path, title: 'a.ts', closable: true },
        panelId,
      ),
    );
    tabId = selectDesktopLayout.select(store.state, ws).panels[panelId].activeTabId!;
  });
  await render();
  expect(ports.props.value).toBe('failed draft\n');
  expect(host.textContent).toContain('owned failure');
  expect(writes).toHaveLength(1);
  ports.request.mockImplementation(async (method, params, options) => {
    options?.onDispatch?.();
    if (method === 'file.write') {
      writes.push(params);
      return { ok: true };
    }
    return { lockedAgentIds: [], lockedFilePaths: [] };
  });
  await act(async () => {
    host.querySelector('button')!.click();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(writes).toHaveLength(2);
  expect(entry()?.originalContent).toBe('failed draft\n');
});
