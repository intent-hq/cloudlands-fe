import { desktopFilePruneSaga } from '@/store/files/sagas/desktop-file-prune-saga';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { DesktopFile, DesktopFileMenu } from './desktop-file';
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
import { m } from '$shared/paraglide/messages.js';
const ports = vi.hoisted(() => ({
  props: null as any,
  request: vi.fn(),
  menus: [] as any[],
  commands: [] as any[],
}));
vi.mock('@/components/editor/code-editor', () => ({
  CodeEditor: (props: unknown) => {
    ports.props = props;
    return null;
  },
}));
vi.mock('@/components/ui/menu', () => ({
  CommandItem: (props: any) => {
    ports.commands.push(props);
    return null;
  },
  Separator: () => null,
  Label: () => null,
  Item: () => null,
  Group: ({ children }: any) => children,
  Sub: () => null,
  SubTrigger: () => null,
  SubContent: () => null,
  CheckboxItem: (props: any) => {
    ports.menus.push(props);
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

import { selectLineWrapping } from '@/store/ui-layout/ui-layout-selectors';
import { principalIdentityChanged } from '../../../../../src/store/renderer/slices/principal/principal-slice';
const tick = () => vi.advanceTimersByTimeAsync(0);
const reopen = async () => {
  store.dispatch(
    openTab(
      ws,
      { type: 'file', workspaceId: ws, filePath: path, title: 'a.ts', closable: true },
      panelId,
    ),
  );
  panelId = selectDesktopLayout.select(store.state, ws).focusedPanelId!;
  tabId = selectDesktopLayout.select(store.state, ws).panels[panelId].activeTabId!;
  await render();
};
it('retains newest pending close-flush through reopen and only prunes after the final close', async () => {
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
  try {
    await act(async () => {
      ports.props.onChange('first\n');
      ports.props.onSave();
      await tick();
    });
    await act(async () => {
      ports.props.onChange('newest\n');
      store.dispatch(closeTab(ws, tabId, panelId));
      root.render(null);
    });
    await reopen();
    expect(ports.props.value).toBe('newest\n');
    expect(writes).toHaveLength(1);
    await act(async () => {
      releases[0]();
      await tick();
    });
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({ workspaceId: ws, path, content: 'newest\n' });
    expect(entry()?.originalContent).toBe('first\n');
    await act(async () => {
      releases[1]();
      await tick();
    });
    expect(entry()?.originalContent).toBe('newest\n');
    expect(entry()?.localContent).toBe('newest\n');
    await act(async () => {
      store.dispatch(closeTab(ws, tabId, panelId));
      root.render(null);
    });
    expect(entry()).toBeUndefined();
  } finally {
    releases.forEach((release) => release());
    await tick();
  }
});
it('reopens unknown text read-only without an automatic or manual resend', async () => {
  ports.request.mockImplementation(async (method, params, options) => {
    options?.onDispatch?.();
    if (method === 'file.write') {
      writes.push(params);
      throw new Error('unknown transport');
    }
    return { lockedAgentIds: [], lockedFilePaths: [] };
  });
  await act(async () => {
    ports.props.onChange('unknown\n');
    ports.props.onSave();
    await tick();
  });
  await act(async () => {
    store.dispatch(closeTab(ws, tabId, panelId));
    root.render(null);
  });
  await reopen();
  expect(ports.props.value).toBe('unknown\n');
  expect(ports.props.readOnly).toBe(true);
  await act(async () => {
    ports.props.onSave();
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(writes).toHaveLength(1);
  expect(selectFileSaveState.select(store.state, ws, path).uncertain).toBe(true);
});
it.each(['root', 'role'])('retires the queued newer save after same-turn %s ABA', async (kind) => {
  let release: (() => void) | undefined;
  ports.request.mockImplementation(async (method, params, options) => {
    options?.onDispatch?.();
    if (method === 'file.write') {
      writes.push(params);
      if (writes.length === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return { ok: true };
    }
    return { lockedAgentIds: [], lockedFilePaths: [] };
  });
  try {
    await act(async () => {
      ports.props.onChange('first\n');
      ports.props.onSave();
      await tick();
    });
    await act(async () => {
      ports.props.onChange('newer queued\n');
      ports.props.onSave();
      await tick();
    });
    expect(writes).toHaveLength(1);
    await act(async () => {
      store.dispatch(
        setWorkspaceEntity(
          kind === 'root' ? workspace('/else') : workspace('/owned', 'collaborator'),
        ),
      );
      store.dispatch(setWorkspaceEntity(workspace()));
      release!();
      await tick();
    });
    expect(
      writes,
      'the original dispatch may settle, but the old queued request must never dispatch after retirement',
    ).toHaveLength(1);
    expect(entry()?.localContent).toBe('newer queued\n');
  } finally {
    release?.();
    await tick();
  }
});
it('rechecks a retired root at the delayed final transport dispatch', async () => {
  let release: (() => void) | undefined;
  ports.request.mockImplementation(async (method, params, options) => {
    if (method === 'file.write') {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      options?.onDispatch?.();
      writes.push(params);
      return { ok: true };
    }
    options?.onDispatch?.();
    return { lockedAgentIds: [], lockedFilePaths: [] };
  });
  try {
    await act(async () => {
      ports.props.onChange('held dispatch\n');
      ports.props.onSave();
      await tick();
    });
    expect(release).toBeTypeOf('function');
    await act(async () => {
      store.dispatch(setWorkspaceEntity(workspace('/else')));
      store.dispatch(setWorkspaceEntity(workspace()));
      release!();
      await tick();
    });
    expect(writes).toHaveLength(0);
  } finally {
    release?.();
    await tick();
  }
});
it('blocks final dispatch when principal invalidation changes the original authority', async () => {
  let release: (() => void) | undefined;
  ports.request.mockImplementation(async (method, params, options) => {
    if (method === 'file.write') {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      options?.onDispatch?.();
      writes.push(params);
      return { ok: true };
    }
    options?.onDispatch?.();
    return { lockedAgentIds: [], lockedFilePaths: [] };
  });
  try {
    await act(async () => {
      ports.props.onChange('principal draft\n');
      ports.props.onSave();
      await tick();
    });
    await act(async () => {
      store.dispatch(principalIdentityChanged('principal'));
      release!();
      await tick();
    });
    expect(writes).toHaveLength(0);
  } finally {
    release?.();
    await tick();
  }
});
it('ignores a captured file menu callback after the primary root changed before React emission', async () => {
  ports.menus = [];
  await act(async () =>
    root.render(
      <DesktopFileMenu
        workspaceId={ws}
        path={path}
        panelId={panelId}
        tabId={tabId}
        active
        preview={false}
        onPreview={() => {}}
        onUnavailable={() => {}}
      />,
    ),
  );
  const callback = ports.menus.findLast(
    (item) => item.children === m.ui_viewSettings_wrapLines_label(),
  ).onCheckedChange;
  const before = selectLineWrapping.select(store.state);
  store.dispatch(setWorkspaceEntity(workspace('/else')));
  callback();
  expect(selectLineWrapping.select(store.state)).toBe(before);
});
it('preserves edit ownership across unrelated workspace metadata updates', async () => {
  await act(async () => ports.props.onChange('metadata draft\n'));
  await act(async () =>
    store.dispatch(setWorkspaceEntity({ ...workspace(), statusMessage: 'new status' })),
  );
  await render();
  expect(
    ports.props.readOnly,
    'same authority, root, file and pane must keep the draft editable',
  ).toBe(false);
  await act(async () => {
    store.dispatch(closeTab(ws, tabId, panelId));
    root.render(null);
    await tick();
  });
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ content: 'metadata draft\n' });
});

it('admits a current menu action and permanently retires it across root ABA', async () => {
  ports.menus = [];
  await act(async () =>
    root.render(
      <DesktopFileMenu
        workspaceId={ws}
        path={path}
        panelId={panelId}
        tabId={tabId}
        active
        preview={false}
        onPreview={() => {}}
        onUnavailable={() => {}}
      />,
    ),
  );
  const callback = ports.menus.findLast(
    (item) => item.children === m.ui_viewSettings_wrapLines_label(),
  ).onCheckedChange;
  const before = selectLineWrapping.select(store.state);
  callback();
  expect(selectLineWrapping.select(store.state)).toBe(!before);
  store.dispatch(setWorkspaceEntity(workspace('/else')));
  store.dispatch(setWorkspaceEntity(workspace()));
  callback();
  expect(selectLineWrapping.select(store.state)).toBe(!before);
});

it('keeps source file actions visible and reports their unported scope without a mutation', async () => {
  ports.commands = [];
  const unavailable = vi.fn();
  await act(async () =>
    root.render(
      <DesktopFileMenu
        workspaceId={ws}
        path={path}
        panelId={panelId}
        tabId={tabId}
        active
        preview={false}
        onPreview={() => {}}
        onUnavailable={unavailable}
      />,
    ),
  );
  const actions = [
    m.workspace_notes_rename_label(),
    m.layout_fileTab_goToChanges_tooltip(),
    m.layout_fileTab_downloadFile_label(),
    m.layout_fileTab_deleteFile_tooltip(),
  ].map((label) => ports.commands.findLast((item) => item.label === label));
  expect(actions.every(Boolean)).toBe(true);
  for (const action of actions) action.onSelect();
  expect(unavailable.mock.calls.map(([label]) => label)).toEqual(
    actions.map((action) => action.label),
  );
  expect(writes).toEqual([]);
  store.dispatch(setWorkspaceEntity(workspace('/other')));
  store.dispatch(setWorkspaceEntity(workspace()));
  for (const action of actions) action.onSelect();
  expect(unavailable).toHaveBeenCalledTimes(actions.length);
});
