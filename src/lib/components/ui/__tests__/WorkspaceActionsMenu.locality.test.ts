/**
 * WorkspaceActionsMenu locality gating (monorepo#883, monorepo#2171).
 *
 * "Choose app" shows a LOCAL app picker against a workspace file path, so the
 * editors block (editor list + "Choose app") must disappear when the daemon
 * is remote (monorepo#883) — or when the workspace checkout itself is remote
 * even though the daemon is local (monorepo#2171) — while locality-safe copy
 * actions stay.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { StoreState } from '$store/renderer/types';
import type { InstalledEditor } from '$store/renderer/slices/external-editors/external-editors-slice';
import type { BackendTransportInfo } from '$store/renderer/slices/daemon-health/daemon-health-types';
import type { Workspace } from '$shared/types';
import { requestArchiveWorkspace } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';
import { toNativePath } from '$lib/utils/path-utils';
import { warmImport } from '../../../../test/warm-import';

let mockStoreState: Partial<StoreState> = {};
const mockDispatch = vi.fn();
const electronBridgeMocks = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  canOpenExternalEditors: true,
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  return {
    get store() {
      return createAppStoreMock({
        state: () => mockStoreState,
        dispatch: mockDispatch,
      });
    },
  };
});

// Electron build: the capability alone must NOT keep "Choose app" visible.
vi.mock('$lib/utils/platform-capabilities', () => ({
  hasCapability: () => electronBridgeMocks.canOpenExternalEditors,
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('$store/renderer/slices/workspace/workspace-selectors')>();
  const { derived, readable } = await import('svelte/store');
  return {
    ...original,
    selectHidesOwnerWorkspaceActions: () => readable(false),
    selectWorkspaceById: (id: import('svelte/store').Readable<string>) =>
      derived(id, ($id) => original.selectWorkspaceById.select(mockStoreState as StoreState, $id)),
  };
});

beforeEach(() => {
  electronBridgeMocks.canOpenExternalEditors = true;
});

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('./mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('$lib/components/ui/button/button.svelte', async () => {
  const MockButton = (await import('./mocks/button.svelte')).default;
  return { default: MockButton };
});

vi.mock('$lib/electron-bridge', () => ({
  invoke: electronBridgeMocks.invoke,
  listenSync: vi.fn(() => () => {}),
}));

vi.mock('$lib/client', () => ({
  appClient: { git: { status: vi.fn() } },
}));

const mockEditors: InstalledEditor[] = [
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    shortLabel: 'VS Code',
    appName: 'Visual Studio Code',
    category: 'ide',
    handlerType: 'vscode',
    priority: 100,
    installed: true,
  },
];

const manyMockEditors: InstalledEditor[] = [
  ...mockEditors,
  ...(['cursor', 'zed', 'windsurf'].map((id, index) => ({
    id,
    name: id[0].toUpperCase() + id.slice(1),
    shortLabel: id,
    appName: id,
    category: 'ide' as const,
    handlerType: 'generic' as const,
    priority: 90 - index * 10,
    installed: true,
  })) as InstalledEditor[]),
  {
    id: 'finder',
    name: 'Finder',
    shortLabel: 'Finder',
    appName: 'Finder',
    category: 'finder',
    handlerType: 'finder',
    priority: 0,
    installed: true,
  },
  {
    id: 'hidden-editor',
    name: 'Hidden Editor',
    shortLabel: 'Hidden',
    appName: 'Hidden Editor',
    category: 'ide',
    handlerType: 'generic',
    priority: 60,
    installed: true,
  },
];

const mockWorkspaces = [
  { id: 'ws-local', title: 'Local workspace', worktreePath: '/tmp/project', status: 'active' },
  {
    id: 'ws-remote',
    title: 'Remote workspace',
    worktreePath: '/tmp/project',
    status: 'active',
    environmentConfig: { type: 'remote' },
  },
];

function makeState(
  transport: BackendTransportInfo | null,
  hostLocality: 'local' | 'remote' | null = null,
  editors: InstalledEditor[] = mockEditors,
  hiddenEditorIds: string[] = [],
  editorOrder: string[] = [],
): Partial<StoreState> {
  return {
    uiLayout: { sidebarSide: 'left' },
    externalEditors: {
      selectedAction: 'vscode',
      editors: createCollection<InstalledEditor, 'id'>('id', editors),
      editorOrder,
      hiddenEditorIds,
      loading: false,
      error: null,
      lastFetched: 0,
    },
    daemonHealth: { transport, hostLocality },
    workspace: {
      workspaces: createCollection('id', mockWorkspaces),
    },
    git: { byWorkspaceId: {} },
    workspaceTasks: { byWorkspaceId: {} },
    workspaceNotes: { byWorkspaceId: {} },
    workspaceAgents: { byWorkspaceId: {} },
    panelLayout: { byWorkspaceId: {} },
    presence: { ownPrincipalId: null, rosters: {} },
    tokenUsage: { byWorkspaceId: {} },
  } as unknown as Partial<StoreState>;
}

async function renderMenu(workspaceId = '') {
  const WorkspaceActionsMenu = (
    await import('$features/workspace/components/WorkspaceActionsMenu.svelte')
  ).default;
  const { container } = render(WorkspaceActionsMenu, {
    props: { filePath: '/tmp/project', workspaceId, showFileActions: true },
  });
  await waitFor(() => {
    expect(container.textContent).toContain('Copy Absolute Path');
  });
  return container;
}

function openInLabels(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLSpanElement>('button span[title^="Open in "]'),
  ).map((label) => label.textContent?.trim() ?? '');
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('./mocks/Fa.svelte'));
warmImport(() => import('./mocks/button.svelte'));
warmImport(() => import('./mocks/WorkspaceActionsMenuSubmenuHarness.svelte'));
warmImport(() => import('$features/workspace/components/WorkspaceActionsMenu.svelte'));
warmImport(() => import('$lib/components/workspace/WorkspaceSidebarHeader.svelte'));
warmImport(() => import('$lib/components/workspace/sidebar/WorkspaceProgressCard.svelte'));

interface SubmenuProps {
  filePath?: string;
  workspaceId?: string;
  workspaceFolderPath?: string;
  isWorkspaceRoot?: boolean;
}

async function renderSubmenu(props: SubmenuProps = {}) {
  const Harness = (await import('./mocks/WorkspaceActionsMenuSubmenuHarness.svelte')).default;
  render(Harness, { props });
  await fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
  const trigger = await screen.findByRole('menuitem', { name: 'Open in...' });
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: 'ArrowRight' });
  await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'));
  return trigger;
}

describe('WorkspaceActionsMenu locality gating (monorepo#883)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the editors block and "Choose app" on a local daemon', async () => {
    mockStoreState = makeState({ mode: 'sidecar-uds' });
    const container = await renderMenu();

    expect(container.textContent).toContain('Open in Visual Studio Code');
    expect(container.textContent).toContain('Choose app');
  });

  it('hides "Choose app" (and the editors block) on a remote daemon (external-ws)', async () => {
    mockStoreState = makeState({ mode: 'external-ws' });
    const container = await renderMenu();

    expect(container.textContent).not.toContain('Choose app');
    expect(container.textContent).not.toContain('Open in');
    // Locality-safe copy actions stay available.
    expect(container.textContent).toContain('Copy Absolute Path');
    expect(container.textContent).toContain('Copy Relative Path');
  });

  it('honors BE-reported hostLocality=remote over a local transport', async () => {
    mockStoreState = makeState({ mode: 'sidecar-uds' }, 'remote');
    const container = await renderMenu();

    expect(container.textContent).not.toContain('Choose app');
    expect(container.textContent).toContain('Copy Absolute Path');
  });

  it('honors BE-reported hostLocality=local over a remote transport', async () => {
    // Forced server.locality override (§5.12/§5.14): a WS connection to a
    // daemon that reports itself local restores the editors block.
    mockStoreState = makeState({ mode: 'external-ws' }, 'local');
    const container = await renderMenu();

    expect(container.textContent).toContain('Open in Visual Studio Code');
    expect(container.textContent).toContain('Choose app');
  });

  it('shows every installed non-hidden editor on a local daemon', async () => {
    mockStoreState = makeState({ mode: 'sidecar-uds' }, null, manyMockEditors, ['hidden-editor']);
    const container = await renderMenu();

    expect(container.textContent).toContain('Open in Visual Studio Code');
    expect(container.textContent).toContain('Open in Cursor');
    expect(container.textContent).toContain('Open in Zed');
    expect(container.textContent).toContain('Open in Windsurf');
    expect(container.textContent).not.toContain('Open in Hidden Editor');
  });

  it('preserves selector-provided order when Finder is moved away from the end', async () => {
    mockStoreState = makeState(
      { mode: 'sidecar-uds' },
      null,
      manyMockEditors,
      ['hidden-editor'],
      ['finder', 'zed', 'vscode', 'windsurf', 'cursor', 'hidden-editor'],
    );
    const container = await renderMenu();

    expect(openInLabels(container)).toEqual([
      'Open in Finder',
      'Open in Zed',
      'Open in Visual Studio Code',
      'Open in Windsurf',
      'Open in Cursor',
    ]);
  });

  it('stacks editor and copy actions in an accessible submenu', async () => {
    mockStoreState = makeState({ mode: 'sidecar-uds' });
    const trigger = await renderSubmenu();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(
      await screen.findByRole('menuitem', { name: 'Open in Visual Studio Code' }),
    ).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Choose app' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Copy Absolute Path' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Copy Relative Path' })).toBeTruthy();
  });

  it('keeps copy actions in submenu mode when external editors are unavailable', async () => {
    mockStoreState = makeState({ mode: 'external-ws' });
    const Harness = (await import('./mocks/WorkspaceActionsMenuSubmenuHarness.svelte')).default;
    render(Harness);
    await fireEvent.click(screen.getByRole('button', { name: 'Actions' }));

    expect(screen.queryByRole('menuitem', { name: 'Open in...' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Choose app' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Open in Visual Studio Code' })).toBeNull();
    expect(await screen.findByRole('menuitem', { name: 'Copy Absolute Path' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Copy Relative Path' })).toBeTruthy();
  });

  it('resolves a workspace-root copy through the worktree path', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
    electronBridgeMocks.invoke.mockResolvedValue({
      success: true,
      data: { worktreePath: '/abs/wt' },
    });
    mockStoreState = makeState({ mode: 'sidecar-uds' });

    await renderSubmenu({
      workspaceId: 'ws-root',
      filePath: '.',
      isWorkspaceRoot: true,
      workspaceFolderPath: '__WORKSPACE_ROOT__',
    });
    await waitFor(() =>
      expect(electronBridgeMocks.invoke).toHaveBeenCalledWith('workspace:get', { id: 'ws-root' }),
    );
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Absolute Path' }));

    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(toNativePath('/abs/wt')));
  });

  it('dispatches a checked additional action once and blocks unavailable actions', async () => {
    mockStoreState = makeState({ mode: 'external-ws' });
    const checkedAction = vi.fn();
    const disabledAction = vi.fn();
    const Harness = (await import('./mocks/WorkspaceActionsMenuSubmenuHarness.svelte')).default;
    render(Harness, {
      props: {
        additionalActions: [
          { id: 'chosen', label: 'Chosen action', checked: true, onClick: checkedAction },
          {
            id: 'unavailable',
            label: 'Unavailable action',
            disabled: true,
            onClick: disabledAction,
          },
        ],
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    const unavailable = await screen.findByRole('menuitem', { name: 'Unavailable action' });
    await fireEvent.click(unavailable);
    expect(disabledAction).not.toHaveBeenCalled();
    const checked = screen.getByRole('menuitemcheckbox', { name: 'Chosen action' });
    expect(checked.getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(checked);
    expect(checkedAction).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('renders exclusive submenu choices as radios and keeps clear as a command', async () => {
    mockStoreState = makeState({ mode: 'external-ws' });
    const selectFirst = vi.fn();
    const selectSecond = vi.fn();
    const clear = vi.fn();
    const Harness = (await import('./mocks/WorkspaceActionsMenuSubmenuHarness.svelte')).default;
    render(Harness, {
      props: {
        additionalActions: [
          {
            id: 'shortcut',
            label: 'Shortcut',
            selection: 'single',
            onClick: vi.fn(),
            submenu: [
              { id: 'one', label: 'One', checked: true, onClick: selectFirst },
              { id: 'two', label: 'Two', checked: false, onClick: selectSecond },
              { id: 'clear', label: 'Clear', dividerBefore: true, onClick: clear },
            ],
          },
        ],
      },
    });
    const openChoices = async () => {
      await fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
      const trigger = await screen.findByRole('menuitem', { name: 'Shortcut' });
      trigger.focus();
      await fireEvent.keyDown(trigger, { key: 'ArrowRight' });
      return await screen.findByRole('menuitemradio', { name: 'Two' });
    };
    const second = await openChoices();
    expect(screen.getByRole('menuitemradio', { name: 'One' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(second.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Clear' }).getAttribute('aria-checked')).toBeNull();
    await fireEvent.click(second);
    expect(selectSecond).toHaveBeenCalledOnce();
    expect(selectFirst).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await openChoices();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Clear' }));
    expect(clear).toHaveBeenCalledOnce();
    expect(selectSecond).toHaveBeenCalledOnce();
  });

  it('falls back to the legacy workspace path for a workspace-root copy', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
    electronBridgeMocks.invoke.mockResolvedValue({
      success: true,
      data: { path: '/abs/legacy' },
    });
    mockStoreState = makeState({ mode: 'sidecar-uds' });

    await renderSubmenu({
      workspaceId: 'ws-legacy',
      filePath: '.',
      isWorkspaceRoot: true,
      workspaceFolderPath: '__WORKSPACE_ROOT__',
    });
    await waitFor(() =>
      expect(electronBridgeMocks.invoke).toHaveBeenCalledWith('workspace:get', { id: 'ws-legacy' }),
    );
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Absolute Path' }));

    await waitFor(() =>
      expect(clipboard.writeText).toHaveBeenCalledWith(toNativePath('/abs/legacy')),
    );
  });
});

describe('workspace sidebar Open in submenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronBridgeMocks.canOpenExternalEditors = true;
    electronBridgeMocks.invoke.mockResolvedValue(undefined);
  });

  async function openSidebarMenu() {
    const Header = (await import('$lib/components/workspace/WorkspaceSidebarHeader.svelte'))
      .default;
    const { container } = render(Header, {
      props: {
        workspace: { id: 'ws-local', path: '/tmp/project' } as Workspace,
        workspaceId: 'ws-local',
      },
    });
    await fireEvent.click(container.querySelector('[data-workspace-actions-trigger]')!);
    return screen.findByRole('menu');
  }

  it('opens app choices without moving copy actions into the submenu', async () => {
    mockStoreState = makeState({ mode: 'sidecar-uds' });
    const root = await openSidebarMenu();
    const trigger = within(root).getByRole('menuitem', { name: 'Open in...' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menuitem', { name: 'Open in Visual Studio Code' })).toBeNull();
    expect(within(root).getByRole('menuitem', { name: 'Copy Absolute Path' })).toBeTruthy();

    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'ArrowRight' });
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'));
    const editor = await screen.findByRole('menuitem', { name: 'Open in Visual Studio Code' });
    const submenu = editor.closest('[role="menu"]') as HTMLElement;
    expect(submenu).not.toBe(root);
    expect(within(submenu).getByRole('menuitem', { name: 'Choose app' })).toBeTruthy();
    expect(within(submenu).queryByRole('menuitem', { name: 'Copy Absolute Path' })).toBeNull();

    await fireEvent.keyDown(editor, { key: 'ArrowLeft' });
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'));
    expect(screen.getByRole('menu')).toBe(root);
  });

  it.each([
    ['Open in Visual Studio Code', 'vscode:open', '/tmp/project'],
    ['Choose app', 'external-editors:open-with-other', { path: '/tmp/project' }],
  ] as const)(
    'routes %s from the submenu and closes the workspace menu',
    async (label, channel, args) => {
      mockStoreState = makeState({ mode: 'sidecar-uds' });
      electronBridgeMocks.invoke.mockResolvedValue({ success: true });
      const root = await openSidebarMenu();
      const trigger = within(root).getByRole('menuitem', { name: 'Open in...' });
      await fireEvent.click(trigger);
      await fireEvent.click(await screen.findByRole('menuitem', { name: label }));
      await waitFor(() => expect(electronBridgeMocks.invoke).toHaveBeenCalledWith(channel, args));
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    },
  );

  it('copies the workspace path without opening the app submenu', async () => {
    mockStoreState = makeState({ mode: 'sidecar-uds' });
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
    const root = await openSidebarMenu();
    await fireEvent.click(within(root).getByRole('menuitem', { name: 'Copy Absolute Path' }));
    await waitFor(() =>
      expect(clipboard.writeText).toHaveBeenCalledWith(toNativePath('/tmp/project')),
    );
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it.each(['remote', 'web'] as const)(
    'keeps copy accessible without an empty submenu on %s',
    async (mode) => {
      mockStoreState = makeState({ mode: mode === 'remote' ? 'external-ws' : 'sidecar-uds' });
      electronBridgeMocks.canOpenExternalEditors = mode !== 'web';
      const root = await openSidebarMenu();
      expect(within(root).queryByRole('menuitem', { name: 'Open in...' })).toBeNull();
      expect(within(root).getByRole('menuitem', { name: 'Copy Absolute Path' })).toBeTruthy();
    },
  );
});

describe('live WorkspaceProgressCard Open in submenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronBridgeMocks.invoke.mockResolvedValue(undefined);
    mockStoreState = makeState({ mode: 'sidecar-uds' });
  });

  async function openProgressCardMenu(workspaceId = 'ws-local') {
    const Card = (await import('$lib/components/workspace/sidebar/WorkspaceProgressCard.svelte'))
      .default;
    render(Card, { props: { workspaceId } });
    await fireEvent.click(screen.getByRole('button', { name: 'Workspace actions' }));
    return screen.findByRole('menu');
  }

  it('reveals and dismisses app choices while keeping copy and archive at the root', async () => {
    const root = await openProgressCardMenu();
    const trigger = within(root).getByRole('menuitem', { name: 'Open in...' });
    const archive = within(root).getByRole('menuitem', { name: 'Archive Workspace' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menuitem', { name: 'Open in Visual Studio Code' })).toBeNull();
    expect(within(root).getByRole('menuitem', { name: 'Copy Absolute Path' })).toBeTruthy();

    await fireEvent.click(trigger);
    const editor = await screen.findByRole('menuitem', { name: 'Open in Visual Studio Code' });
    const submenu = editor.closest('[role="menu"]') as HTMLElement;
    expect(submenu).not.toBe(root);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(within(submenu).getByRole('menuitem', { name: 'Choose app' })).toBeTruthy();
    expect(within(submenu).queryByRole('menuitem', { name: 'Copy Absolute Path' })).toBeNull();
    expect(submenu.contains(archive)).toBe(false);

    await fireEvent.keyDown(editor, { key: 'ArrowLeft' });
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'));
    expect(screen.getByRole('menu')).toBe(root);
    await fireEvent.click(archive);
    expect(mockDispatch).toHaveBeenCalledWith(requestArchiveWorkspace('ws-local'));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it.each(['local', 'remote daemon', 'remote workspace', 'web'] as const)(
    'keeps direct path copy available with locality gates on %s',
    async (mode) => {
      mockStoreState = makeState({
        mode: mode === 'remote daemon' ? 'external-ws' : 'sidecar-uds',
      });
      electronBridgeMocks.canOpenExternalEditors = mode !== 'web';
      const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
      const root = await openProgressCardMenu(
        mode === 'remote workspace' ? 'ws-remote' : 'ws-local',
      );
      const trigger = within(root).queryByRole('menuitem', { name: 'Open in...' });
      if (mode === 'local') expect(trigger?.getAttribute('aria-expanded')).toBe('false');
      else expect(trigger).toBeNull();

      await fireEvent.click(within(root).getByRole('menuitem', { name: 'Copy Absolute Path' }));
      await waitFor(() =>
        expect(clipboard.writeText).toHaveBeenCalledWith(toNativePath('/tmp/project')),
      );
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    },
  );
});

describe('WorkspaceActionsMenu workspace-locality gating (monorepo#2171)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the editors block for a local workspace on a local daemon', async () => {
    mockStoreState = makeState({ mode: 'sidecar-uds' });
    const container = await renderMenu('ws-local');

    expect(container.textContent).toContain('Open in Visual Studio Code');
    expect(container.textContent).toContain('Choose app');
  });

  it('hides the editors block for a remote (SSH) workspace even on a local daemon', async () => {
    mockStoreState = makeState({ mode: 'sidecar-uds' });
    const container = await renderMenu('ws-remote');

    expect(container.textContent).not.toContain('Choose app');
    expect(container.textContent).not.toContain('Open in');
    // Locality-safe copy actions stay available.
    expect(container.textContent).toContain('Copy Absolute Path');
    expect(container.textContent).toContain('Copy Relative Path');
  });

  it('hides the editors block for a remote workspace on a remote daemon too', async () => {
    mockStoreState = makeState({ mode: 'external-ws' });
    const container = await renderMenu('ws-remote');

    expect(container.textContent).not.toContain('Choose app');
    expect(container.textContent).toContain('Copy Absolute Path');
  });

  it('treats an unknown workspace entity as local (optimistic default)', async () => {
    mockStoreState = makeState({ mode: 'sidecar-uds' });
    const container = await renderMenu('ws-unknown');

    expect(container.textContent).toContain('Open in Visual Studio Code');
    expect(container.textContent).toContain('Choose app');
  });
});
