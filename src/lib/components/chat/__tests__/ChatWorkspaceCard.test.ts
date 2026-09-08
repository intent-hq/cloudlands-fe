/**
 * @vitest-environment jsdom
 */
import { m } from '$shared/paraglide/messages.js';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import { warmImport } from '../../../../test/warm-import';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const goto = vi.fn(() => Promise.resolve());
  const openWorkspaceInNewWindow = vi.fn(() => Promise.resolve());
  const workspaces: Record<string, Workspace | undefined> = {};
  const activeAgentIds: Record<string, string | null> = {};
  const foregroundAgentIds: Record<string, string[]> = {};
  const workspaceSubscribers = new Map<string, Set<(workspace: Workspace | undefined) => void>>();

  const readable = <T>(getter: () => T) => ({
    subscribe(run: (value: T) => void) {
      run(getter());
      return () => {};
    },
  });

  const workspaceReadable = (workspaceId: string) => ({
    subscribe(run: (workspace: Workspace | undefined) => void) {
      run(workspaces[workspaceId]);
      const subscribers = workspaceSubscribers.get(workspaceId) ?? new Set();
      subscribers.add(run);
      workspaceSubscribers.set(workspaceId, subscribers);
      return () => subscribers.delete(run);
    },
  });

  const setWorkspace = (workspaceId: string, value: Workspace | undefined) => {
    workspaces[workspaceId] = value;
    workspaceSubscribers.get(workspaceId)?.forEach((run) => run(value));
  };

  return {
    dispatch,
    goto,
    openWorkspaceInNewWindow,
    workspaces,
    activeAgentIds,
    foregroundAgentIds,
    readable,
    workspaceReadable,
    setWorkspace,
  };
});

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/') } }));

vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: mocks.dispatch,
    state: { uiHighlight: { activeById: {}, durationMsById: {} } },
  },
}));

vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: () => ({
    dispatch: mocks.dispatch,
    getState: () => ({ uiHighlight: { activeById: {}, durationMsById: {} } }),
    subscribe: () => () => {},
  }),
}));

vi.mock('$lib/components/layout/sidebar-nav/utils/openWorkspaceInNewWindow', () => ({
  openWorkspaceInNewWindow: mocks.openWorkspaceInNewWindow,
}));

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectActiveAgentId: {
    select: (_state: unknown, workspaceId: string) => mocks.activeAgentIds[workspaceId] ?? null,
  },
  selectWorkspaceForegroundAgentIds: {
    select: (_state: unknown, workspaceId: string) => mocks.foregroundAgentIds[workspaceId] ?? [],
  },
}));

vi.mock('$lib/components/ui/tooltip', async () => ({
  Tooltip: (await import('../../workspace/sidebar/__tests__/mocks/MockTooltip.svelte')).default,
}));
vi.mock('$lib/components/ui/tooltip/Tooltip.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockTooltip.svelte')).default,
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));
vi.mock('$features/agent/components/agent-avatar/AgentAvatarWithState.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: {
    select: (_state: any, wsId: string) => mocks.workspaces[wsId],
    withStore: (_store: any) => (wsId: string) => mocks.readable(() => mocks.workspaces[wsId]),
  },
}));
vi.mock('$store/renderer/slices/pr-monitor/pr-monitor-selectors', () => ({
  selectActivePrMonitors: Object.assign(() => mocks.readable(() => []), {
    select: () => [],
  }),
  selectPrMonitors: Object.assign(() => mocks.readable(() => []), {
    select: () => [],
  }),
}));
vi.mock('$lib/components/workspace/WorkspacePhaseIndicator.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('$lib/components/workspace/WorkspaceHoverCard.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('$lib/components/ui/RelativeTime.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('$lib/components/ui/highlight/highlight-target', () => ({
  highlightTarget: () => ({ destroy: vi.fn() }),
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: {
    select: (_state: unknown, workspaceId: string) => mocks.workspaces[workspaceId],
    withStore: () => (workspaceId: string) => mocks.workspaceReadable(workspaceId),
  },
  selectWorkspaceActivePullRequest: { select: vi.fn(() => null) },
}));

