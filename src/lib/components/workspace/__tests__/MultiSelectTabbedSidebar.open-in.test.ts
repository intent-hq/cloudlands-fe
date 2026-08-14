/**
 * @vitest-environment jsdom
 */
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
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
    selector,
    selectorFrom,
    // eslint-disable-next-line themis/collection-state-shape -- test-only dynamic selector fixture
    agents: [] as AgentSession[],
    agentsLoading: false,
    notes: [] as Array<{ id: string; title: string; content: string }>,
    changes: [] as Array<{ id: string; file: string; relativePath: string }>,
    selectedTabs: ['overview'] as string[],
    runningAgentIds: new Set<string>(),
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

vi.mock('$lib/utils/platform-capabilities', () => ({ hasCapability: () => true }));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/components/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectCurrentWorkspaceId: mocks.selector('ws-1'),
  selectStagedWorkingChanges: mocks.selectorFrom(() => mocks.changes),
  selectUnstagedWorkingChanges: mocks.selector([]),
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectActiveTab: mocks.selector(null),
  selectAllTabs: mocks.selector([]),
  selectFocusedPanelId: mocks.selector(null),
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
  selectWorkspaceById: mocks.selector({
    id: 'ws-1',
    title: 'Project',
    path: '/tmp/project',
    worktreePath: '/tmp/project',
    skipWorktree: false,
  }),
  selectWorkspaceActivePullRequest: mocks.selector(null),
  selectIsWorkspaceHostLocal: mocks.selector(true),
}));
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: mocks.selectorFrom(() => mocks.notes),
  selectNotesLoading: mocks.selector(false),
}));
vi.mock('$store/renderer/slices/sidebar-nav/sidebar-nav-selectors', () => ({
  selectMultiSelectSidebarSelectedTabIds: mocks.selectorFrom(() => mocks.selectedTabs),
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
vi.mock('$features/agent/components/auggie-avatar/AugieAvatarWithState.svelte', async () => ({
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
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
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
    isSpecNote: () => false,
  };
});

warmImport(() => import('../../ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../../ui/__tests__/mocks/button.svelte'));
warmImport(() => import('../../ui/__tests__/mocks/dropdown-menu.svelte'));
warmImport(() => import('./mocks/FilesPanel.svelte'));
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
    mocks.runningAgentIds.clear();
  });

  afterEach(() => {
    cleanup();
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

  it.each([
    { total: 0, visible: 0, overflow: 0 },
    { total: 1, visible: 1, overflow: 0 },
    { total: 6, visible: 6, overflow: 0 },
    { total: 8, visible: 6, overflow: 2 },
  ])(
    'renders $total agents as six plus semantic overflow',
    async ({ total, visible, overflow }) => {
      mocks.agents = Array.from({ length: total }, (_, index) => makeAgent(`agent-${index}`));
      const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
      const { container, queryByRole } = render(Sidebar, { props: { workspaceId: 'ws-1' } });

      expect(container.querySelectorAll('[data-sidebar-agent]')).toHaveLength(visible);
      expect(
        container.querySelector('[data-sidebar-launcher="agents"] [aria-labelledby]'),
      ).toBeTruthy();
      if (overflow > 0) {
        expect(
          queryByRole('button', {
            name: new RegExp(`${overflow} more agents.*${total} agents total`),
          }),
        ).toBeTruthy();
      } else {
        expect(container.querySelector('[data-sidebar-agent-overflow]')).toBeNull();
      }
    },
  );

  it('keeps the compact Agents launcher stable while sessions are loading', async () => {
    mocks.agentsLoading = true;
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const { container, getByRole } = render(Sidebar, { props: { workspaceId: 'ws-1' } });

    expect(getByRole('button', { name: /Agents.*0 agents total/ })).toBeTruthy();
    expect(container.querySelectorAll('[data-sidebar-agent]')).toHaveLength(0);
    expect(container.querySelector('[data-sidebar-agent-overflow]')).toBeNull();
  });

  it.each([1, 4, 6])(
    'keeps cross-card visible edges and shared geometry aligned at %i-item density',
    async (count) => {
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
      const geometry = (tabId: string) => {
        const card = container.querySelector<HTMLElement>(`[data-sidebar-launcher="${tabId}"]`)!;
        const stack = card.querySelector<HTMLElement>('[data-sidebar-launcher-icons]')!;
        const label = card.querySelector<HTMLElement>(`[id^="sidebar-launcher-label-${tabId}-"]`)!;
        const targets = [...stack.querySelectorAll<HTMLElement>('[data-launcher-preview-item]')];
        const glyphs = [...stack.querySelectorAll<HTMLElement>('[data-sidebar-launcher-glyph]')];
        expect(card.dataset.launcherTopInset).toBe('8');
        expect(card.classList.contains('pt-2')).toBe(true);
        expect(card.classList.contains('pb-3')).toBe(true);
        const isAgentStack = tabId === 'agents';
        expect(stack.dataset.launcherLayout).toBe('horizontal');
        expect(stack.dataset.launcherOverlap).toBe('6');
        expect(stack.dataset.launcherOverlapStep).toBe(isAgentStack ? '16' : '12');
        expect(stack.dataset.launcherPrimaryGap).toBe('4');
        expect(stack.dataset.launcherPrimaryStep).toBe(isAgentStack ? '26' : '22');
        expect(stack.dataset.launcherTargetSize).toBe('28');
        expect(stack.dataset.launcherVisibleSize).toBe(isAgentStack ? '22' : '18');
        expect(stack.dataset.launcherVisibleOffset).toBe(isAgentStack ? '3' : '5');
        expect(
          stack.classList.contains(isAgentStack ? '-ml-2.5' : 'launcher-icon-stack-offset'),
        ).toBe(true);
        expect(stack.classList.contains('h-7')).toBe(true);
        expect(stack.classList.contains('flex-nowrap')).toBe(true);
        expect(stack.classList.contains('overflow-hidden')).toBe(true);
        expect(targets.every((target) => target.classList.contains('size-7'))).toBe(true);
        expect(targets.every((target) => target.classList.contains('shrink-0'))).toBe(true);
        expect(targets.every((target) => target.classList.contains('hover:z-20'))).toBe(true);
        expect(targets.every((target) => target.classList.contains('focus-visible:z-30'))).toBe(
          true,
        );
        expect(
          glyphs.every((glyph) => glyph.classList.contains(isAgentStack ? 'size-5.5' : 'size-4.5')),
        ).toBe(true);
        if (tabId === 'agents') {
          expect(stack.classList.contains('-ml-3.5')).toBe(false);
          expect(
            glyphs.every(
              (glyph) =>
                glyph.dataset.launcherAvatarSeam === 'surface-1px' &&
                glyph.dataset.launcherAvatarSize === '22' &&
                getComputedStyle(glyph).width === '22px' &&
                getComputedStyle(glyph).height === '22px' &&
                glyph.style.boxShadow === 'inset 0 0 0 1px var(--color-card)',
            ),
          ).toBe(true);
          expect(
            glyphs.every((glyph) => !/ring-(?:[1-9])|border-(?:[2-9])/.test(glyph.className)),
          ).toBe(true);
        }
        expect(Number(stack.dataset.launcherVisibleOffset)).toBe(
          Number(stack.dataset.launcherTargetSize) / 2 -
            Number(stack.dataset.launcherVisibleSize) / 2,
        );
        expect(
          Number(stack.dataset.launcherPrimaryStep) - Number(stack.dataset.launcherVisibleSize),
        ).toBe(Number(stack.dataset.launcherPrimaryGap));
        expect(
          Number(stack.dataset.launcherVisibleSize) - Number(stack.dataset.launcherOverlapStep),
        ).toBe(Number(stack.dataset.launcherOverlap));
        if (tabId !== 'changes') {
          expect(targets[0]?.dataset.launcherLeadingItem).toBe('true');
          if (targets.length > 1) {
            expect(targets[1].classList.contains(isAgentStack ? '-ml-0.5' : '-ml-1.5')).toBe(true);
          }
        }
        if (targets.length > 2) {
          expect(targets[2].classList.contains(isAgentStack ? '-ml-3' : '-ml-4')).toBe(true);
        }
        expect(label).toBeTruthy();
        return {
          topInset: card.dataset.launcherTopInset,
          overlap: stack.dataset.launcherOverlap,
          primaryGap: stack.dataset.launcherPrimaryGap,
          target: stack.dataset.launcherTargetSize,
        };
      };

      expect(geometry('agents')).toEqual(geometry('context'));
      expect(geometry('agents')).toEqual(geometry('changes'));
    },
  );

  it('uses one contained horizontal row with plain overflow text at narrow zoomed sizes', async () => {
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

    for (const tabId of ['agents', 'context', 'changes']) {
      const card = container.querySelector<HTMLElement>(`[data-sidebar-launcher="${tabId}"]`)!;
      const stack = card.querySelector<HTMLElement>('[data-sidebar-launcher-icons]')!;
      const itemCount = stack.querySelectorAll('[data-launcher-preview-item]').length;
      expect(stack.classList.contains('flex')).toBe(true);
      expect(stack.classList.contains('flex-nowrap')).toBe(true);
      expect(stack.className).not.toContain('grid-cols-');
      expect(itemCount).toBe(7);
      expect(card.classList.contains('overflow-hidden')).toBe(true);
    }
    const agentOverflow = getByRole('button', { name: /2 more agents.*8 agents total/ });
    const noteOverflow = getByRole('button', { name: /2 more notes/ });
    const changeOverflow = getByRole('button', { name: /2 more changes/ });
    const agentGlyphs = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-sidebar-launcher="agents"] [data-launcher-avatar-size="22"]',
      ),
    ];
    const expectPlainOverflowStyle = (overflow: HTMLElement) => {
      expect(overflow.className).toContain('launcher-overflow-button');
      expect(overflow.className).toContain('text-xs');
      expect(overflow.className).toContain('font-medium');
      expect(overflow.className).toContain('leading-3');
      expect(overflow.className).toContain('text-muted-foreground');
      expect(overflow.className).toContain('whitespace-nowrap');
      expect(overflow.className).toContain('bg-transparent!');
      expect(overflow.className).toContain('border-0!');
      expect(overflow.className).toContain('shadow-none!');
      expect(overflow.className).toContain('rounded-none!');
      expect(overflow.className).not.toMatch(
        /bg-background|font-semibold|rounded-(?:sm|md|lg|full)/,
      );
      const style = getComputedStyle(overflow);
      expect(overflow.style.fontSize).toBe('');
      expect(style.lineHeight).toBe('12px');
      expect(style.fontWeight).toBe('500');
      expect(['transparent', 'rgba(0, 0, 0, 0)']).toContain(style.backgroundColor);
      expect(style.borderTopWidth).toBe('0px');
      expect(style.borderRadius).toBe('0px');
      expect(style.paddingTop).toBe('0px');
      expect(style.boxShadow).toBe('none');
    };

    for (const overflow of [agentOverflow, noteOverflow, changeOverflow]) {
      expectPlainOverflowStyle(overflow);
    }

    for (const theme of ['light', 'dark'] as const) {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      document.documentElement.dataset.theme = theme;
      for (const zoom of [1, 2]) {
        container.style.zoom = String(zoom);
        expectPlainOverflowStyle(agentOverflow);
        expectPlainOverflowStyle(changeOverflow);
        for (const glyph of agentGlyphs) {
          const style = getComputedStyle(glyph);
          expect(style.width).toBe('22px');
          expect(style.height).toBe('22px');
          expect(glyph.parentElement?.classList.contains('size-7')).toBe(true);
        }
      }
    }
    container.style.removeProperty('zoom');
    document.documentElement.classList.remove('dark');
    delete document.documentElement.dataset.theme;
  });

  it('uses contained outline-free keyboard focus states for every preview target', async () => {
    mocks.agents = [makeAgent('agent')];
    mocks.notes = [{ id: 'spec', title: 'Spec', content: '' }];
    mocks.changes = [{ id: 'change', file: '/tmp/file.ts', relativePath: 'file.ts' }];
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const { container } = render(Sidebar, { props: { workspaceId: 'ws-1' } });

    for (const target of container.querySelectorAll<HTMLElement>('[data-launcher-preview-item]')) {
      const glyph = target.querySelector<HTMLElement>('[data-sidebar-launcher-glyph]');
      if (glyph) {
        expect(glyph.className).toContain('group-focus-visible/preview:bg-background/80');
        expect(glyph.className).toContain('launcher-glyph');
        expect(target.className).not.toContain('focus-visible:bg-background/80');
      } else {
        expect(target.className).toContain('focus-visible:bg-transparent!');
        expect(target.className).toContain('focus-visible:underline');
      }
      expect(target.className).not.toMatch(/(?:^|\s)focus-visible:ring-/);
      expect(target.className).not.toMatch(/(?:^|\s)focus-visible:outline-(?!none)/);
      expect(target.className).not.toContain('focus-visible:shadow-');
    }
  });

  it('keeps plain +N text immediately after the contained icon stack', async () => {
    mocks.agents = Array.from({ length: 8 }, (_, index) => makeAgent(`agent-${index}`));
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const { container, getByRole } = render(Sidebar, { props: { workspaceId: 'ws-1' } });
    const card = container.querySelector<HTMLElement>('[data-sidebar-launcher="agents"]')!;
    const stack = card.querySelector<HTMLElement>('[data-sidebar-launcher-icons]')!;
    const overflow = getByRole('button', { name: /2 more agents.*8 agents total/ });
    const stackRect = stack.getBoundingClientRect();
    const overflowRect = overflow.getBoundingClientRect();

    expect(stack.classList.contains('-ml-2.5')).toBe(true);
    expect(stack.dataset.launcherVisibleSize).toBe('22');
    expect(stack.dataset.launcherVisibleOffset).toBe('3');
    for (const tabId of ['context', 'changes']) {
      const siblingStack = container.querySelector<HTMLElement>(
        `[data-sidebar-launcher="${tabId}"] [data-sidebar-launcher-icons]`,
      )!;
      expect(siblingStack.classList.contains('launcher-icon-stack-offset')).toBe(true);
      expect(siblingStack.dataset.launcherVisibleSize).toBe('18');
      expect(siblingStack.dataset.launcherVisibleOffset).toBe('5');
    }
    expect(overflow.parentElement).toBe(stack);
    expect(overflowRect.left).toBeGreaterThanOrEqual(stackRect.left);
    expect(overflowRect.top).toBeGreaterThanOrEqual(stackRect.top);
    expect(overflow.textContent).toContain('+2');
    expect(overflow.className).toContain('w-auto');
    expect(overflow.className).toContain('justify-start');
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
      const target = view.container.querySelector<HTMLElement>('[data-sidebar-agent]')!;
      return {
        ...view,
        target,
        assertCapability: () => {
          expect(target.getAttribute('data-sidebar-agent')).toBe('coordinator');
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
      }),
    );
    mocks.runningAgentIds.add('agent-1');
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const overview = render(Sidebar, { props: { workspaceId: 'ws-1' } });

    expect(
      [...overview.container.querySelectorAll('[data-sidebar-agent]')].map((item) =>
        item.getAttribute('data-sidebar-agent'),
      ),
    ).toEqual(['agent-1', 'agent-2', 'agent-7', 'agent-6', 'agent-5', 'agent-4']);
    const overflow = overview.getByRole('button', { name: /2 more agents.*8 agents total/ });
    overflow.focus();
    await fireEvent.pointerDown(overflow);
    await fireEvent.keyDown(overflow, { key: 'Enter' });
    await fireEvent.keyDown(overflow, { key: ' ' });
    expect(document.activeElement).toBe(overflow);
    await fireEvent.click(overflow);
    expect(mocks.dispatch).toHaveBeenCalled();

    cleanup();
    mocks.selectedTabs = ['agents'];
    const expanded = render(Sidebar, { props: { workspaceId: 'ws-1' } });
    expect(expanded.container.querySelectorAll('[data-expanded-agent]')).toHaveLength(8);
  });

  it('opens each compact agent, note, and change exactly once', async () => {
    mocks.agents = [makeAgent('primary', { isInitialAgent: true })];
    mocks.notes = [{ id: 'spec', title: 'Spec', content: '' }];
    mocks.changes = [{ id: 'change', file: '/tmp/file.ts', relativePath: 'file.ts' }];
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;
    const { container } = render(Sidebar, { props: { workspaceId: 'ws-1' } });

    mocks.dispatch.mockClear();
    await fireEvent.click(container.querySelector('[data-sidebar-agent="primary"]')!);
    expect(
      mocks.dispatch.mock.calls.filter(
        ([action]) => action.type === 'appLayout/openAgentTabRequested',
      ),
    ).toHaveLength(1);

    mocks.openUserTab.mockClear();
    await fireEvent.click(container.querySelector('[data-sidebar-context="spec"]')!);
    expect(mocks.openUserTab).toHaveBeenCalledTimes(1);
    expect(mocks.openUserTab).toHaveBeenCalledWith(expect.objectContaining({ noteId: 'spec' }));

    mocks.dispatch.mockClear();
    await fireEvent.click(container.querySelector('[data-sidebar-change="file.ts"]')!);
    expect(
      mocks.dispatch.mock.calls.filter(
        ([action]) => action.type === 'workspaceNavigation/openWorkspaceDiff',
      ),
    ).toHaveLength(1);
  });

  it('renders the expanded card as an overlay that dismisses only from its backdrop', async () => {
    mocks.agents = [makeAgent('agent-1')];
    const Sidebar = (await import('../MultiSelectTabbedSidebar.svelte')).default;

    // Overview state: the workspace actions kebab is available.
    const overview = render(Sidebar, { props: { workspaceId: 'ws-1' } });
    expect(overview.container.querySelector('[data-workspace-actions-kebab]')).toBeTruthy();
    cleanup();

    mocks.selectedTabs = ['agents'];
    const { container } = render(Sidebar, { props: { workspaceId: 'ws-1' } });
    const overlay = container.querySelector<HTMLElement>('[data-sidebar-overlay]');
    const agent = container.querySelector<HTMLElement>('[data-expanded-agent="agent-1"]');

    expect(overlay).toBeTruthy();
    // The title region stays interactive while a card is expanded; only the kebab menu hides.
    expect(
      (container.querySelector('[data-workspace-title-region]') as HTMLElement & { inert: boolean })
        .inert,
    ).toBeFalsy();
    expect(container.querySelector('[data-workspace-actions-kebab]')).toBeNull();
    mocks.dispatch.mockClear();

    await fireEvent.click(agent!);
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sidebarNav/setMultiSelectSidebarSelectedTabs' }),
    );

    await fireEvent.click(overlay!);
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
});
