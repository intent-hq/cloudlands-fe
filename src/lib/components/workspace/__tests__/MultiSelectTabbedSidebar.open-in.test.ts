/**
 * @vitest-environment jsdom
 */
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSession } from '$shared/types';

import type { InstalledEditor } from '$store/renderer/slices/external-editors/external-editors-slice';
import {
  connectionStatusChanged,
  daemonHealthReducer,
  initialState as daemonHealthInitialState,
} from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { warmImport } from '../../../../test/warm-import';
import {
  configuredVisualStates,
  exerciseVisualStates,
} from '$lib/components/__tests__/helpers/visual-state-characterization';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const invoke = vi.fn().mockResolvedValue({ success: true });
  const openUserTab = vi.fn();
  const handleLink = vi.fn();
  const selector = <T>(value: T) =>
    Object.assign(
      () => ({
        subscribe(run: (current: T) => void) {
          run(value);
          return () => {};
        },
      }),
      { select: () => value },
    );
  const selectorFrom = <T>(getValue: () => T) =>
    Object.assign(
      () => ({
        subscribe(run: (current: T) => void) {
          run(getValue());
          return () => {};
        },
      }),
      { select: () => getValue() },
    );
  return {
    dispatch,
    invoke,
    openUserTab,
    handleLink,
    selector,
    selectorFrom,
    // eslint-disable-next-line themis/collection-state-shape -- test-only dynamic selector fixture
    agents: [] as AgentSession[],
    agentsLoading: false,
    notes: [] as Array<{ id: string; title: string; content: string }>,
    changes: [] as Array<{ id: string; file: string; relativePath: string }>,
    selectedTabs: ['overview'] as string[],
    selectedTabsByWorkspace: new Map<string, string[]>(),
    selectedTabListeners: new Set<() => void>(),
    setSelectedTabs(workspaceId: string, tabIds: string[]) {
      this.selectedTabsByWorkspace.set(workspaceId, tabIds);
      this.selectedTabListeners.forEach((listener) => listener());
    },
    runningAgentIds: new Set<string>(),
    focusedPanelId: 'source-panel',
    // Workspace-owned PR pool (PROTOCOL `workspace.pullRequests`) driving the
    // Changes launcher's PR dropdown; empty by default.
    pullRequests: [] as Array<{
      id: string;
      number: number;
      url: string;
      title: string;
      status: string;
      createdAt: string;
      updatedAt: string;
    }>,
  };
});

const editors: InstalledEditor[] = [
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

let mockStoreState: Record<string, unknown>;

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => mockStoreState, dispatch: mocks.dispatch });
});

vi.mock('$lib/utils/platform-capabilities', () => ({
  hasCapability: () => true,
  isElectronPlatform: () => true,
}));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/components/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$features/navigation/link-handler', () => ({ handleLink: mocks.handleLink }));

vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectCurrentWorkspaceId: mocks.selector('ws-1'),
  selectStagedWorkingChanges: mocks.selectorFrom(() => mocks.changes),
  selectUnstagedWorkingChanges: mocks.selector([]),
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectActiveTab: mocks.selector(null),
  selectAllTabs: mocks.selector([]),
  selectFocusedPanelId: { select: () => mocks.focusedPanelId },
  getPanelTabOpenState: () => ({
    count: 0,
    isOpen: false,
    isActive: false,
    isOpenElsewhere: false,
  }),
}));
vi.mock('$store/renderer/slices/scripts/scripts-selectors', () => ({
  selectWorkspaceScriptEntries: mocks.selector([]),
}));
vi.mock('$store/renderer/slices/terminals/terminals-selectors', () => ({
  selectActiveTerminalIdForWorkspace: mocks.selector(null),
  selectTerminalsForWorkspace: mocks.selector([]),
}));
vi.mock('$store/renderer/slices/app-layout/app-layout-selectors', () => ({
  selectPendingLocateInSidebar: mocks.selector(null),
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: mocks.selectorFrom(() => mocks.agents),
  selectForegroundWorkspaceAgents: mocks.selector([]),
  selectIsLoadingAgents: mocks.selectorFrom(() => mocks.agentsLoading),
  selectIsLoadingRetiredAgents: mocks.selector(false),
  selectRetiredAgentsLoaded: mocks.selector(false),
  selectRetiredCount: mocks.selector(0),
  selectWorkspaceHasUnreadForegroundAgents: mocks.selector(false),
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentIsResponding: mocks.selector(false),
  selectAgentIsWaiting: mocks.selector(false),
  selectAgentIsRunning: { select: (_state: unknown, id: string) => mocks.runningAgentIds.has(id) },
  selectAgentSessionStreamingContent: { select: () => '' },
}));
vi.mock('$store/renderer/slices/file-explorer/file-explorer-selectors', () => ({
  selectEffectiveFileExplorerWorkspacePath: mocks.selector('/tmp/project'),
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: mocks.selectorFrom(() => ({
    id: 'ws-1',
    title: 'Project',
    path: '/tmp/project',
    worktreePath: '/tmp/project',
    skipWorktree: false,
    repositoryOwner: 'intent-hq',
    repositoryName: 'project',
    pullRequests: mocks.pullRequests,
  })),
  selectWorkspaceActivePullRequest: mocks.selector(null),
  selectIsWorkspaceHostLocal: mocks.selector(true),
}));
vi.mock('$store/renderer/slices/pr-monitor/pr-monitor-selectors', () => ({
  selectPrMonitors: mocks.selector([]),
}));
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: mocks.selectorFrom(() => mocks.notes),
  selectNotesLoading: mocks.selector(false),
}));
vi.mock('$store/renderer/slices/sidebar-nav/sidebar-nav-selectors', () => ({
  selectMultiSelectSidebarSelectedTabIds: (workspaceIdStore: {
    subscribe: (run: (workspaceId: string) => void) => () => void;
  }) => ({
    subscribe(run: (tabIds: string[]) => void) {
      let workspaceId = '';
      const emit = () => run(mocks.selectedTabsByWorkspace.get(workspaceId) ?? mocks.selectedTabs);
      const unsubscribeWorkspaceId = workspaceIdStore.subscribe((nextWorkspaceId) => {
        workspaceId = nextWorkspaceId;
        emit();
      });
      mocks.selectedTabListeners.add(emit);
      return () => {
        unsubscribeWorkspaceId();
        mocks.selectedTabListeners.delete(emit);
      };
    },
  }),
  selectMultiSelectSidebarTabOrder: mocks.selector([
    'overview',
    'agents',
    'context',
    'changes',
    'files',
  ]),
}));
vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', () => ({
  selectWorkspaceTaskProgress: mocks.selector(null),
}));
vi.mock('$store/renderer/slices/workspace-events/workspace-events-selectors', () => ({
  selectWorkspaceEvents: mocks.selector([]),
}));
vi.mock('$store/renderer/slices/hud/hud-selectors', () => ({
  selectHudAgentHasPendingQuestion: { select: () => false },
  selectHudQuestionsByAgentId: mocks.selector({}),
}));
vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: () => ({ openUserTab: mocks.openUserTab }),
}));
vi.mock('../workspace-phase', () => ({
  deriveWorkspacePhase: () => ({
    phase: 'planning',
    label: 'Planning',
    subtitle: 'Plan',
    isActive: false,
  }),
  deriveWorkspaceStats: () => ({
    tasks: { total: 0, completed: 0, inProgress: 0, notStarted: 0 },
    files: { changed: 0, additions: 0, deletions: 0 },
    commits: { total: 0, unpushed: 0 },
    pr: { hasOpen: false, hasMerged: false, hasClosed: false },
  }),
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../../ui/__tests__/mocks/Fa.svelte')).default,
}));
vi.mock('$features/agent/components/agent-avatar/AgentAvatarWithState.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('$lib/components/ui/button', async () => ({
  Button: (await import('../../ui/__tests__/mocks/button.svelte')).default,
}));
vi.mock('$lib/components/ui/dropdown-menu.svelte', async () => ({
  default: (await import('../../ui/__tests__/mocks/dropdown-menu.svelte')).default,
}));