vi.mock('$store/renderer/slices/hardware-console/hardware-console-selectors', () => ({
  selectHardwareConsoleKeyPins: { select: vi.fn(() => [null, null, null, null, null, null]) },
  selectHardwareConsoleKeySlots: { select: vi.fn(() => [null, null, null, null, null, null]) },
  selectWorkspacePinnedKeySlot: { select: vi.fn(() => null) },
  selectWorkspaceResolvedKeySlot: Object.assign(() => mocks.readable(() => null), {
    select: vi.fn(() => null),
  }),
}));

vi.mock('$features/hardware-console/device/connection-status', () => ({
  microConnectedReadable: () => mocks.readable(() => false),
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentIsResponding: { select: vi.fn(() => false) },
  selectAgentIsWaiting: { select: vi.fn(() => false) },
  selectAgentSession: { select: vi.fn(() => null) },
}));

vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', () => ({
  selectWorkspaceTaskProgress: Object.assign(
    () => mocks.readable(() => ({ total: 0, completed: 0, inProgress: 0 })),
    { select: vi.fn(() => ({ total: 0, completed: 0, inProgress: 0 })) },
  ),
}));

const workspace = (id: string, title: string): Workspace => ({
  id,
  title,
  branch: 'main',
  changesets: [],
  timeline: [],
  conversationInfo: [],
  status: WorkspaceStatusEnum.Active,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
  lastActivity: '2026-05-15T00:00:00.000Z',
  repositoryOwner: 'augment',
  repositoryName: 'intent',
});

async function renderWorkspaceCard(workspaceIds = ['ws-1']) {
  const ChatWorkspaceCard = (await import('../ChatWorkspaceCard.svelte')).default;
  return render(ChatWorkspaceCard, { props: { workspaceIds } });
}

