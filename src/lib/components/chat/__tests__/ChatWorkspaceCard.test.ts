/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const goto = vi.fn(() => Promise.resolve());
  const openWorkspaceInNewWindow = vi.fn(() => Promise.resolve());
  const workspaces: Record<string, Workspace | undefined> = {};

  const readable = <T>(getter: () => T) => ({
    subscribe(run: (value: T) => void) {
      run(getter());
      return () => {};
    },
  });

  return {
    dispatch,
    goto,
    openWorkspaceInNewWindow,
    workspaces,
    readable,
  };
});

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/') } }));

vi.mock('$lib/store/utils/svelte-context', () => ({
  getDispatch: () => mocks.dispatch,
}));

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

vi.mock('$lib/components/ui/tooltip', async () => ({
  Tooltip: (await import('../../workspace/sidebar/__tests__/mocks/MockTooltip.svelte')).default,
}));
vi.mock('$lib/components/ui/tooltip/Tooltip.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockTooltip.svelte')).default,
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));
vi.mock('$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: {
    select: (_state: any, wsId: string) => mocks.workspaces[wsId],
    withStore: (_store: any) => (wsId: string) => mocks.readable(() => mocks.workspaces[wsId]),
  },
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
    withStore: () => (workspaceId: string) => mocks.readable(() => mocks.workspaces[workspaceId]),
  },
  selectWorkspaceActivePullRequest: { select: vi.fn(() => null) },
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentIsResponding: { select: vi.fn(() => false) },
  selectAgentIsWaiting: { select: vi.fn(() => false) },
  selectAgentSession: { select: vi.fn(() => null) },
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
  render(ChatWorkspaceCard, { props: { workspaceIds } });
}

async function openMenu() {
  const button = screen.getByRole('button', { name: /workspace actions for archive cleanup/i });
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

describe('ChatWorkspaceCard overflow menu', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.goto.mockClear();
    mocks.openWorkspaceInNewWindow.mockClear();
    mocks.workspaces['ws-1'] = workspace('ws-1', 'Archive Cleanup');
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  it('opens and closes the hover overflow menu without triggering card navigation', async () => {
    await renderWorkspaceCard();
    await waitFor(() => expect(screen.getByText('Archive Cleanup')).toBeTruthy());

    const button = screen.getByRole('button', { name: /workspace actions for archive cleanup/i });
    const actions = button.closest('.wc-actions');
    expect(actions?.className).toContain('opacity-0');
    expect(actions?.className).toContain('group-hover:opacity-100');

    const menu = await openMenu();

    expect(mocks.goto).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'Open' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Open in New Window' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete Space…' })).toBeTruthy();

    await fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.body.contains(menu)).toBe(false));
  });

  it('runs open actions from the menu', async () => {
    await renderWorkspaceCard();
    await waitFor(() => expect(screen.getByText('Archive Cleanup')).toBeTruthy());

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));
    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/workspace/ws-1'));

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Open in New Window' }));
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: 'workspaceOperations/requestOpenWorkspace',
        payload: [{ workspaceId: 'ws-1', openInNewWindow: true }],
      }),
    );
  });

  it('dispatches existing archive and delete Redux actions from the menu', async () => {
    await renderWorkspaceCard();
    await waitFor(() => expect(screen.getByText('Archive Cleanup')).toBeTruthy());

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'workspaceOperations/requestArchiveWorkspace',
      payload: ['ws-1'],
    });

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Space…' }));
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'workspaceOperations/requestDeleteWorkspace',
      payload: ['ws-1'],
    });
  });

  it('does not render overflow actions for missing workspace placeholders', async () => {
    mocks.workspaces['missing-workspace'] = undefined;
    await renderWorkspaceCard(['missing-workspace']);

    expect(await screen.findByText('Workspace not found')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /workspace actions/i })).toBeNull();
  });
});