vi.mock('../CreateAgentSection.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('../WorkspaceAgentsList.svelte', async () => ({
  default: (await import('./mocks/WorkspaceAgentsList.svelte')).default,
}));
vi.mock('../sidebar/AddContextSection.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('../sidebar/ContextPanel.svelte', async () => ({
  default: (await import('./mocks/ContextPanel.svelte')).default,
}));
vi.mock('../sidebar/WorkspaceProgressCard.svelte', async () => ({
  default: (await import('./mocks/WorkspaceProgressCard.svelte')).default,
}));
vi.mock('../WorkspaceTerminalDock.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('../SidebarBrowserLauncher.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('$lib/components/ui/input/input.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('../sidebar', async () => {
  const simple = (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default;
  const filesPanel = (await import('./mocks/FilesPanel.svelte')).default;
  return {
    FilesPanel: filesPanel,
    SidebarChangesPanel: simple,
    isChildNote: () => false,
    isSpecNote: (noteId: string) => noteId === 'spec',
  };
});

warmImport(() => import('../../ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../../ui/__tests__/mocks/button.svelte'));
warmImport(() => import('../../ui/__tests__/mocks/dropdown-menu.svelte'));
warmImport(() => import('./mocks/FilesPanel.svelte'));
warmImport(() => import('./mocks/ContextPanel.svelte'));
warmImport(() => import('./mocks/WorkspaceAgentsList.svelte'));
warmImport(() => import('../MultiSelectTabbedSidebar.svelte'));

function makeAgent(
  id: string,
  options: {
    unread?: boolean;
    lastActivity?: string;
    createdAt?: string;
    isInitialAgent?: boolean;
    specialist?: string;
  } = {},
) {
  return {
    id,
    name: id,
    messages: [],
    hasUnread: options.unread ?? false,
    lastActivity: options.lastActivity ?? '2026-08-12T00:00:00.000Z',
    createdAt: options.createdAt ?? '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
    isInitialAgent: options.isInitialAgent,
    metadata: options.specialist ? { specialist: options.specialist } : undefined,
  } as unknown as AgentSession;
}

describe('MultiSelectTabbedSidebar Files Open In', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const localHealth = daemonHealthReducer(
      {
        ...daemonHealthInitialState,
        transport: { mode: 'external-ws', target: 'wss://remote.example' },
        hostLocality: 'remote',
      },
      connectionStatusChanged('connected', {
        mode: 'sidecar-uds',
        target: '/tmp/intentd.sock',
      }),
    );
    mockStoreState = {
      daemonHealth: localHealth,
      externalEditors: {
        selectedAction: 'vscode',
        editors: createCollection<InstalledEditor, 'id'>('id', editors),
        hiddenEditorIds: [],
        loading: false,
        error: null,
        lastFetched: 0,
      },
    };
    mocks.agents = [];
    mocks.agentsLoading = false;
    mocks.notes = [];
    mocks.changes = [];
    mocks.selectedTabs = ['overview'];
    mocks.selectedTabsByWorkspace.clear();
    mocks.runningAgentIds.clear();
    mocks.focusedPanelId = 'source-panel';
    mocks.pullRequests = [];
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('affirms the Files Open in chooser in every required visual state', async () => {
    const observed = await exerciseVisualStates(async () => {
      const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
      const view = render(Sidebar, { props: { workspaceId: 'ws-1' } });
      const target = view.getByRole('button', { name: /Open in/ });
      return {
        ...view,
        target,
        assertCapability: async () => {
          await fireEvent.click(target);
          await waitFor(() =>
            expect(view.container.querySelector('.dropdown-content')).toBeTruthy(),
          );
          expect(view.container.querySelector('[data-sidebar-launcher="files"]')).toBeTruthy();
          expect(view.getByText('Copy path')).toBeTruthy();
        },
      };
    });
    expect(observed).toEqual(configuredVisualStates);
  });

  it('opens the isolated compact Files chooser and routes the installed editor action', async () => {
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const { container, getByRole, getByText } = render(Sidebar, {
      props: { workspaceId: 'ws-1' },
    });
    const filesLauncher = container.querySelector('[data-sidebar-launcher="files"]')!;
    const trigger = getByRole('button', { name: /Open in/ });
    const fullCardTrigger = filesLauncher.querySelector('[aria-expanded="false"]');
    const glyph = trigger.querySelector('[data-files-open-in] .fa-icon');

    expect(glyph?.classList.contains('size-4!')).toBe(true);
    await fireEvent.pointerDown(trigger);
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await fireEvent.keyDown(trigger, { key: ' ' });
    expect(fullCardTrigger?.getAttribute('aria-expanded')).toBe('false');

    await fireEvent.click(trigger);
    await waitFor(() => expect(container.querySelector('.dropdown-content')).toBeTruthy());
    expect(container.querySelector('[data-testid="sidebar-launchers"]')).toBeTruthy();
    expect(fullCardTrigger?.getAttribute('aria-expanded')).toBe('false');
    expect(getByText('Other')).toBeTruthy();
    expect(getByText('Copy path')).toBeTruthy();

    await fireEvent.click(getByText('Visual Studio Code'));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('vscode:open', '/tmp/project'));
  });

  it('lists every workspace PR in the Changes trailing dropdown and opens the clicked one', async () => {
    const openPrUrl = 'https://github.com/intent-hq/project/pull/1373';
    const mergedPrUrl = 'https://github.com/intent-hq/project/pull/1201';
    mocks.pullRequests = [
      {
        id: 'pr-1201',
        number: 1201,
        url: mergedPrUrl,
        title: 'An earlier merged pull request',
        status: 'Merged',
        createdAt: '2026-08-10T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
      },
      {
        id: 'pr-1373',
        number: 1373,
        url: openPrUrl,
        title: 'An open pull request',
        status: 'Open',
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
      },
    ];
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const { container } = render(Sidebar, { props: { workspaceId: 'ws-1' } });
    const launcher = container.querySelector<HTMLElement>('[data-sidebar-launcher="changes"]')!;
    const cardAction = launcher.querySelector<HTMLButtonElement>('.launcher-tile-action')!;
    const label = launcher.querySelector<HTMLElement>('[data-sidebar-launcher-label]')!;
    const dropdown = launcher.querySelector<HTMLElement>('[data-sidebar-pr-dropdown]')!;
    const trigger = launcher.querySelector<HTMLButtonElement>('[data-sidebar-pr-trigger]')!;
    const resource = container.querySelector<HTMLElement>('[data-sidebar-changes-resource]');

    expect(label.textContent).toBe('Changes');
    expect(label.nextElementSibling).toBe(dropdown);
    expect(label.className).toContain('flex-1');
    expect(label.className).toContain('truncate');
    expect(dropdown.className).toContain('ml-auto');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.dataset.sidebarPrCount).toBe('2');
    // The trigger glyph follows the highest-priority row (open beats merged).
    expect(trigger.querySelectorAll('.fa-icon')).toHaveLength(1);
    const prIcon = trigger.querySelector<HTMLElement>('.fa-icon')!;
    expect(prIcon.dataset.icon).toBe('code-pull-request');
    expect(prIcon.className).toContain('text-success');
    expect(launcher.querySelector('[data-sidebar-pr-link]')).toBeNull();
    expect(launcher.textContent).not.toContain('1,373');
    expect(
      resource
        ?.querySelector('[data-resource-icon-tile]')
        ?.getAttribute('data-resource-icon-variant'),
    ).toBe('emphasized');

    await fireEvent.click(trigger);
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'));
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sidebarNav/setMultiSelectSidebarSelectedTabs' }),
    );
    const links = [...launcher.querySelectorAll<HTMLButtonElement>('[data-sidebar-pr-link]')];
    expect(links.map((link) => link.dataset.sidebarPrUrl)).toEqual([openPrUrl, mergedPrUrl]);
    expect(links.map((link) => link.dataset.prStatus)).toEqual(['open', 'merged']);
    expect(links[0].textContent).toContain('An open pull request');
    expect(links[1].textContent).toContain('An earlier merged pull request');

    await fireEvent.click(links[1]);
    expect(mocks.handleLink).toHaveBeenCalledWith(mergedPrUrl, { workspaceId: 'ws-1' });
    expect(mocks.handleLink).not.toHaveBeenCalledWith(openPrUrl, expect.anything());
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'));
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sidebarNav/setMultiSelectSidebarSelectedTabs' }),
    );

    await fireEvent.click(cardAction);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sidebarNav/setMultiSelectSidebarSelectedTabs' }),
    );
  });

  it('exposes the same PR dropdown in the expanded Changes card header', async () => {
    const prUrl = 'https://github.com/intent-hq/project/pull/77';
    mocks.pullRequests = [
      {
        id: 'pr-77',
        number: 77,
        url: prUrl,
        title: 'Expanded card pull request',
        status: 'Open',
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
      },
    ];
    mocks.selectedTabs = ['changes'];
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const { container } = render(Sidebar, { props: { workspaceId: 'ws-1' } });
    const card = container.querySelector<HTMLElement>('[data-sidebar-card-tab="changes"]')!;
    const trigger = card.querySelector<HTMLButtonElement>('[data-sidebar-pr-trigger]')!;

    expect(trigger).toBeTruthy();
    expect(trigger.dataset.sidebarPrCount).toBe('1');
    await fireEvent.click(trigger);
    const link = await waitFor(() => {
      const found = card.querySelector<HTMLButtonElement>('[data-sidebar-pr-link]');
      expect(found).toBeTruthy();
      return found!;
    });
    expect(link.dataset.sidebarPrUrl).toBe(prUrl);
    await fireEvent.click(link);
    expect(mocks.handleLink).toHaveBeenCalledWith(prUrl, { workspaceId: 'ws-1' });
    // Opening a PR from the header must not collapse the expanded card.
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sidebarNav/setMultiSelectSidebarSelectedTabs' }),
    );
  });

  it('keeps the Changes card PR-free when the workspace has no pull requests', async () => {
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const { container } = render(Sidebar, { props: { workspaceId: 'ws-1' } });

    expect(container.querySelector('[data-sidebar-pr-trigger]')).toBeNull();
    expect(container.querySelector('[data-sidebar-pr-link]')).toBeNull();
    expect(container.querySelector('[data-sidebar-changes-resource]')).not.toBeNull();
  });

  it.each([
    { total: 0, visible: 0, overflow: 0 },
    { total: 1, visible: 1, overflow: 0 },
    { total: 6, visible: 6, overflow: 0 },
    { total: 8, visible: 6, overflow: 2 },
    { total: 26, visible: 6, overflow: 20 },
  ])(
    'renders $total Agents and Context items as six plus semantic overflow',
    async ({ total, visible, overflow }) => {
      mocks.agents = Array.from({ length: total }, (_, index) => makeAgent(`agent-${index}`));
      mocks.notes = Array.from({ length: total }, (_, index) => ({
        id: `note-${index}`,
        title: `Note ${index}`,
        content: '',
      }));
      const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
      const { container, queryByRole } = render(Sidebar, { props: { workspaceId: 'ws-1' } });
      const agentStack = container.querySelector<HTMLElement>(
        '[data-sidebar-launcher="agents"] [data-agent-avatar-stack]',
      )!;

      expect(agentStack.querySelectorAll('[data-agent-avatar-stack-item]')).toHaveLength(visible);
      expect(container.querySelectorAll('[data-sidebar-context]')).toHaveLength(visible);
      expect(
        container.querySelector('[data-sidebar-launcher="agents"] [aria-labelledby]'),
      ).toBeTruthy();
      if (overflow > 0) {
        expect(agentStack.querySelector('[data-agent-avatar-overflow]')?.textContent).toBe(
          `+${overflow}`,
        );
        expect(queryByRole('button', { name: new RegExp(`${overflow} more notes`) })).toBeTruthy();
      } else {
        expect(agentStack.querySelector('[data-agent-avatar-overflow]')).toBeNull();
        expect(container.querySelector('[data-sidebar-context-overflow]')).toBeNull();
      }
    },
  );

  it('keeps the compact Agents launcher stable while sessions are loading', async () => {
    mocks.agentsLoading = true;
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const { container, getByRole } = render(Sidebar, { props: { workspaceId: 'ws-1' } });

    expect(getByRole('button', { name: /Agents.*0 agents total/ })).toBeTruthy();
    expect(container.querySelectorAll('[data-agent-avatar-stack-item]')).toHaveLength(0);
    expect(container.querySelector('[data-agent-avatar-overflow]')).toBeNull();
  });

  it.each([1, 4, 6])('uses the shared logical-start stack at %i-item density', async (count) => {
    mocks.agents = Array.from({ length: count }, (_, index) =>
      makeAgent(`agent-${index}`, { isInitialAgent: index === 0 }),
    );
    mocks.notes = Array.from({ length: count }, (_, index) => ({
      id: index === count - 1 ? 'spec' : `note-${index}`,
      title: `Note ${index}`,
      content: '',
    }));
    mocks.changes = Array.from({ length: count }, (_, index) => ({
      id: `change-${index}`,
      file: `/tmp/file-${index}.ts`,
      relativePath: `file-${index}.ts`,
    }));
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const { container } = render(Sidebar, { props: { workspaceId: 'ws-1' } });
    const card = container.querySelector<HTMLElement>('[data-sidebar-launcher="agents"]')!;
    const stack = card.querySelector<HTMLElement>('[data-agent-avatar-stack]')!;
    const items = [...stack.querySelectorAll<HTMLElement>('[data-agent-avatar-stack-item]')];
    expect(card.className).not.toMatch(/-ml-|negative/);
    expect(stack.dataset.agentAvatarStackAlign).toBe('start');
    expect(stack.dataset.agentAvatarStackOverlap).toBe('later-on-top');
    expect(stack.dataset.avatarVariant).toBe('standard');
    expect(items).toHaveLength(count);
    expect(items.map((item) => item.style.zIndex)).toEqual(
      Array.from({ length: count }, (_, index) => String(index + 1)),
    );
  });

  it('uses interactive shared-stack agents and filled overflow tiles', async () => {
    mocks.agents = Array.from({ length: 8 }, (_, index) => makeAgent(`agent-${index}`));
    mocks.notes = Array.from({ length: 8 }, (_, index) => ({
      id: index === 7 ? 'spec' : `note-${index}`,
      title: `Note ${index}`,
      content: '',
    }));
    mocks.changes = Array.from({ length: 8 }, (_, index) => ({
      id: `change-${index}`,
      file: `/tmp/file-${index}.ts`,
      relativePath: `file-${index}.ts`,
    }));
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const { container, getByRole } = render(Sidebar, { props: { workspaceId: 'ws-1' } });
    const agentCard = container.querySelector<HTMLElement>('[data-sidebar-launcher="agents"]')!;
    const agentStack = agentCard.querySelector<HTMLElement>('[data-agent-avatar-stack]')!;
    const agentOverflow = agentStack.querySelector<HTMLElement>('[data-agent-avatar-overflow]')!;
    const contextStack = container.querySelector<HTMLElement>(
      '[data-sidebar-launcher="context"] [data-sidebar-launcher-icons]',
    )!;
    const noteOverflow = getByRole('button', { name: /2 more notes/ });
    const expectNoteOverflowStyle = (overflow: HTMLElement) => {
      expect(overflow.className).toContain('launcher-overflow-button');
      expect(overflow.className).toContain('text-xs');
      expect(overflow.className).toContain('font-medium');
      expect(overflow.className).toContain('leading-3');
      expect(overflow.className).toContain('text-muted-foreground');
      expect(overflow.className).toContain('whitespace-nowrap');
      expect(overflow.className).toContain('bg-muted!');
      expect(overflow.className).toContain('border-0!');
      expect(overflow.className).toContain('px-1.5!');
      expect(overflow.className).toContain('shadow-none!');
      expect(overflow.className).toContain('min-w-5');
      expect(overflow.className).toContain('rounded-md!');
      expect(overflow.className).toContain('hover:bg-muted\/80!');
      expect(overflow.className).toContain('hover:text-foreground');
      expect(overflow.className).toContain('focus-visible:text-foreground');
      expect(overflow.className).not.toMatch(/font-semibold/);
      const style = getComputedStyle(overflow);
      expect(overflow.style.fontSize).toBe('');
      expect(style.lineHeight).toBe('12px');
      expect(style.fontWeight).toBe('500');
      expect(style.borderRadius).toBe('6px');
      expect(overflow.style.background).toContain('--muted');
      expect(style.paddingTop).toBe('0px');
      expect(style.boxShadow).toBe('none');
    };

    expect(agentCard.classList.contains('overflow-hidden')).toBe(true);
    expect(agentStack.querySelectorAll('[data-agent-avatar-stack-item]')).toHaveLength(6);
    expect(agentStack.querySelectorAll('button[data-sidebar-agent]')).toHaveLength(6);
    expect(agentOverflow.matches('button, [role="button"], [tabindex]')).toBe(false);
    expect(agentOverflow.textContent).toBe('+2');
    expect(agentOverflow.className).toContain('agent-avatar-stack-overflow');
    expect(contextStack.style.gridTemplateColumns).toBe(
      'max-content repeat(4, 15px) 36px max-content',
    );
    expectNoteOverflowStyle(noteOverflow);
    for (const theme of ['light', 'dark'] as const) {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      document.documentElement.dataset.theme = theme;
      for (const zoom of [1, 2]) {
        container.style.zoom = String(zoom);
        expect(agentOverflow.className).toContain('agent-avatar-stack-overflow');
      }
    }
    container.style.removeProperty('zoom');
    document.documentElement.classList.remove('dark');
    delete document.documentElement.dataset.theme;
  });

  it('uses contained outline-free keyboard focus states for every preview target', async () => {
    mocks.agents = Array.from({ length: 8 }, (_, index) => makeAgent(`agent-${index}`));
    mocks.notes = Array.from({ length: 8 }, (_, index) => ({
      id: index === 7 ? 'spec' : `note-${index}`,
      title: `Note ${index}`,
      content: '',
    }));
    mocks.changes = [{ id: 'change', file: '/tmp/file.ts', relativePath: 'file.ts' }];
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const { container } = render(Sidebar, { props: { workspaceId: 'ws-1' } });

    for (const target of container.querySelectorAll<HTMLElement>('[data-launcher-preview-item]')) {
      if (target.hasAttribute('data-sidebar-agent')) {
        expect(target.className).toContain('launcher-agent-avatar-button');
        expect(target.className).toContain('size-5');
        expect(target.className).toContain('focus-visible:ring-1');
        expect(target.className).toContain('focus-visible:ring-ring');
        expect(target.className).not.toMatch(/(?:^|\s)focus-visible:outline-(?!none)/);
        continue;
      }
      const glyph = target.querySelector<HTMLElement>('[data-sidebar-launcher-glyph]');
      const isAgentGlyph = glyph?.className.includes('group-hover/preview:opacity');
      if (glyph) {
        expect(glyph.className).toContain('launcher-glyph');
        if (isAgentGlyph) {
          // Agent glyphs use opacity transitions on hover/focus for semantic status colors
          expect(glyph.className).toContain('group-hover/preview:opacity-90');
          expect(glyph.className).toContain('group-focus-visible/preview:opacity-80');
        } else {
          // Note resource tiles own the visible background transitions.
          const tile = glyph.querySelector<HTMLElement>('[data-resource-icon-tile]');
          expect(tile?.className).toContain('group-hover/preview:bg-background/70!');
          expect(tile?.className).toContain('group-focus-visible/preview:bg-background/80!');
        }
        expect(target.className).not.toContain('focus-visible:bg-background/80');
      } else {
        // Overflow buttons
        expect(target.className).toContain('bg-muted!');
        expect(target.className).toContain('focus-visible:text-foreground');
        expect(target.className).toContain('hover:bg-muted/80!');
      }
      expect(target.className).not.toMatch(/(?:^|\s)focus-visible:ring-/);
      expect(target.className).not.toMatch(/(?:^|\s)focus-visible:outline-(?!none)/);
      expect(target.className).not.toContain('focus-visible:shadow-');
    }
  });

  it('keeps a filled +N tile inside the shared logical-start stack', async () => {
    mocks.agents = Array.from({ length: 8 }, (_, index) => makeAgent(`agent-${index}`));
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const { container } = render(Sidebar, { props: { workspaceId: 'ws-1' } });
    const card = container.querySelector<HTMLElement>('[data-sidebar-launcher="agents"]')!;
    const stack = card.querySelector<HTMLElement>('[data-agent-avatar-stack]')!;
    const overflow = stack.querySelector<HTMLElement>('[data-agent-avatar-overflow]')!;

    expect(card.className).not.toMatch(/-ml-/);
    expect(stack.dataset.agentAvatarStackAlign).toBe('start');
    expect(overflow.parentElement).toBe(stack);
    expect(overflow.textContent).toBe('+2');
    expect(overflow.className).toContain('agent-avatar-stack-overflow');
  });

  it('affirms coordinator and Spec ordering in every required visual state', async () => {
    const observed = await exerciseVisualStates(async () => {
      mocks.agents = [makeAgent('worker'), makeAgent('coordinator', { isInitialAgent: true })];
      mocks.runningAgentIds.add('worker');
      mocks.notes = [
        { id: 'note-1', title: 'Reference', content: '' },
        { id: 'spec', title: 'Spec', content: '' },
      ];
      const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
      const view = render(Sidebar, { props: { workspaceId: 'ws-1' } });
      const target = view.getByTestId('agent-panel-toggle');
      return {
        ...view,
        target,
        assertCapability: () => {
          expect(
            view.container
              .querySelector('[data-agent-avatar-stack-item]')
              ?.getAttribute('data-agent-avatar-stack-key'),
          ).toBe('coordinator');
          expect(
            view.container
              .querySelector('[data-sidebar-context]')
              ?.getAttribute('data-sidebar-context'),
          ).toBe('spec');
        },
      };
    });
    expect(observed).toEqual(configuredVisualStates);
  });

  it('orders every member for the launcher and expands overflow to the complete agents list', async () => {
    mocks.agents = Array.from({ length: 8 }, (_, index) =>
      makeAgent(`agent-${index}`, {
        unread: index === 2,
        lastActivity: `2026-08-12T00:00:0${index}.000Z`,
        specialist: index === 2 ? 'implementor' : index === 5 ? 'verifier' : undefined,
      }),
    );
    mocks.runningAgentIds.add('agent-1');
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const overview = render(Sidebar, { props: { workspaceId: 'ws-1' } });

    const collapsedDesignInputs = [
      ...overview.container.querySelectorAll<HTMLElement>('[data-agent-avatar-stack-item]'),
    ].map((item) => ({
      agentId: item.dataset.agentAvatarStackAgentId,
      specialist: item.dataset.agentAvatarStackSpecialist,
    }));
    expect(collapsedDesignInputs.map(({ agentId }) => agentId)).toEqual([
      'agent-1',
      'agent-2',
      'agent-7',
      'agent-6',
      'agent-5',
      'agent-4',
    ]);
    expect(overview.getByTestId('sidebar-agent-overflow').textContent).toBe('+2');
    const cardAction = overview.getByTestId('agent-panel-toggle');
    cardAction.focus();
    expect(document.activeElement).toBe(cardAction);
    await fireEvent.click(cardAction);
    expect(mocks.dispatch).toHaveBeenCalled();

    cleanup();
    mocks.selectedTabs = ['agents'];
    const expanded = render(Sidebar, { props: { workspaceId: 'ws-1' } });
    expect(expanded.container.querySelectorAll('[data-expanded-agent]')).toHaveLength(8);
    const expandedDesignInputs = [
      ...expanded.container.querySelectorAll<HTMLElement>('[data-expanded-agent]'),
    ].map((item) => ({
      agentId: item.dataset.expandedAgent,
      specialist: item.dataset.expandedAgentSpecialist,
    }));
    const expandedByAgentId = new Map(
      expandedDesignInputs.map((input) => [input.agentId, input.specialist]),
    );
    expect(collapsedDesignInputs).toContainEqual({
      agentId: 'agent-2',
      specialist: 'implementor',
    });
    expect(collapsedDesignInputs).toContainEqual({
      agentId: 'agent-5',
      specialist: 'verifier',
    });
    for (const input of collapsedDesignInputs) {
      expect(expandedByAgentId.get(input.agentId)).toBe(input.specialist);
    }
  });

  it('opens the exact collapsed-stack agent without expanding the Agents card', async () => {
    mocks.agents = [makeAgent('agent-a'), makeAgent('agent-b', { specialist: 'verifier' })];
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const { container } = render(Sidebar, {
      props: { workspaceId: 'ws-1', panelLayoutId: 'layout-1' },
    });
    const target = container.querySelector<HTMLButtonElement>('[data-sidebar-agent="agent-b"]')!;

    mocks.dispatch.mockClear();
    target.focus();
    await fireEvent.click(target);
    expect(document.activeElement).toBe(target);
    expect(
      mocks.dispatch.mock.calls.filter(
        ([action]) => action.type === 'appLayout/openAgentTabRequested',
      ),
    ).toEqual([
      [
        expect.objectContaining({
          payload: [
            'ws-1',
            {
              agentId: 'agent-b',
              panelLayoutId: 'layout-1',
              sourcePanelId: 'source-panel',
            },
          ],
        }),
      ],
    ]);
    expect(
      mocks.dispatch.mock.calls.some(
        ([action]) => action.type === 'sidebarNav/setMultiSelectSidebarSelectedTabs',
      ),
    ).toBe(false);
  });

  it.each([
    { selectedTab: 'agents', target: '[data-expanded-agent="agent-b"]' },
    { selectedTab: 'context', target: '[data-context-agent-callback]' },
    { selectedTab: 'files', target: '[data-files-agent-callback]' },
  ])('routes the $selectedTab agent callback through ordinary rightmost intent', async (entry) => {
    mocks.agents = [makeAgent('agent-b')];
    mocks.selectedTabs = [entry.selectedTab];
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const { container } = render(Sidebar, {
      props: { workspaceId: 'ws-1', panelLayoutId: 'layout-1' },
    });

    mocks.dispatch.mockClear();
    await fireEvent.click(container.querySelector(entry.target)!);

    const requests = mocks.dispatch.mock.calls.filter(
      ([action]) => action.type === 'appLayout/openAgentTabRequested',
    );
    expect(requests).toEqual([
      [
        expect.objectContaining({
          payload: [
            'ws-1',
            {
              agentId: 'agent-b',
              panelLayoutId: 'layout-1',
              sourcePanelId: 'source-panel',
            },
          ],
        }),
      ],
    ]);
    expect(requests[0]?.[0].payload[1]).not.toHaveProperty('openInNewColumn');
    expect(requests[0]?.[0].payload[1]).not.toHaveProperty('openInAdjacentPanel');
    expect(requests[0]?.[0].payload[1]).not.toHaveProperty('targetPanelId');
    expect(requests[0]?.[0].payload[1]).not.toHaveProperty('adaptiveFirstChat');
    expect(requests[0]?.[0].payload[1]).not.toHaveProperty('availablePanelCanvasWidth');
  });

  it('routes a modified Agents card click through adjacent intent', async () => {
    mocks.agents = [makeAgent('agent-b')];
    mocks.selectedTabs = ['agents'];
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const { container } = render(Sidebar, {
      props: { workspaceId: 'ws-1', panelLayoutId: 'layout-1' },
    });

    mocks.dispatch.mockClear();
    await fireEvent.click(container.querySelector('[data-expanded-agent="agent-b"]')!, {
      ctrlKey: true,
    });

    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'appLayout/openAgentTabRequested',
        payload: [
          'ws-1',
          expect.objectContaining({
            agentId: 'agent-b',
            sourcePanelId: 'source-panel',
            openInAdjacentPanel: true,
          }),
        ],
      }),
    );
  });

  it('keeps compact Context-card and Spec-icon actions separate', async () => {
    mocks.agents = [makeAgent('primary', { isInitialAgent: true })];
    mocks.notes = [{ id: 'spec', title: 'Spec', content: '' }];
    mocks.changes = [{ id: 'change', file: '/tmp/file.ts', relativePath: 'file.ts' }];
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const { container } = render(Sidebar, { props: { workspaceId: 'ws-1' } });

    mocks.dispatch.mockClear();
    await fireEvent.click(container.querySelector('[data-testid="agent-panel-toggle"]')!);
    expect(
      mocks.dispatch.mock.calls.filter(
        ([action]) => action.type === 'appLayout/openAgentTabRequested',
      ),
    ).toHaveLength(0);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sidebarNav/setMultiSelectSidebarSelectedTabs',
        payload: ['ws-1', ['agents']],
      }),
    );

    const contextCard = container.querySelector<HTMLElement>('[data-sidebar-launcher="context"]')!;
    const contextAction = within(contextCard).getByRole('button', { name: 'Expand panel' });
    const specButton = within(contextCard).getByRole('button', { name: 'Spec' });
    const contextSelections = () =>
      mocks.dispatch.mock.calls.filter(
        ([action]) =>
          action.type === 'sidebarNav/setMultiSelectSidebarSelectedTabs' &&
          action.payload?.[1]?.[0] === 'context',
      );

    mocks.openUserTab.mockClear();
    mocks.dispatch.mockClear();
    await fireEvent.click(specButton);
    expect(mocks.openUserTab).toHaveBeenCalledTimes(1);
    expect(mocks.openUserTab).toHaveBeenCalledWith(expect.objectContaining({ noteId: 'spec' }));
    expect(contextSelections()).toHaveLength(0);

    mocks.dispatch.mockClear();
    await fireEvent.click(contextAction);
    expect(contextSelections()).toHaveLength(1);
  });

  it('keeps Changes while omitting Activity Log and Local Changes previews', async () => {
    mocks.changes = [{ id: 'change', file: '/tmp/file.ts', relativePath: 'file.ts' }];
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const overview = render(Sidebar, { props: { workspaceId: 'ws-1' } });

    expect(overview.container.querySelector('[data-testid="sidebar-activity-preview"]')).toBeNull();
    expect(overview.container.querySelector('[data-sidebar-local-changes-summary]')).toBeNull();
    expect(overview.container.querySelector('[data-sidebar-launcher="changes"]')).toBeTruthy();
    expect(overview.container.querySelector('[data-sidebar-change]')).toBeNull();
    cleanup();

    mocks.selectedTabs = ['changes'];
    const expanded = render(Sidebar, { props: { workspaceId: 'ws-1' } });
    expect(expanded.container.querySelector('[data-sidebar-overlay]')).toBeTruthy();
    expect(expanded.container.querySelector('[data-sidebar-changes-panel]')).toBeTruthy();
    expect(expanded.container.querySelector('[data-testid="sidebar-activity-preview"]')).toBeNull();
    expect(expanded.container.querySelector('[data-sidebar-local-changes-summary]')).toBeNull();
  });

  it('dismisses expanded overlay and footer backdrops without navigator propagation', async () => {
    mocks.agents = [makeAgent('agent-1')];
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;

    // Overview state: the workspace actions kebab is available.
    const overview = render(Sidebar, { props: { workspaceId: 'ws-1' } });
    expect(overview.container.querySelector('[data-workspace-actions-kebab]')).toBeTruthy();
    cleanup();

    mocks.selectedTabs = ['agents'];
    const { container } = render(Sidebar, { props: { workspaceId: 'ws-1' } });
    const overlay = container.querySelector<HTMLElement>('[data-sidebar-overlay]');
    const footer = container.querySelector<HTMLElement>('[data-sidebar-expanded-footer]');
    const strip = container.querySelector<HTMLElement>('[data-sidebar-tab-strip]');
    const agent = container.querySelector<HTMLElement>('[data-expanded-agent="agent-1"]');

    expect(overlay).toBeTruthy();
    // The title region stays interactive while a card is expanded, including the kebab menu.
    expect(
      (container.querySelector('[data-workspace-title-region]') as HTMLElement & { inert: boolean })
        .inert,
    ).toBeFalsy();
    expect(container.querySelector('[data-workspace-actions-kebab]')).toBeTruthy();
    mocks.dispatch.mockClear();

    await fireEvent.click(agent!);
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sidebarNav/setMultiSelectSidebarSelectedTabs' }),
    );
    mocks.dispatch.mockClear();

    await fireEvent.click(strip!);
    expect(mocks.dispatch).not.toHaveBeenCalled();

    await fireEvent.click(
      strip!.querySelector<HTMLElement>('[data-sidebar-collapsed-tab="context"] button')!,
    );
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sidebarNav/setMultiSelectSidebarSelectedTabs',
        payload: ['ws-1', ['context']],
      }),
    );
    mocks.dispatch.mockClear();

    await fireEvent.click(
      strip!.querySelector<HTMLElement>('[data-sidebar-collapsed-tab="agents"] button')!,
    );
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sidebarNav/setMultiSelectSidebarSelectedTabs',
        payload: ['ws-1', ['overview']],
      }),
    );
    mocks.dispatch.mockClear();

    await fireEvent.click(footer!);
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sidebarNav/setMultiSelectSidebarSelectedTabs',
        payload: ['ws-1', ['overview']],
      }),
    );
    mocks.dispatch.mockClear();

    await fireEvent.click(overlay!);
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sidebarNav/setMultiSelectSidebarSelectedTabs',
        payload: ['ws-1', ['overview']],
      }),
    );
  });

  it.each([
    { zoom: 1, sidebarTop: 36, sidebarBottom: 511, boundaryBottom: 110, launcherTop: 486 },
    { zoom: 2, sidebarTop: -44, sidebarBottom: 906, boundaryBottom: 104, launcherTop: 856 },
  ])('keeps overlay bounds in local CSS pixels at $zoom× zoom', async (geometry) => {
    let resizeCallback: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    mocks.selectedTabs = ['agents'];
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const { container } = render(Sidebar, { props: { workspaceId: 'ws-1' } });
    const sidebar = container.firstElementChild as HTMLElement;
    const boundary = sidebar.querySelector<HTMLElement>('[data-workspace-title-region]')!;
    const launchers = sidebar.lastElementChild as HTMLElement;
    const overlay = sidebar.querySelector<HTMLElement>('[data-sidebar-overlay]')!;
    boundary.dataset.sidebarRepositoryBranchMetadata = '';
    Object.defineProperty(sidebar, 'clientHeight', { configurable: true, value: 475 });
    sidebar.getBoundingClientRect = () =>
      ({
        top: geometry.sidebarTop,
        bottom: geometry.sidebarBottom,
        height: geometry.sidebarBottom - geometry.sidebarTop,
      }) as DOMRect;
    boundary.getBoundingClientRect = () => ({ bottom: geometry.boundaryBottom }) as DOMRect;
    launchers.getBoundingClientRect = () => ({ top: geometry.launcherTop }) as DOMRect;

    resizeCallback?.([], {} as ResizeObserver);

    await waitFor(() => {
      expect(overlay.style.top).toBe('78px');
      expect(overlay.style.bottom).toBe('25px');
    });
  });

  it('dismisses the expanded card with Escape while preserving nested interaction isolation', async () => {
    mocks.selectedTabs = ['agents'];
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const { container } = render(Sidebar, { props: { workspaceId: 'ws-1' } });
    const card = container.querySelector<HTMLElement>('.sidebar-expanded-card');

    mocks.dispatch.mockClear();
    await fireEvent.click(card!);
    expect(mocks.dispatch).not.toHaveBeenCalled();

    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sidebarNav/setMultiSelectSidebarSelectedTabs',
        payload: ['ws-1', ['overview']],
      }),
    );
  });

  it('keeps the expanded card open while a dropdown menu is open; a second Escape dismisses it', async () => {
    mocks.selectedTabs = ['agents'];
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    // The real (unmocked) DropdownMenu — e.g. the workspace kebab — registers
    // an escape layer above the expanded panel's while open.
    const DropdownMenu = (
      await vi.importActual<typeof import('$lib/components/ui/dropdown-menu.svelte')>(
        '$lib/components/ui/dropdown-menu.svelte',
      )
    ).default;

    render(Sidebar, { props: { workspaceId: 'ws-1' } });
    const dropdown = render(DropdownMenu, { props: { open: true } });
    await tick();

    mocks.dispatch.mockClear();

    // First Escape: the dropdown layer is topmost and shields the panel.
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sidebarNav/setMultiSelectSidebarSelectedTabs' }),
    );

    await dropdown.rerender({ open: false });
    await tick();

    // Second Escape: the panel layer is topmost again and dismisses the card.
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sidebarNav/setMultiSelectSidebarSelectedTabs',
        payload: ['ws-1', ['overview']],
      }),
    );
  });

  it('switches expanded workspaces without animating or flashing the outgoing card', async () => {
    mocks.selectedTabsByWorkspace.set('ws-1', ['agents']);
    mocks.selectedTabsByWorkspace.set('ws-2', ['files']);
    mocks.agents = [makeAgent('old-workspace-agent')];
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const animations: Array<{ node: Element; duration: number }> = [];
    const originalAnimate = Element.prototype.animate;
    const animate = vi
      .spyOn(Element.prototype, 'animate')
      .mockImplementation(function (keyframes, options) {
        animations.push({
          node: this,
          duration: Number(typeof options === 'number' ? options : (options?.duration ?? 0)),
        });
        return originalAnimate.call(this, keyframes, options);
      });
    const view = render(Sidebar, { props: { workspaceId: 'ws-1' } });
    animations.length = 0;

    await view.rerender({ workspaceId: 'ws-2' });

    expect(view.container.querySelector('[data-sidebar-card-workspace="ws-1"]')).toBeNull();
    expect(view.container.querySelector('[data-expanded-agent="old-workspace-agent"]')).toBeNull();
    expect(
      view.container
        .querySelector('[data-sidebar-card-workspace="ws-2"]')
        ?.getAttribute('data-sidebar-card-tab'),
    ).toBe('files');
    expect(animations.filter(({ node }) => node.matches('.sidebar-expanded-card'))).toEqual([]);
    animate.mockRestore();
  });

  it('preserves same-workspace launcher, collapse, and section transitions', async () => {
    mocks.dispatch.mockImplementation((action) => {
      if (action?.type === 'sidebarNav/setMultiSelectSidebarSelectedTabs') {
        const [workspaceId, tabIds] = action.payload as [string, string[]];
        mocks.setSelectedTabs(workspaceId, tabIds);
      }
      return action;
    });
    mocks.selectedTabsByWorkspace.set('ws-1', ['overview']);
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const animations: Array<{ node: Element; duration: number }> = [];
    const originalAnimate = Element.prototype.animate;
    const animate = vi
      .spyOn(Element.prototype, 'animate')
      .mockImplementation(function (keyframes, options) {
        animations.push({
          node: this,
          duration: Number(typeof options === 'number' ? options : (options?.duration ?? 0)),
        });
        return originalAnimate.call(this, keyframes, options);
      });
    const rect = {
      x: 10,
      y: 10,
      top: 10,
      right: 110,
      bottom: 110,
      left: 10,
      width: 100,
      height: 100,
      toJSON: () => ({}),
    } as DOMRect;
    const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);
    const view = render(Sidebar, { props: { workspaceId: 'ws-1' } });
    animations.length = 0;

    await fireEvent.click(
      view.container.querySelector('[data-sidebar-launcher="changes"] button')!,
    );
    await waitFor(() =>
      expect(
        animations.some(
          ({ node, duration }) =>
            node.matches('[data-sidebar-card-tab="changes"]') && duration === 300,
        ),
      ).toBe(true),
    );

    animations.length = 0;
    await fireEvent.click(
      view.container.querySelector('[data-sidebar-collapsed-tab="files"] button')!,
    );
    await waitFor(() =>
      expect(
        animations.filter(
          ({ node, duration }) => node.matches('.sidebar-expanded-card') && duration === 180,
        ),
      ).toHaveLength(2),
    );

    animations.length = 0;
    await fireEvent.click(
      view.container.querySelector('[data-sidebar-collapsed-tab="files"] button')!,
    );
    await waitFor(() =>
      expect(
        animations.some(
          ({ node, duration }) =>
            node.matches('[data-sidebar-card-tab="files"]') && duration === 300,
        ),
      ).toBe(true),
    );
    geometry.mockRestore();
    animate.mockRestore();
  });

  it('restores the selected tab across an unmount/remount cycle via the Redux round-trip', async () => {
    // The selection lives in the sidebar-nav slice keyed by workspaceId, so an
    // unmounted column keeps it. Mirror dispatched selections back into the
    // mocked selector, exactly the reducer's setMultiSelectSidebarSelectedTabs
    // semantics, so the mount → select → unmount → remount cycle is observable.
    mocks.dispatch.mockImplementation((action) => {
      if (action?.type === 'sidebarNav/setMultiSelectSidebarSelectedTabs') {
        const [workspaceId, tabIds] = action.payload as [string, string[]];
        if (workspaceId === 'ws-1') mocks.selectedTabs = tabIds;
      }
      return action;
    });
    mocks.agents = [makeAgent('agent-1')];
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const first = render(Sidebar, { props: { workspaceId: 'ws-1' } });
    expect(first.container.querySelector('.sidebar-expanded-card')).toBeNull();

    await fireEvent.click(first.getByTestId('agent-panel-toggle'));
    expect(mocks.selectedTabs).toEqual(['agents']);

    first.unmount();
    const second = render(Sidebar, { props: { workspaceId: 'ws-1' } });

    expect(second.container.querySelector('.sidebar-expanded-card')).not.toBeNull();
    expect(second.container.querySelector('[data-expanded-agent="agent-1"]')).not.toBeNull();
  });
});
