/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceStatus } from '$shared/types';

const {
  gotoMock,
  navigateToSettingsMock,
  invokeMock,
  openMessageMock,
  backendRequestMock,
  workspaceItemsState,
  sessionSessions,
  localNotes,
  reduxDispatchMock,
  browserRecentUrls,
  createSelectorReadable,
  paletteMruEntries,
  paletteFileMru,
  collaboratorState,
  multiplayerState,
  gitlabState,
  remoteAgentsState,
  storeEvents,
} = vi.hoisted(() => {
  const createSelectorReadable = <TArg, TValue>(arg: TArg, resolver: (value: any) => TValue) => ({
    subscribe: (fn: (value: TValue) => void) => {
      if (arg && typeof (arg as any).subscribe === 'function') {
        return (arg as any).subscribe((value: any) => fn(resolver(value)));
      }

      fn(resolver(arg));
      return () => {};
    },
  });

  const backendRequestMock = vi.fn(async () => ({ files: [], matches: [] }));
  const reduxDispatchMock = vi.fn(
    (action: {
      asyncActionType?: string;
      type?: string;
      payload?: unknown[];
      success?: (value: unknown) => unknown;
      failure?: (error: unknown) => unknown;
    }) => {
      if (action.asyncActionType === 'workspaceNotes/searchNotesRequested') {
        const [query, preferWorkspaceId] = action.payload ?? [];
        void backendRequestMock('search.notes', {
          query,
          limit: 10,
          includeArchived: false,
          ...(preferWorkspaceId ? { preferWorkspaceId } : {}),
        }).then(action.success, action.failure);
      }
      return action;
    },
  );

  return {
    gotoMock: vi.fn(),
    navigateToSettingsMock: vi.fn(),
    invokeMock: vi.fn().mockResolvedValue({ files: [] }),
    openMessageMock: vi.fn().mockResolvedValue(undefined),
    backendRequestMock,
    workspaceItemsState: { value: [] as any[], subscribers: new Set<(items: any[]) => void>() },
    sessionSessions: { value: [] as any[] },
    localNotes: { value: [] as any[] },
    reduxDispatchMock,
    browserRecentUrls: { value: [] as any[] },
    createSelectorReadable,
    paletteMruEntries: { value: [] as any[] },
    paletteFileMru: { value: {} as Record<string, number> },
    collaboratorState: {
      workspace: false,
      client: false,
      subscribers: new Set<(value: boolean) => void>(),
    },
    multiplayerState: { enabled: false },
    gitlabState: { enabled: undefined as boolean | undefined },
    remoteAgentsState: { enabled: undefined as boolean | undefined },
    storeEvents: { emit: () => {} },
  };
});

vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToSettings: navigateToSettingsMock }));
vi.mock('$lib/electron-bridge', () => ({ invoke: invokeMock }));
vi.mock('$lib/utils/open-message', () => ({ openMessage: openMessageMock }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: backendRequestMock,
  backendSubscribe: vi.fn(),
  backendUnsubscribe: vi.fn(),
  isBackendAvailable: vi.fn(() => false),
  detectLiveStateCapability: vi.fn(async () => false),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
  BackendError: class BackendError extends Error {},
  electronAPI: {},
}));
vi.mock('$store/renderer/slices/browser/browser-selectors', () => ({
  selectBrowserRecentUrls: Object.assign(
    vi.fn((workspaceIdArg: any) =>
      createSelectorReadable(workspaceIdArg, () => browserRecentUrls.value),
    ),
    { select: vi.fn(() => browserRecentUrls.value) },
  ),
}));
vi.mock('$store/renderer/slices/browser/browser-slice', () => ({
  initBrowserWorkspace: vi.fn((...args: any[]) => ({
    type: 'browser/initBrowserWorkspace',
    payload: args,
  })),
}));
vi.mock('$store/renderer/slices/palette/palette-selectors', () => ({
  selectPaletteMruEntries: () => ({
    subscribe: (fn: (value: any[]) => void) => {
      fn(paletteMruEntries.value);
      return () => {};
    },
  }),
  selectPaletteFileMru: () => ({
    subscribe: (fn: (value: Record<string, number>) => void) => {
      fn(paletteFileMru.value);
      return () => {};
    },
  }),
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceItems: () => ({
    subscribe: (fn: (value: any[]) => void) => {
      workspaceItemsState.subscribers.add(fn);
      fn(workspaceItemsState.value);
      return () => {
        workspaceItemsState.subscribers.delete(fn);
      };
    },
  }),
  selectIsWorkspaceCollaborator: (workspaceIdArg: any) =>
    createSelectorReadable(workspaceIdArg, () => collaboratorState.workspace),
  selectHidesAgentLifecycleActions: (workspaceIdArg: any) =>
    createSelectorReadable(workspaceIdArg, () => collaboratorState.workspace),
  selectIsCollaboratorOnlyClient: () => ({
    subscribe: (fn: (value: boolean) => void) => {
      collaboratorState.subscribers.add(fn);
      fn(collaboratorState.client);
      return () => collaboratorState.subscribers.delete(fn);
    },
  }),
}));
vi.mock('$features/agent/browser', () => ({}));