async function openMenu() {
  const button = screen.getByRole('button', { name: /workspace actions for archive cleanup/i });
  button.focus();
  button.getBoundingClientRect = vi.fn(() => ({
    x: 120,
    y: 20,
    width: 20,
    height: 20,
    top: 20,
    right: 140,
    bottom: 40,
    left: 120,
    toJSON: () => {},
  }));
  await fireEvent.click(button);
  return screen.findByRole('menu');
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/MockTooltip.svelte'));
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte'));
warmImport(() => import('../ChatWorkspaceCard.svelte'));

describe('ChatWorkspaceCard overflow menu', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.goto.mockClear();
    mocks.openWorkspaceInNewWindow.mockClear();
    mocks.workspaces['ws-1'] = workspace('ws-1', 'Archive Cleanup');
    mocks.activeAgentIds['ws-1'] = 'agent-primary';
    mocks.foregroundAgentIds['ws-1'] = ['agent-primary', 'agent-secondary'];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  it('opens and closes the focused overflow menu without triggering card navigation', async () => {
    await renderWorkspaceCard();
    await waitFor(() => expect(screen.getByText('Archive Cleanup')).toBeTruthy());

    const button = screen.getByRole('button', { name: /workspace actions for archive cleanup/i });
    expect(button.getAttribute('aria-expanded')).toBe('false');

    const menu = await openMenu();

    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.contains(menu)).toBe(true);
    expect(mocks.goto).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'Open' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Open in New Window' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeTruthy();
    expect(
      screen.getByRole('menuitem', { name: m.chat_chatWorkspaceCard_menu_deleteSpace_label() }),
    ).toBeTruthy();

    await fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.body.contains(menu)).toBe(false));
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it.each(['Enter', ' '])('opens from the keyboard with %s and does not navigate', async (key) => {
    await renderWorkspaceCard();
    const button = await screen.findByRole('button', {
      name: /workspace actions for archive cleanup/i,
    });

    button.focus();
    await fireEvent.keyDown(button, { key });

    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it('dismisses outside and keeps only one card menu open', async () => {
    mocks.workspaces['ws-2'] = workspace('ws-2', 'Second Workspace');
    await renderWorkspaceCard(['ws-1', 'ws-2']);
    const first = await screen.findByRole('button', {
      name: /workspace actions for archive cleanup/i,
    });
    const second = screen.getByRole('button', { name: /workspace actions for second workspace/i });

    await fireEvent.click(first);
    expect(await screen.findByRole('menu')).toBeTruthy();
    await fireEvent.keyDown(second, { key: 'Enter' });

    await waitFor(() => expect(first.getAttribute('aria-expanded')).toBe('false'));
    expect(second.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('menu')).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await fireEvent.pointerDown(document.body, {
      button: 0,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('runs open actions from the menu', async () => {
    await renderWorkspaceCard();
    await waitFor(() => expect(screen.getByText('Archive Cleanup')).toBeTruthy());

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));
    await waitFor(() => expect(mocks.goto).toHaveBeenCalledTimes(1));
    expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-1');
    expect(
      mocks.dispatch.mock.calls.filter(
        ([action]) => action.type === 'appLayout/openAgentTabRequested',
      ),
    ).toHaveLength(1);

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Open in New Window' }));
    await waitFor(() => expect(mocks.openWorkspaceInNewWindow).toHaveBeenCalledWith('ws-1'));
  });

  it('opens the workspace and its active top-level agent from the card', async () => {
    await renderWorkspaceCard();

    await fireEvent.click(await screen.findByRole('button', { name: 'Archive Cleanup' }));

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: 'appLayout/openAgentTabRequested',
        payload: ['ws-1', { agentId: 'agent-primary' }],
      }),
    );
    expect(mocks.goto).toHaveBeenCalledOnce();
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'tabState/openWorkspaceTab',
      payload: ['ws-1'],
    });
    const workspaceTabCallIndex = mocks.dispatch.mock.calls.findIndex(
      ([action]) => action.type === 'tabState/openWorkspaceTab',
    );
    expect(mocks.goto.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.dispatch.mock.invocationCallOrder[workspaceTabCallIndex],
    );
  });

  it('leaves tab state unchanged and stops agent actions when workspace navigation fails', async () => {
    const navigationError = new Error('navigation failed');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.goto.mockRejectedValueOnce(navigationError);
    await renderWorkspaceCard();
    mocks.dispatch.mockClear();

    await fireEvent.click(await screen.findByRole('button', { name: 'Archive Cleanup' }));

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('Failed to navigate to workspace:', navigationError),
    );
    expect(mocks.dispatch).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('uses the first top-level agent when the active agent is not top-level', async () => {
    mocks.activeAgentIds['ws-1'] = 'agent-background';
    await renderWorkspaceCard();

    await fireEvent.click(await screen.findByRole('button', { name: 'Archive Cleanup' }));

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: 'appLayout/openAgentTabRequested',
        payload: ['ws-1', { agentId: 'agent-primary' }],
      }),
    );
  });

  it('falls back to the workspace route when no top-level agent is loaded', async () => {
    mocks.activeAgentIds['ws-1'] = null;
    mocks.foregroundAgentIds['ws-1'] = [];
    await renderWorkspaceCard();

    await fireEvent.click(await screen.findByRole('button', { name: 'Archive Cleanup' }));

    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-1'));
    expect(
      mocks.dispatch.mock.calls.some(
        ([action]) => action.type === 'appLayout/openAgentTabRequested',
      ),
    ).toBe(false);
  });

  it.each([
    ['Command', { metaKey: true }],
    ['Control', { ctrlKey: true }],
  ])('opens a new window without changing the current window for %s-click', async (_, modifier) => {
    await renderWorkspaceCard();
    mocks.dispatch.mockClear();

    await fireEvent.click(await screen.findByRole('button', { name: 'Archive Cleanup' }), modifier);

    expect(mocks.openWorkspaceInNewWindow).toHaveBeenCalledWith('ws-1');
    expect(mocks.goto).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('opens the active top-level agent from Enter activation', async () => {
    const { container } = await renderWorkspaceCard();
    const row = container.querySelector('[data-workspace-card-row]');
    expect(row).toBeTruthy();

    await fireEvent.keyDown(row!, { key: 'Enter' });

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: 'appLayout/openAgentTabRequested',
        payload: ['ws-1', { agentId: 'agent-primary' }],
      }),
    );
    expect(mocks.goto).toHaveBeenCalledOnce();
  });

  it('dispatches existing archive and delete Redux actions from the menu', async () => {
    await renderWorkspaceCard();
    await waitFor(() => expect(screen.getByText('Archive Cleanup')).toBeTruthy());

    await openMenu();
    mocks.dispatch.mockClear();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(
      mocks.dispatch.mock.calls.filter(
        ([action]) => action.type === 'workspaceOperations/requestArchiveWorkspace',
      ),
    ).toHaveLength(1);
    expect(mocks.dispatch).toHaveBeenLastCalledWith({
      type: 'workspaceOperations/requestArchiveWorkspace',
      payload: ['ws-1'],
    });

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await openMenu();
    mocks.dispatch.mockClear();
    await fireEvent.click(
      screen.getByRole('menuitem', { name: m.chat_chatWorkspaceCard_menu_deleteSpace_label() }),
    );
    expect(
      mocks.dispatch.mock.calls.filter(
        ([action]) => action.type === 'workspaceOperations/requestDeleteWorkspace',
      ),
    ).toHaveLength(1);
    expect(mocks.dispatch).toHaveBeenLastCalledWith({
      type: 'workspaceOperations/requestDeleteWorkspace',
      payload: ['ws-1'],
    });
  });

  it('does not render overflow actions for missing workspace placeholders', async () => {
    mocks.workspaces['missing-workspace'] = undefined;
    await renderWorkspaceCard(['missing-workspace']);

    expect(await screen.findByText('Workspace not found')).toBeTruthy();
    expect(screen.queryByText('missing-workspace')).toBeNull();
    expect(screen.queryByRole('button', { name: /workspace actions/i })).toBeNull();
  });

  it('resolves a late Chief workspace entity to its live title without exposing its ID', async () => {
    mocks.workspaces['chief-relay-demo'] = undefined;
    await renderWorkspaceCard(['chief-relay-demo']);

    expect(await screen.findByText('Workspace not found')).toBeTruthy();
    expect(screen.queryByText('chief-relay-demo')).toBeNull();

    mocks.setWorkspace('chief-relay-demo', workspace('chief-relay-demo', 'Chief Relay Demo'));

    expect(await screen.findByText('Chief Relay Demo')).toBeTruthy();
    expect(screen.queryByText('Workspace not found')).toBeNull();
  });

  it('renders an available Chief workspace title without exposing its ID', async () => {
    mocks.workspaces['chief-relay-demo'] = workspace('chief-relay-demo', 'Chief Relay Demo');
    await renderWorkspaceCard(['chief-relay-demo']);

    expect(await screen.findByText('Chief Relay Demo')).toBeTruthy();
    expect(screen.queryByText('chief-relay-demo')).toBeNull();
  });

  it('uses a localized accessible fallback instead of the ID for an untitled workspace', async () => {
    mocks.workspaces['untitled-workspace'] = workspace('untitled-workspace', '');
    await renderWorkspaceCard(['untitled-workspace']);

    expect(
      await screen.findByRole('button', { name: 'Workspace actions for Untitled' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /untitled-workspace/i })).toBeNull();
  });
});
