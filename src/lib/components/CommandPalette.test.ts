/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  gotoMock,
  navigateToSettingsMock,
  invokeMock,
  trackMock,
  workspaceItemsState,
  sessionSessions,
  reduxDispatchMock,
  browserRecentUrls,
  createSelectorReadable,
  paletteMruEntries,
  paletteFileMru,
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

  return {
    gotoMock: vi.fn(),
    navigateToSettingsMock: vi.fn(),
    invokeMock: vi.fn().mockResolvedValue({ files: [] }),
    trackMock: vi.fn(),
    workspaceItemsState: { value: [] as any[] },
    sessionSessions: { value: [] as any[] },
    reduxDispatchMock: vi.fn(),
    browserRecentUrls: { value: [] as any[] },
    createSelectorReadable,
    paletteMruEntries: { value: [] as any[] },
    paletteFileMru: { value: {} as Record<string, number> },
  };
});

vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToSettings: navigateToSettingsMock }));
vi.mock('$lib/electron-bridge', () => ({ invoke: invokeMock }));
vi.mock('$lib/store/slices/browser/browser-selectors', () => ({
  selectBrowserRecentUrls: Object.assign(
    vi.fn((workspaceIdArg: any) =>
      createSelectorReadable(workspaceIdArg, () => browserRecentUrls.value),
    ),
    { select: vi.fn(() => browserRecentUrls.value) },
  ),
}));
vi.mock('$lib/store/slices/browser/browser-slice', () => ({
  initBrowserWorkspace: vi.fn((...args: any[]) => ({
    type: 'browser/initBrowserWorkspace',
    payload: args,
  })),
}));
vi.mock('$lib/store/slices/palette/palette-selectors', () => ({
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
vi.mock('$lib/store/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceItems: () => ({
    subscribe: (fn: (value: any[]) => void) => {
      fn(workspaceItemsState.value);
      return () => {};
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
vi.mock('$lib/services/analytics', () => ({ track: trackMock }));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  dispatch: reduxDispatchMock,
  getReduxStore: () => ({
    getState: () => ({
      workspaceNotes: { byWorkspaceId: {} },
      workspaceAgents: { byWorkspaceId: {} },
      workspace: { activeWorkspaceId: 'ws-1' },
    }),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    subscribe: (listener: () => void) => () => {},
    dispatch: reduxDispatchMock,
  }),
}));
vi.mock('$lib/store/slices/workspace-agents/workspace-agents-slice', () => ({
  createAgentRequested: vi.fn((...args: any[]) => ({
    type: 'workspaceAgents/createAgentRequested',
    payload: args,
  })),
  emptyWorkspaceAgentState: {
    agents: { ids: [], map: {} },
    agentsLoaded: false,
    isLoadingAgents: false,
    initialAgentId: null,
    initialAgentConfigProcessed: false,
  },
}));
vi.mock('$lib/store/slices/workspace-agents/workspace-agents-selectors', () => ({
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
vi.mock('$lib/store/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: Object.assign(
    vi.fn((workspaceIdArg: any) => createSelectorReadable(workspaceIdArg, () => [])),
    { select: vi.fn(() => []) },
  ),
}));
vi.mock('$lib/store/slices/terminals/terminals-slice', () => ({
  createTerminalRequested: vi.fn((...args: any[]) => ({
    type: 'terminals/createTerminalRequested',
    payload: args,
  })),
}));
vi.mock('$lib/store/slices/note-read-tracking/note-read-tracking-slice', () => ({
  createNoteRequested: vi.fn((...args: any[]) => ({
    type: 'noteReadTracking/createNoteRequested',
    payload: args,
  })),
}));
vi.mock('$lib/store/slices/changes/changes-selectors', () => ({
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

vi.mock('$lib/components/ui/auggie-avatar/AuggieAvatar.svelte', async () => {
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
  faCodeBranch: { iconName: 'code-branch' },
  faPlus: { iconName: 'plus' },
  faGlobe: { iconName: 'globe' },
  faPlay: { iconName: 'play' },
}));

import CommandPalette from './CommandPalette.svelte';
import { createAgentRequested } from '$lib/store/slices/workspace-agents/workspace-agents-slice';
import { createTerminalRequested } from '$lib/store/slices/terminals/terminals-slice';
import { createNoteRequested } from '$lib/store/slices/note-read-tracking/note-read-tracking-slice';
import { commandPaletteNewFileRequested } from '$lib/store/slices/app-layout/app-layout-slice';

// Actions that dispatch Redux actions directly (no window event intermediary)
const reduxActions = [
  { label: 'Agent Chat', actionCreator: createAgentRequested },
  { label: 'Terminal', actionCreator: createTerminalRequested },
  { label: 'Note', actionCreator: createNoteRequested },
  { label: 'File', actionCreator: commandPaletteNewFileRequested },
] as const;

describe('CommandPalette new actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceItemsState.value = [];
    browserRecentUrls.value = [];
    sessionSessions.value = [];
    paletteMruEntries.value = [];
    paletteFileMru.value = {};
  });

  it('dispatches Redux actions for agent, terminal, note, and file from keyboard', async () => {
    const onClose = vi.fn();

    render(CommandPalette, { props: { isOpen: true, workspaceId: 'ws-1', onClose } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Agent Chat' }).className).toContain(
        'bg-foreground/[0.04]',
      );
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