vi.mock('$features/terminal/terminal-manager.svelte', () => ({
  terminalManager: { loadTerminalMetadata: vi.fn(() => []) },
}));
vi.mock('$features/terminal/terminal-history-tracker', () => ({
  terminalHistoryTracker: { getLastCommand: vi.fn(() => undefined) },
}));
vi.mock('$shared/types/agent-message.conversion', () => ({
  extractContentFromBlocks: vi.fn(() => ''),
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  const module = createAppStoreMockModule({
    state: () => ({
      workspaceNotes: { byWorkspaceId: {} },
      workspaceAgents: { byWorkspaceId: {} },
      userPreferences: {
        labsMultiplayerEnabled: multiplayerState.enabled,
        labsGitLabEnabled: gitlabState.enabled,
        labsRemoteAgentsEnabled: remoteAgentsState.enabled,
      },
    }),
    dispatch: reduxDispatchMock,
  });
  storeEvents.emit = module.store.emitState;
  return module;
});
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-slice', () => ({
  createAgentRequested: vi.fn((...args: any[]) => ({
    type: 'workspaceAgents/createAgentRequested',
    payload: args,
  })),
  emptyWorkspaceAgentState: {
    agents: { ids: [], map: {} },
    agentsLoaded: false,
    isLoadingAgents: false,
    initialAgentId: null,
  },
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: Object.assign(
    vi.fn((workspaceIdArg: any) =>
      createSelectorReadable(workspaceIdArg, (wsId) =>
        sessionSessions.value.filter((s: any) => s.workspaceId === wsId),
      ),
    ),
    {
      select: vi.fn((_state: any, wsId: string) =>
        sessionSessions.value.filter((s: any) => s.workspaceId === wsId),
      ),
    },
  ),
}));
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: Object.assign(
    vi.fn((workspaceIdArg: any) =>
      createSelectorReadable(workspaceIdArg, (wsId) =>
        localNotes.value.filter((n) => n.workspaceId === wsId),
      ),
    ),
    { select: vi.fn(() => []) },
  ),
}));
vi.mock('$store/renderer/slices/terminals/terminals-slice', () => ({
  createTerminalRequested: vi.fn((...args: any[]) => ({
    type: 'terminals/createTerminalRequested',
    payload: args,
  })),
  removeTerminal: vi.fn((...args: any[]) => ({
    type: 'terminals/removeTerminal',
    payload: args,
  })),
}));
vi.mock('$store/renderer/slices/note-read-tracking/note-read-tracking-slice', () => ({
  createNoteRequested: vi.fn((...args: any[]) => ({
    type: 'noteReadTracking/createNoteRequested',
    payload: args,
  })),
}));
vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectCurrentChanges: () => ({
    subscribe: (fn: (value: any[]) => void) => {
      fn([]);
      return () => {};
    },
  }),
}));
vi.mock('svelte-fa', async () => {
  const MockFa = (await import('./ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('./ui/skeleton', async () => {
  const MockSimple = (await import('./workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default;
  return { Skeleton: MockSimple };
});

vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => {
  const MockSimple = (await import('./workspace/sidebar/__tests__/mocks/MockSimple.svelte'))
    .default;
  return { default: MockSimple };
});

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faSearch: { iconName: 'search' },
  faFile: { iconName: 'file' },
  faCog: { iconName: 'cog' },
  faFolderOpen: { iconName: 'folder-open' },
  faTerminal: { iconName: 'terminal' },
  faCommentDots: { iconName: 'comment-dots' },
  faFileAlt: { iconName: 'file-alt' },
  faFlask: { iconName: 'flask' },
  faCodeBranch: { iconName: 'code-branch' },
  faPlus: { iconName: 'plus' },
  faGlobe: { iconName: 'globe' },
  faPlay: { iconName: 'play' },
  faRobot: { iconName: 'robot' },
  faUser: { iconName: 'user' },
  faWandMagicSparkles: { iconName: 'wand-magic-sparkles' },
  faAt: { iconName: 'at' },
  faPaperclip: { iconName: 'paperclip' },
  faChartLine: { iconName: 'chart-line' },
  faThumbtack: { iconName: 'thumbtack' },
}));

import CommandPalette from './CommandPalette.svelte';
import { openWorkspaceNote } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import { recordPaletteMruItem } from '$store/renderer/slices/palette/palette-slice';
import { createAgentRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { createTerminalRequested } from '$store/renderer/slices/terminals/terminals-slice';
import { createNoteRequested } from '$store/renderer/slices/note-read-tracking/note-read-tracking-slice';
import { commandPaletteNewFileRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import { setStatsOverlayOpen } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { openTab } from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { terminalManager } from '$features/terminal/terminal-manager.svelte';

// Actions that dispatch Redux actions directly (no window event intermediary)
const reduxActions = [
  { label: 'New Agent Chat', actionCreator: createAgentRequested },
  { label: 'New Terminal', actionCreator: createTerminalRequested },
  { label: 'New Note', actionCreator: createNoteRequested },
  { label: 'New File', actionCreator: commandPaletteNewFileRequested },
] as const;

describe('CommandPalette new actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceItemsState.value = [];
    browserRecentUrls.value = [];
    sessionSessions.value = [];
    paletteMruEntries.value = [];
    paletteFileMru.value = {};
    collaboratorState.workspace = false;
    collaboratorState.client = false;
    multiplayerState.enabled = false;
    gitlabState.enabled = undefined;
    remoteAgentsState.enabled = undefined;
  });

  it.each([
    ['agent defaults', /Agent defaults/i, 'agent-behavior'],
    ['providers', /Providers/i, 'providers'],
    ['connections', /Connections/i, 'connections'],
    ['machines', /Machines/i, 'devices'],
    ['mobile', /Mobile/i, 'mobile'],
    ['collaboration', /Collaboration/i, 'collaboration'],
    ['appearance', /Appearance/i, 'display'],
    ['general', /General/i, 'app-behavior'],
    ['input shortcuts', /Input and shortcuts/i, 'input'],
    ['workspace setup', /Workspace setup/i, 'setup'],
    ['advanced', /Advanced/i, 'advanced'],
    ['specialists', /Specialists/i, 'specialists'],
    ['Linear', /Connections/i, 'connections'],
    ['settings linear', /Connections/i, 'connections'],
    ['keyboard', /Input and shortcuts/i, 'input'],
    ['notifications', /General/i, 'app-behavior'],
    ['theme', /Appearance/i, 'display'],
  ] as const)(
    'opens the settings destination for %s without a workspace',
    async (query, name, tab) => {
      multiplayerState.enabled = true;
      const onClose = vi.fn();
      render(CommandPalette, { props: { isOpen: true, initialQuery: query, onClose } });

      await fireEvent.click(await screen.findByRole('button', { name }));

      expect(navigateToSettingsMock).toHaveBeenCalledExactlyOnceWith({ tab });
      expect(reduxDispatchMock).toHaveBeenCalledWith({
        type: 'sidebarNav/setShowCreateModal',
        payload: [false],
      });
      expect(onClose).toHaveBeenCalledOnce();
    },
  );

  it('opens Linear settings with Enter from a workspace and dismisses the create form', async () => {
    const onClose = vi.fn();
    render(CommandPalette, {
      props: { isOpen: true, initialQuery: 'Linear', workspaceId: 'tiny-owl', onClose },
    });
    await screen.findByRole('button', { name: /Connections/i });

    await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

    expect(navigateToSettingsMock).toHaveBeenCalledExactlyOnceWith({ tab: 'connections' });
    expect(reduxDispatchMock).toHaveBeenCalledWith({
      type: 'sidebarNav/setShowCreateModal',
      payload: [false],
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('dismisses the create form when opening the general Settings command', async () => {
    render(CommandPalette, {
      props: { isOpen: true, initialQuery: 'settings', onClose: vi.fn() },
    });
    await fireEvent.click(await screen.findByRole('button', { name: /^Settings/i }));

    expect(navigateToSettingsMock).toHaveBeenCalledExactlyOnceWith();
    expect(reduxDispatchMock).toHaveBeenCalledWith({
      type: 'sidebarNav/setShowCreateModal',
      payload: [false],
    });
  });

  it.each([
    ['Linear', /Connections/i, 'connections'],
    ['providers', /Providers/i, 'providers'],
  ] as const)(
    'withholds administrator settings for collaborator-only clients searching %s',
    async (query, name, tab) => {
      render(CommandPalette, {
        props: { isOpen: true, initialQuery: query, onClose: vi.fn() },
      });
      await screen.findByRole('button', { name });

      collaboratorState.client = true;
      collaboratorState.subscribers.forEach((subscriber) => subscriber(true));
      await waitFor(() => expect(screen.queryByRole('button', { name })).toBeNull());
      await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
      expect(navigateToSettingsMock).not.toHaveBeenCalledWith({ tab });
    },
  );

  it('keeps personal settings accessible for collaborator-only clients', async () => {
    collaboratorState.client = true;
    render(CommandPalette, {
      props: { isOpen: true, initialQuery: 'theme', onClose: vi.fn() },
    });
    await fireEvent.click(await screen.findByRole('button', { name: /Appearance/i }));
    expect(navigateToSettingsMock).toHaveBeenCalledExactlyOnceWith({ tab: 'display' });
  });

  it('keeps administrator settings available to a host administrator in a shared workspace', async () => {
    collaboratorState.workspace = true;
    render(CommandPalette, {
      props: { isOpen: true, initialQuery: 'Linear', workspaceId: 'tiny-owl', onClose: vi.fn() },
    });
    await fireEvent.click(await screen.findByRole('button', { name: /Connections/i }));
    expect(navigateToSettingsMock).toHaveBeenCalledExactlyOnceWith({ tab: 'connections' });
  });

  it('refreshes collaboration settings results when multiplayer is enabled or disabled', async () => {
    multiplayerState.enabled = true;
    render(CommandPalette, {
      props: { isOpen: true, initialQuery: 'sharing', onClose: vi.fn() },
    });
    await screen.findByRole('button', { name: /Collaboration/i });

    multiplayerState.enabled = false;
    storeEvents.emit();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Collaboration/i })).toBeNull(),
    );
    multiplayerState.enabled = true;
    storeEvents.emit();
    await fireEvent.click(await screen.findByRole('button', { name: /Collaboration/i }));
    expect(navigateToSettingsMock).toHaveBeenCalledExactlyOnceWith({ tab: 'collaboration' });
  });

  it.each([undefined, false, true])(
    'changes experimental GitLab from saved=%s without a workspace or an implicit preference change',
    async (enabled) => {
      gitlabState.enabled = enabled;
      const onClose = vi.fn();
      render(CommandPalette, { props: { isOpen: true, initialQuery: 'GitLab', onClose } });
      const command = await screen.findByRole('button', {
        name: enabled ? /Disable experimental GitLab/i : /Enable experimental GitLab/i,
      });
      expect(
        screen.queryByRole('button', {
          name: enabled ? /Enable experimental GitLab/i : /Disable experimental GitLab/i,
        }),
      ).toBeNull();
      expect(
        reduxDispatchMock.mock.calls.filter(([action]) =>
          action.type.startsWith('userPreferences/'),
        ),
      ).toEqual([]);

      reduxDispatchMock.mockClear();
      if (enabled) await fireEvent.click(command);
      else await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

      expect(reduxDispatchMock).toHaveBeenCalledExactlyOnceWith({
        type: 'userPreferences/setLabsGitLabEnabled',
        payload: [!enabled],
      });
      expect(onClose).toHaveBeenCalledOnce();
    },
  );

  it('updates the GitLab command after delayed hydration without changing the saved choice', async () => {
    render(CommandPalette, { props: { isOpen: true, initialQuery: 'GitLab', onClose: vi.fn() } });
    await screen.findByRole('button', { name: /Enable experimental GitLab/i });
    gitlabState.enabled = true;
    storeEvents.emit();
    await screen.findByRole('button', { name: /Disable experimental GitLab/i });
    expect(screen.queryByRole('button', { name: /Enable experimental GitLab/i })).toBeNull();
    expect(
      reduxDispatchMock.mock.calls.filter(([action]) => action.type.startsWith('userPreferences/')),
    ).toEqual([]);
  });

  it.each([undefined, false, true])(
    'changes experimental remote agents from saved=%s without a workspace or an implicit preference change',
    async (enabled) => {
      remoteAgentsState.enabled = enabled;
      const onClose = vi.fn();
      render(CommandPalette, { props: { isOpen: true, initialQuery: 'remote agents', onClose } });
      const command = await screen.findByRole('button', {
        name: enabled
          ? /Disable experimental remote agents/i
          : /Enable experimental remote agents/i,
      });
      expect(
        screen.queryByRole('button', {
          name: enabled
            ? /Enable experimental remote agents/i
            : /Disable experimental remote agents/i,
        }),
      ).toBeNull();
      expect(
        reduxDispatchMock.mock.calls.filter(([action]) =>
          action.type.startsWith('userPreferences/'),
        ),
      ).toEqual([]);

      reduxDispatchMock.mockClear();
      if (enabled) await fireEvent.click(command);
      else await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

      expect(reduxDispatchMock).toHaveBeenCalledExactlyOnceWith({
        type: 'userPreferences/setLabsRemoteAgentsEnabled',
        payload: [!enabled],
      });
      expect(invokeMock).not.toHaveBeenCalled();
      expect(backendRequestMock).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledOnce();
    },
  );

  it('updates the remote agents command after delayed hydration without changing the saved choice', async () => {
    render(CommandPalette, {
      props: { isOpen: true, initialQuery: 'remote agents', onClose: vi.fn() },
    });
    await screen.findByRole('button', { name: /Enable experimental remote agents/i });
    remoteAgentsState.enabled = true;
    storeEvents.emit();
    await screen.findByRole('button', { name: /Disable experimental remote agents/i });
    expect(screen.queryByRole('button', { name: /Enable experimental remote agents/i })).toBeNull();
    remoteAgentsState.enabled = false;
    storeEvents.emit();
    await screen.findByRole('button', { name: /Enable experimental remote agents/i });
    expect(
      screen.queryByRole('button', { name: /Disable experimental remote agents/i }),
    ).toBeNull();
    expect(
      reduxDispatchMock.mock.calls.filter(([action]) => action.type.startsWith('userPreferences/')),
    ).toEqual([]);
  });

  it.each(['GitLab', ':'])(
    'clears the visible %s query for an ordinary open while the palette remains open',
    async (initialQuery) => {
      const onClose = vi.fn();
      const view = render(CommandPalette, { props: { isOpen: true, initialQuery, onClose } });
      const input = screen.getByRole('textbox') as HTMLInputElement;
      await waitFor(() => expect(input.value).toBe(initialQuery));
      await fireEvent.input(input, { target: { value: `${initialQuery}42` } });

      await view.rerender({ initialQuery: '' });

      await waitFor(() => expect(input.value).toBe(''));
      expect(screen.getByRole('dialog')).not.toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      expect(
        reduxDispatchMock.mock.calls.filter(([action]) =>
          action.type.startsWith('userPreferences/'),
        ),
      ).toEqual([]);
    },
  );

  it('preserves typed text across unrelated updates and still handles go-to-line requests', async () => {
    const onClose = vi.fn();
    const view = render(CommandPalette, {
      props: { isOpen: true, initialQuery: 'GitLab', onClose },
    });
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'my search' } });

    gitlabState.enabled = true;
    storeEvents.emit();
    await view.rerender({ workspaceId: 'ws-1' });
    expect(input.value).toBe('my search');

    await view.rerender({ initialQuery: ':' });
    await waitFor(() => expect(input.value).toBe(':'));
    await fireEvent.input(input, { target: { value: ':42' } });
    const goToLine = vi.fn();
    window.addEventListener('workspace:go-to-line', goToLine);
    try {
      await fireEvent.keyDown(input, { key: 'Enter' });
      expect(goToLine).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ detail: { line: 42 } }),
      );
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('workspace:go-to-line', goToLine);
    }
  });

  it.each([false, true])(
    'changes experimental multiplayer from enabled=%s through command search without a workspace',
    async (enabled) => {
      multiplayerState.enabled = enabled;
      const onClose = vi.fn();
      render(CommandPalette, { props: { isOpen: true, onClose } });
      const input = screen.getByRole('textbox');

      await fireEvent.input(input, { target: { value: 'multiplayer' } });
      const command = await screen.findByRole('button', {
        name: enabled ? /Disable experimental multiplayer/i : /Enable experimental multiplayer/i,
      });
      expect(
        screen.queryByRole('button', {
          name: enabled ? /Enable experimental multiplayer/i : /Disable experimental multiplayer/i,
        }),
      ).toBeNull();

      reduxDispatchMock.mockClear();
      if (enabled) await fireEvent.click(command);
      else await fireEvent.keyDown(input, { key: 'Enter' });

      expect(reduxDispatchMock).toHaveBeenCalledWith({
        type: 'userPreferences/setLabsMultiplayerEnabled',
        payload: [!enabled],
      });
      expect(onClose).toHaveBeenCalledOnce();
    },
  );

  it('withholds agent-creation, terminal, browser, and workspace-creation commands and results for collaborators', async () => {
    collaboratorState.workspace = true;
    collaboratorState.client = true;
    vi.mocked(terminalManager.loadTerminalMetadata).mockReturnValue([
      { terminalId: 'term-1', title: 'Owner Shell', createdAt: new Date().toISOString() },
    ] as any);
    browserRecentUrls.value = [
      { url: 'https://example.com', title: 'Example', lastVisited: new Date().toISOString() },
    ];

    render(CommandPalette, { props: { isOpen: true, workspaceId: 'ws-1', onClose: vi.fn() } });

    await screen.findByRole('button', { name: 'New Note' });
    expect(screen.queryByRole('button', { name: 'New Agent Chat' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New Terminal' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Open URL in Browser/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /New Workspace/i })).toBeNull();

    const input = screen.getByRole('textbox');
    await fireEvent.input(input, { target: { value: 'Owner Shell' } });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Owner Shell/ })).toBeNull();
    });
    await fireEvent.input(input, { target: { value: 'Example' } });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /example\.com/ })).toBeNull();
    });
    expect(reduxDispatchMock).not.toHaveBeenCalledWith(createTerminalRequested('ws-1'));
  });

  it('dispatches Redux actions for agent, terminal, note, and file from keyboard', async () => {
    const onClose = vi.fn();

    render(CommandPalette, { props: { isOpen: true, workspaceId: 'ws-1', onClose } });

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'New Agent Chat' }).getAttribute('aria-current'),
      ).toBe('true');
    });

    const input = screen.getByRole('textbox');

    for (const [index, action] of reduxActions.entries()) {
      reduxDispatchMock.mockClear();
      if (index > 0) {
        await fireEvent.keyDown(input, { key: 'ArrowDown' });
      }

      await fireEvent.keyDown(input, { key: 'Enter' });
      expect(reduxDispatchMock).toHaveBeenCalledWith(action.actionCreator('ws-1'));
    }
  });

  it('opens an existing terminal search result as a panel-layout terminal tab', async () => {
    vi.mocked(terminalManager.loadTerminalMetadata).mockReturnValue([
      { terminalId: 'term-1', title: 'My Terminal', createdAt: new Date().toISOString() },
    ] as any);
    const onClose = vi.fn();

    render(CommandPalette, { props: { isOpen: true, workspaceId: 'ws-1', onClose } });

    const input = screen.getByRole('textbox');
    await fireEvent.input(input, { target: { value: 'My Terminal' } });

    const item = await screen.findByRole('button', { name: /My Terminal/ });
    reduxDispatchMock.mockClear();
    await fireEvent.click(item);

    expect(reduxDispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: openTab.type,
        payload: expect.objectContaining({
          wsId: 'ws-1',
          tab: expect.objectContaining({
            type: 'terminal',
            terminalId: 'term-1',
            closable: true,
          }),
        }),
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('dispatches Redux actions for agent, terminal, note, and file from clicks', async () => {
    const onClose = vi.fn();

    render(CommandPalette, { props: { isOpen: true, workspaceId: 'ws-1', onClose } });

    for (const action of reduxActions) {
      reduxDispatchMock.mockClear();
      const button = await screen.findByRole('button', { name: action.label });
      await fireEvent.click(button);
      expect(reduxDispatchMock).toHaveBeenCalledWith(action.actionCreator('ws-1'));
    }
  });

  it('opens Dev Console through the native bridge from the command palette', async () => {
    const nativeInvoke = vi.spyOn(window.electronAPI, 'invoke').mockResolvedValue({ windowId: 42 });
    render(CommandPalette, { props: { isOpen: true, workspaceId: 'ws-1', onClose: vi.fn() } });
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Dev Console' } });
    await fireEvent.click(await screen.findByRole('button', { name: /Dev Console/ }));
    expect(nativeInvoke).toHaveBeenCalledWith('dev-console:open', {});
    nativeInvoke.mockRestore();
  });

  it('exposes composer commands with their keyboard hints', async () => {
    render(CommandPalette, { props: { isOpen: true, workspaceId: 'ws-1', onClose: vi.fn() } });
    const input = screen.getByRole('textbox');

    await fireEvent.input(input, { target: { value: 'enhance prompt' } });
    expect((await screen.findByRole('button', { name: /Enhance prompt/i })).textContent).toContain(
      '⌘/',
    );

    await fireEvent.input(input, { target: { value: 'attach context' } });
    expect((await screen.findByRole('button', { name: /Attach context/i })).textContent).toContain(
      '@',
    );

    await fireEvent.input(input, { target: { value: 'attach files' } });
    expect((await screen.findByRole('button', { name: /Attach files/i })).textContent).toContain(
      '⇧⌘A',
    );
  });

  it('opens HUD through the exact window IPC request and opens usage stats through Redux', async () => {
    render(CommandPalette, { props: { isOpen: true, workspaceId: 'ws-1', onClose: vi.fn() } });
    const input = screen.getByRole('textbox');

    await fireEvent.input(input, { target: { value: 'HUD' } });
    const hud = await screen.findByRole('button', { name: /HUD/i });
    expect(hud.textContent).toContain('⇧⌘H');
    await fireEvent.click(hud);
    expect(invokeMock).toHaveBeenCalledWith('window:open-new', { route: '/hud' });

    reduxDispatchMock.mockClear();
    await fireEvent.input(input, { target: { value: 'usage stats' } });
    const stats = await screen.findByRole('button', { name: /Usage stats/i });
    expect(stats.textContent).toContain('⇧⌘U');
    await fireEvent.click(stats);
    expect(reduxDispatchMock).toHaveBeenCalledWith(setStatsOverlayOpen(true));
  });

  it('routes composer palette commands to the focused chat surface', async () => {
    const events = ['chat:enhance-prompt', 'chat:attach-context', 'chat:attach-files'] as const;
    const listeners = events.map(() => vi.fn());
    events.forEach((event, index) => window.addEventListener(event, listeners[index]));
    render(CommandPalette, { props: { isOpen: true, workspaceId: 'ws-1', onClose: vi.fn() } });
    const input = screen.getByRole('textbox');

    for (const [index, query] of ['enhance prompt', 'attach context', 'attach files'].entries()) {
      await fireEvent.input(input, { target: { value: query } });
      const action = await screen.findByRole('button', {
        name: new RegExp(query, 'i'),
      });
      await fireEvent.click(action);
      expect(listeners[index]).toHaveBeenCalledOnce();
    }

    events.forEach((event, index) => window.removeEventListener(event, listeners[index]));
  });

  it('keeps current-row state on actionable results through search, arrows, and hover', async () => {
    render(CommandPalette, { props: { isOpen: true, workspaceId: 'ws-1', onClose: vi.fn() } });
    const input = screen.getByRole('textbox');
    await fireEvent.input(input, { target: { value: 'attach' } });
    const context = await screen.findByRole('button', { name: /Attach context/i });
    const files = await screen.findByRole('button', { name: /Attach files/i });
    await fireEvent.pointerMove(context);
    expect(context.getAttribute('aria-current')).toBe('true');
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(files.getAttribute('aria-current')).toBe('true');
    expect(context.hasAttribute('aria-current')).toBe(false);
    await fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(context.getAttribute('aria-current')).toBe('true');
    expect(files.hasAttribute('aria-current')).toBe(false);
  });
});

describe('CommandPalette duplicate-key regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceItemsState.value = [];
    browserRecentUrls.value = [];
    sessionSessions.value = [];
    paletteMruEntries.value = [];
    paletteFileMru.value = {};
  });

  it('renders without throwing when the same item appears in Recent and its source group', async () => {
    // Set up an agent session so it appears in the Agents group
    const agentId = 'agent-dup-test';
    sessionSessions.value = [
      {
        id: agentId,
        workspaceId: 'ws-1',
        name: 'Duplicate Agent',
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    // Seed Redux-backed MRU so the same agent also appears in the Recent group
    paletteMruEntries.value = [{ type: 'agent', id: agentId, timestamp: Date.now() }];

    const onClose = vi.fn();

    // Should not throw a duplicate-key error
    expect(() => {
      render(CommandPalette, { props: { isOpen: true, workspaceId: 'ws-1', onClose } });
    }).not.toThrow();

    // Verify the agent label appears (at least once, possibly twice: Recent + Agents)
    await waitFor(() => {
      const buttons = screen.getAllByRole('button', { name: /Duplicate Agent/i });
      expect(buttons.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('CommandPalette workspace activity recency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserRecentUrls.value = [];
    sessionSessions.value = [];
    paletteMruEntries.value = [];
    paletteFileMru.value = {};
  });

  it('sorts and labels workspace results by semantic activity instead of touched updatedAt', async () => {
    workspaceItemsState.value = [
      {
        id: 'current',
        title: 'Current Space',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
      {
        id: 'old-semantic',
        title: 'Old Semantic Space',
        repositoryPath: '/repos/old-semantic',
        createdAt: '2024-01-01T00:00:00.000Z',
        lastActivity: '2025-01-15T12:00:00.000Z',
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'newer-semantic',
        title: 'Newer Semantic Space',
        repositoryPath: '/repos/newer-semantic',
        createdAt: '2025-06-01T00:00:00.000Z',
        updatedAt: '2025-06-01T00:00:00.000Z',
      },
    ];

    render(CommandPalette, { props: { isOpen: true, workspaceId: 'current', onClose: vi.fn() } });

    const newer = await screen.findByRole('button', { name: /Newer Semantic Space/i });
    const old = screen.getByRole('button', { name: /Old Semantic Space/i });

    expect(newer.compareDocumentPosition(old) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(old.textContent).toContain('Jan 15');
    expect(old.textContent).not.toContain('just now');
  });
});

describe('CommandPalette chat message rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceItemsState.value = [];
    browserRecentUrls.value = [];
    sessionSessions.value = [];
    paletteMruEntries.value = [];
    paletteFileMru.value = {};
    backendRequestMock.mockImplementation(async () => ({ files: [], matches: [] }));
  });

  it('renders workspace title and owner/repo on the title line, degrading gracefully', async () => {
    workspaceItemsState.value = [
      {
        id: 'ws-repo',
        title: 'Repo overview',
        repositoryOwner: 'panghy',
        repositoryName: 'chinese-fonts',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
      {
        id: 'ws-noowner',
        title: 'Local space',
        repositoryName: 'tools',
        status: WorkspaceStatus.Archived,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ];
    backendRequestMock.mockImplementation(async (method: string) => {
      if (method === 'search.messages') {
        return {
          matches: [
            {
              agentId: 'ag-1',
              messageId: 'msg-1',
              preview: 'hello from coordinator',
              workspaceId: 'ws-repo',
              agentName: 'Coordinator',
              role: 'assistant',
              timestamp: '2025-06-01T00:00:00.000Z',
            },
            {
              agentId: 'ag-2',
              messageId: 'msg-2',
              preview: 'hello from local',
              workspaceId: 'ws-noowner',
              agentName: 'Local Agent',
              role: 'user',
              timestamp: '2025-06-01T00:00:00.000Z',
            },
            {
              agentId: 'ag-3',
              messageId: 'msg-3',
              preview: 'hello from nowhere',
              workspaceId: 'ws-gone',
              agentName: 'Ghost Agent',
              role: 'user',
              timestamp: '2025-06-01T00:00:00.000Z',
            },
          ],
        };
      }
      return { files: [] };
    });

    render(CommandPalette, { props: { isOpen: true, workspaceId: 'ws-1', onClose: vi.fn() } });

    const input = screen.getByRole('textbox');
    await fireEvent.input(input, { target: { value: 'hello' } });

    // Assert the wire request matches PROTOCOL §5.15 (search.messages)
    await waitFor(
      () =>
        expect(backendRequestMock).toHaveBeenCalledWith('search.messages', {
          query: 'hello',
          limit: 10,
          preferWorkspaceId: 'ws-1',
        }),
      { timeout: 3000 },
    );

    // Full metadata: Agent · Workspace · owner/repo
    const coordinator = await screen.findByRole(
      'button',
      { name: /Coordinator/ },
      { timeout: 3000 },
    );
    expect(coordinator.textContent).toMatch(
      /Coordinator\s*·\s*Repo overview\s*·\s*panghy\/chinese-fonts/,
    );
    expect(coordinator.textContent).toContain('hello from coordinator');

    // Active workspace: no archived pill
    expect(coordinator.textContent).not.toContain('Archived workspace');

    // No owner: Agent · Workspace · repo-name only; archived workspace shows the pill
    const local = screen.getByRole('button', { name: /Local Agent/ });
    expect(local.textContent).toMatch(/Local Agent\s*·\s*Local space\s*·\s*tools/);
    expect(local.textContent).not.toContain('panghy');
    expect(local.textContent).toContain('Archived workspace');

    // Unknown workspace: no segments, no dangling separators, no "undefined"
    const ghost = screen.getByRole('button', { name: /Ghost Agent/ });
    expect(ghost.textContent).not.toContain('undefined');
    expect(ghost.textContent).not.toContain('·');
    expect(ghost.textContent).toContain('hello from nowhere');
  });
});

describe('CommandPalette indexed notes', () => {
  const hit = (workspaceId = 'other', noteId = 'spec') => ({
    workspaceId,
    noteId,
    title: 'Remote plan',
    preview: 'needle <img src=x onerror=alert(1)> **plain**',
    score: 2,
    updatedAt: '2026-10-01T00:00:00Z',
    isArchived: false,
    workspaceArchived: true,
  });
  beforeEach(() => {
    vi.clearAllMocks();
    localNotes.value = [];
    sessionSessions.value = [];
    browserRecentUrls.value = [];
    paletteMruEntries.value = [];
    workspaceItemsState.value = [{ id: 'other', title: 'Other space', repositoryName: 'repo' }];
    window.history.replaceState({}, '', '/workspace/ws-1');
    gotoMock.mockImplementation(async (url: string) => {
      window.history.replaceState({}, '', url);
    });
    backendRequestMock.mockImplementation(async (method: string) =>
      method === 'search.notes'
        ? { indexed: true, requestId: 'r', matches: [hit()] }
        : { files: [], matches: [] },
    );
  });

  it.each(['needle', '#needle'])(
    'renders body-only matches as text with ownership for %s',
    async (initialQuery) => {
      const { container } = render(CommandPalette, {
        props: { isOpen: true, workspaceId: 'ws-1', initialQuery, onClose: vi.fn() },
      });
      const row = await screen.findByRole('button', { name: /Remote plan/ });
      expect(row.textContent).toContain('Other space');
      expect(row.textContent).toContain('Archived workspace');
      expect(row.textContent).toContain(hit().preview);
      expect(container.querySelector('img')).toBeNull();
      expect(backendRequestMock).toHaveBeenCalledWith('search.notes', {
        query: 'needle',
        limit: 10,
        includeArchived: false,
        preferWorkspaceId: 'ws-1',
      });
    },
  );

  it.each([false, true])(
    'opens the owning workspace and preserves adjacent=%s, recording composite MRU',
    async (adjacent) => {
      render(CommandPalette, {
        props: { isOpen: true, workspaceId: 'ws-1', initialQuery: '#needle', onClose: vi.fn() },
      });
      const row = await screen.findByRole('button', { name: /Remote plan/ });
      if (adjacent)
        await fireEvent.keyDown(screen.getByRole('textbox'), {
          key: 'Enter',
          metaKey: true,
          ctrlKey: true,
        });
      else await fireEvent.click(row);
      await waitFor(() =>
        expect(reduxDispatchMock).toHaveBeenCalledWith(
          openWorkspaceNote('other', 'spec', { openInAdjacentPanel: adjacent }),
        ),
      );
      expect(gotoMock).toHaveBeenCalledWith('/workspace/other');
      expect(reduxDispatchMock).toHaveBeenCalledWith(
        recordPaletteMruItem('note', JSON.stringify(['other', 'spec']), expect.any(Number)),
      );
    },
  );

  it('keeps identical note IDs from different workspaces selectable', async () => {
    backendRequestMock.mockImplementation(async (method: string) =>
      method === 'search.notes'
        ? { indexed: true, matches: [hit('ws-1'), { ...hit(), title: 'Other plan' }] }
        : { files: [], matches: [] },
    );
    render(CommandPalette, {
      props: { isOpen: true, workspaceId: 'ws-1', initialQuery: '#needle', onClose: vi.fn() },
    });
    await screen.findByRole('button', { name: /Remote plan/ });
    await fireEvent.click(screen.getByRole('button', { name: /Other plan/ }));
    await waitFor(() =>
      expect(reduxDispatchMock).toHaveBeenCalledWith(
        openWorkspaceNote('other', 'spec', { openInAdjacentPanel: false }),
      ),
    );
  });

  it('falls back to workspace ID when metadata is absent', async () => {
    workspaceItemsState.value = [];
    render(CommandPalette, { props: { isOpen: true, initialQuery: '#needle', onClose: vi.fn() } });
    const row = await screen.findByRole('button', { name: /Remote plan/ });
    expect(row.textContent).toContain('other');
    expect(row.textContent).not.toContain('undefined');
  });

  it.each(['legacy', 'error'])(
    'retains local title/tag discovery on %s responses',
    async (mode) => {
      localNotes.value = [
        {
          id: 'tag',
          workspaceId: 'ws-1',
          title: 'Local plan',
          tags: ['needle'],
          updatedAt: '2026-10-01T00:00:00Z',
        },
      ];
      backendRequestMock.mockImplementation(async (method: string) => {
        if (method === 'search.notes') {
          if (mode === 'error') throw new Error('offline');
          return { matches: [hit()] };
        }
        return { files: [], matches: [] };
      });
      render(CommandPalette, {
        props: { isOpen: true, workspaceId: 'ws-1', initialQuery: '#needle', onClose: vi.fn() },
      });
      const row = await screen.findByRole('button', { name: /Local plan/ });
      await waitFor(() =>
        expect(backendRequestMock).toHaveBeenCalledWith('search.notes', expect.anything()),
      );
      expect(screen.queryByRole('button', { name: /Remote plan/ })).toBeNull();
      await fireEvent.click(row);
      expect(reduxDispatchMock).toHaveBeenCalledWith(
        openWorkspaceNote('ws-1', 'tag', { openInAdjacentPanel: false }),
      );
    },
  );

  it('browses local notes without querying and reads legacy MRU IDs', async () => {
    localNotes.value = [
      { id: 'spec', workspaceId: 'ws-1', title: 'Local spec', updatedAt: '2026-10-01T00:00:00Z' },
    ];
    paletteMruEntries.value = [{ type: 'note', id: 'spec', timestamp: 1 }];
    render(CommandPalette, { props: { isOpen: true, workspaceId: 'ws-1', onClose: vi.fn() } });
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Local spec/ })).toHaveLength(2),
    );
    expect(backendRequestMock.mock.calls.some(([method]) => method === 'search.notes')).toBe(false);
  });

  it('does not open a note or record MRU when workspace navigation fails', async () => {
    gotoMock.mockRejectedValueOnce(new Error('navigation cancelled'));
    render(CommandPalette, {
      props: { isOpen: true, workspaceId: 'ws-1', initialQuery: '#needle', onClose: vi.fn() },
    });
    await fireEvent.click(await screen.findByRole('button', { name: /Remote plan/ }));
    await waitFor(() => expect(gotoMock).toHaveBeenCalled());
    expect(
      reduxDispatchMock.mock.calls.some(
        ([action]) =>
          action.type === openWorkspaceNote.type || action.type === recordPaletteMruItem.type,
      ),
    ).toBe(false);
  });

  it('invalidates an old workspace request and keeps the latest ranked hits', async () => {
    const pending: Array<(value: any) => void> = [];
    backendRequestMock.mockImplementation((method: string) =>
      method === 'search.notes'
        ? new Promise((resolve) => pending.push(resolve))
        : Promise.resolve({ files: [], matches: [] }),
    );
    const view = render(CommandPalette, {
      props: { isOpen: true, workspaceId: 'ws-1', initialQuery: '#needle', onClose: vi.fn() },
    });
    await waitFor(() => expect(pending).toHaveLength(1));
    await view.rerender({ workspaceId: 'other' });
    await waitFor(() => expect(pending).toHaveLength(2));
    pending[1]({ indexed: true, matches: [{ ...hit(), title: 'Current result' }] });
    await screen.findByRole('button', { name: /Current result/ });
    pending[0]({ indexed: true, matches: [hit()] });
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: '#fresh' } });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Current result/ })).toBeNull(),
    );
    expect(screen.queryByRole('button', { name: /Remote plan/ })).toBeNull();
    view.unmount();
  });

  it('does not query notes under another class filter or after unmount', async () => {
    const view = render(CommandPalette, {
      props: { isOpen: true, workspaceId: 'ws-1', initialQuery: '?needle', onClose: vi.fn() },
    });
    await waitFor(() =>
      expect(backendRequestMock).toHaveBeenCalledWith('search.messages', expect.anything()),
    );
    expect(backendRequestMock.mock.calls.some(([method]) => method === 'search.notes')).toBe(false);
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: '#needle' } });
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(backendRequestMock.mock.calls.some(([method]) => method === 'search.notes')).toBe(false);
  });

  it('discards in-flight notes on close and unmount', async () => {
    let resolve!: (response: any) => void;
    backendRequestMock.mockImplementation((method: string) =>
      method === 'search.notes'
        ? new Promise((r) => {
            resolve = r;
          })
        : Promise.resolve({ files: [], matches: [] }),
    );
    const view = render(CommandPalette, {
      props: { isOpen: true, workspaceId: 'ws-1', initialQuery: '#needle', onClose: vi.fn() },
    });
    await waitFor(() => expect(resolve).toBeDefined());
    await view.rerender({ isOpen: false });
    resolve({ indexed: true, matches: [hit()] });
    await view.rerender({ isOpen: true, initialQuery: '' });
    expect(screen.queryByRole('button', { name: /Remote plan/ })).toBeNull();
    view.unmount();
  });
});

describe('CommandPalette transcript search lifecycle', () => {
  const searches = () =>
    backendRequestMock.mock.calls.filter(([method]) => method === 'search.messages');
  const refreshWorkspaces = () => {
    workspaceItemsState.value = [{ id: 'tiny-owl', title: 'Updated workspace' }];
    for (const subscriber of workspaceItemsState.subscribers) subscriber(workspaceItemsState.value);
  };
  const settleDebounce = async () => {
    await vi.advanceTimersByTimeAsync(200);
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    workspaceItemsState.value = [];
    localNotes.value = [];
    sessionSessions.value = [];
    browserRecentUrls.value = [];
    paletteMruEntries.value = [];
    paletteFileMru.value = {};
    backendRequestMock.mockImplementation(async () => ({ files: [], matches: [] }));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const remoteSearches = ['search.fileNames', 'search.messages', 'search.notes'] as const;
  const callsFor = (method: string) =>
    backendRequestMock.mock.calls.filter(([name]) => name === method);
  const expectedParams = (method: string, workspaceId: string, term = 'dev con') =>
    method === 'search.fileNames'
      ? { workspaceId, pattern: term, limit: 50 }
      : {
          query: term,
          limit: 10,
          preferWorkspaceId: workspaceId,
          ...(method === 'search.notes' ? { includeArchived: false } : {}),
        };

  it.each(remoteSearches)(
    '%s stays quiet when mounted hidden and after close/workspace churn',
    async (method) => {
      const view = render(CommandPalette, {
        props: {
          isOpen: false,
          workspaceId: 'tiny-owl',
          initialQuery: 'dev con',
          onClose: vi.fn(),
        },
      });
      refreshWorkspaces();
      await settleDebounce();
      expect(callsFor(method)).toEqual([]);
      await view.rerender({ isOpen: true });
      await settleDebounce();
      expect(callsFor(method)).toEqual([[method, expectedParams(method, 'tiny-owl')]]);
      await view.rerender({ isOpen: false });
      await view.rerender({ workspaceId: 'other' });
      refreshWorkspaces();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(callsFor(method)).toHaveLength(1);
      await view.rerender({ isOpen: true });
      await settleDebounce();
      expect(callsFor(method)[1]).toEqual([method, expectedParams(method, 'other')]);
    },
  );

  it.each(remoteSearches)(
    '%s does not repeat unchanged searches on metadata churn or idle',
    async (method) => {
      const view = render(CommandPalette, {
        props: { isOpen: true, workspaceId: 'tiny-owl', initialQuery: 'dev con', onClose: vi.fn() },
      });
      await settleDebounce();
      for (let i = 0; i < 3; i++) {
        refreshWorkspaces();
        await settleDebounce();
      }
      await vi.advanceTimersByTimeAsync(60_000);
      expect(callsFor(method)).toEqual([[method, expectedParams(method, 'tiny-owl')]]);
      await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'fresh query' } });
      await settleDebounce();
      expect(callsFor(method)[1]).toEqual([
        method,
        expectedParams(method, 'tiny-owl', 'fresh query'),
      ]);
      await view.rerender({ workspaceId: 'other' });
      await settleDebounce();
      expect(callsFor(method)[2]).toEqual([method, expectedParams(method, 'other', 'fresh query')]);
    },
  );

  it.each(remoteSearches)('%s cancels a pending debounce on close', async (method) => {
    const view = render(CommandPalette, {
      props: { isOpen: true, workspaceId: 'tiny-owl', initialQuery: 'dev con', onClose: vi.fn() },
    });
    await view.rerender({ isOpen: false });
    await settleDebounce();
    expect(callsFor(method)).toEqual([]);
  });

  it.each([
    ['search.fileNames', '/'],
    ['search.messages', '?'],
    ['search.notes', '#'],
  ])('%s searches deliberately when its filter is selected', async (method, prefix) => {
    render(CommandPalette, {
      props: { isOpen: true, workspaceId: 'tiny-owl', initialQuery: '@ dev con', onClose: vi.fn() },
    });
    await settleDebounce();
    expect(callsFor(method)).toEqual([]);
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: prefix + ' dev con' } });
    await settleDebounce();
    expect(callsFor(method)).toEqual([[method, expectedParams(method, 'tiny-owl')]]);
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: '@ dev con' } });
    await settleDebounce();
    expect(callsFor(method)).toHaveLength(1);
  });

  it('updates remote result labels from workspace metadata without another search', async () => {
    workspaceItemsState.value = [
      { id: 'tiny-owl', title: 'Original workspace', repositoryName: 'original-repo' },
    ];
    backendRequestMock.mockImplementation(async (method) => {
      if (method === 'search.messages')
        return {
          matches: [
            {
              agentId: 'agent-1',
              messageId: 'message-1',
              workspaceId: 'tiny-owl',
              agentName: 'dev con agent',
              role: 'assistant',
              preview: 'dev con',
              timestamp: '2026-10-01T01:00:00Z',
            },
          ],
        };
      if (method === 'search.notes')
        return {
          indexed: true,
          requestId: 'r',
          matches: [
            {
              workspaceId: 'tiny-owl',
              noteId: 'spec',
              title: 'dev con plan',
              preview: 'dev con',
              score: 2,
              updatedAt: '2026-10-01T00:00:00Z',
              isArchived: false,
              workspaceArchived: false,
            },
          ],
        };
      return { files: [] };
    });
    render(CommandPalette, {
      props: { isOpen: true, workspaceId: 'tiny-owl', initialQuery: 'dev con', onClose: vi.fn() },
    });
    await settleDebounce();
    expect(screen.getByRole('button', { name: /dev con agent/ }).textContent).toContain(
      'Original workspace',
    );
    expect(screen.getByRole('button', { name: /dev con plan/ }).textContent).toContain(
      'Original workspace',
    );
    const initialCalls = backendRequestMock.mock.calls.slice();
    workspaceItemsState.value = [
      { id: 'tiny-owl', title: 'Renamed workspace', repositoryName: 'renamed-repo' },
    ];
    for (const subscriber of workspaceItemsState.subscribers) subscriber(workspaceItemsState.value);
    await settleDebounce();
    for (const label of ['dev con agent', 'dev con plan']) {
      const row = screen.getByRole('button', { name: new RegExp(label) });
      expect(row.textContent).toContain('Renamed workspace');
      expect(row.textContent).toContain('renamed-repo');
      expect(row.textContent).not.toContain('Original workspace');
    }
    expect(backendRequestMock.mock.calls).toEqual(initialCalls);
  });

  it('discards a file response received while closed instead of leaking it into reopening', async () => {
    let complete!: (value: any) => void;
    backendRequestMock.mockImplementation((method) =>
      method === 'search.fileNames'
        ? new Promise((resolve) => {
            complete = resolve;
          })
        : Promise.resolve({ indexed: true, requestId: 'r', matches: [] }),
    );
    const view = render(CommandPalette, {
      props: { isOpen: true, workspaceId: 'tiny-owl', initialQuery: 'obsolete', onClose: vi.fn() },
    });
    await settleDebounce();
    await view.rerender({ isOpen: false });
    complete({ files: ['obsolete-file.ts'] });
    await settleDebounce();
    await view.rerender({ isOpen: true });
    await vi.advanceTimersByTimeAsync(50);
    expect(screen.queryByRole('button', { name: /obsolete-file/ })).toBeNull();
    expect(callsFor('search.fileNames')).toHaveLength(1);
  });

  it('does not repeat a retained search after closing, workspace refreshes or workspace switches', async () => {
    const view = render(CommandPalette, {
      props: { isOpen: true, workspaceId: 'tiny-owl', initialQuery: 'dev con', onClose: vi.fn() },
    });
    await settleDebounce();
    expect(searches()).toEqual([
      ['search.messages', { query: 'dev con', limit: 10, preferWorkspaceId: 'tiny-owl' }],
    ]);
    await view.rerender({ isOpen: false });
    refreshWorkspaces();
    await settleDebounce();
    expect(searches()).toHaveLength(1);
    await view.rerender({ workspaceId: 'other' });
    refreshWorkspaces();
    await settleDebounce();
    expect(searches()).toHaveLength(1);

    await view.rerender({ isOpen: true });
    await settleDebounce();
    expect(searches()).toHaveLength(2);
    expect(searches()[1]).toEqual([
      'search.messages',
      { query: 'dev con', limit: 10, preferWorkspaceId: 'other' },
    ]);
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'fresh query' } });
    await settleDebounce();
    expect(searches()[2]).toEqual([
      'search.messages',
      { query: 'fresh query', limit: 10, preferWorkspaceId: 'other' },
    ]);
  });

  it('cancels the pending debounce when closed before the request starts', async () => {
    const view = render(CommandPalette, {
      props: { isOpen: true, workspaceId: 'tiny-owl', initialQuery: 'dev con', onClose: vi.fn() },
    });
    await view.rerender({ isOpen: false });
    await settleDebounce();
    expect(searches()).toEqual([]);
  });

  it('does not show an in-flight result completed after closing when reopened', async () => {
    let complete!: (value: any) => void;
    backendRequestMock.mockImplementation((method: string) =>
      method === 'search.messages'
        ? new Promise((resolve) => {
            complete = resolve;
          })
        : Promise.resolve({ files: [], matches: [] }),
    );
    const view = render(CommandPalette, {
      props: { isOpen: true, workspaceId: 'tiny-owl', initialQuery: 'dev con', onClose: vi.fn() },
    });
    await settleDebounce();
    expect(complete).toBeDefined();
    await view.rerender({ isOpen: false });
    complete({
      matches: [
        {
          agentId: 'agent-1',
          messageId: 'message-1',
          workspaceId: 'tiny-owl',
          agentName: 'Obsolete result',
          role: 'assistant',
          preview: 'dev con',
          timestamp: '2026-10-01T01:00:00Z',
        },
      ],
    });
    await settleDebounce();
    await view.rerender({ isOpen: true });
    expect(screen.queryByRole('button', { name: /Obsolete result/ })).toBeNull();
    expect(searches()).toHaveLength(1);
  });
});
