/**
 * Test: Unread-row activation in ActiveWorkspacesCard.
 *
 * Clicking (or pressing Enter on) an Unread row must navigate AND land on the
 * workspace's unread agent; rows in the other sections keep plain navigation.
 * `focusFirstUnreadAgent` and `goto` are the seams under assertion.
 *
 * The row also passes the workspace's pre-navigation `attention === 'unread'`
 * state, since viewing the workspace clears the flag (§5.1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
  resetWorkspaceState,
} from '$store/renderer/slices/workspace/workspace-slice';
import { WorkspaceStatus, type Workspace, type WorkspaceId } from '$shared/types';
import ActiveWorkspacesCardHarness from './mocks/ActiveWorkspacesCardHarness.svelte';

const { gotoMock, focusFirstUnreadAgentMock } = vi.hoisted(() => ({
  gotoMock: vi.fn(() => Promise.resolve()),
  focusFirstUnreadAgentMock: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: gotoMock }));

vi.mock('$features/agent/focus-first-unread-agent', () => ({
  focusFirstUnreadAgent: focusFirstUnreadAgentMock,
}));

vi.mock('$lib/components/workspace/WorkspaceCard.svelte', async () => ({
  default: (await import('./mocks/MockWorkspaceCard.svelte')).default,
}));

vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    fetchActiveStreams: vi.fn(),
    startPolling: vi.fn(),
    getStreamingAgentIdsForWorkspace: vi.fn(() => []),
    subscribe: vi.fn(() => () => {}),
  },
}));

function makeWorkspace(id: string, title: string, overrides?: Partial<Workspace>): Workspace {
  return {
    id: id as WorkspaceId,
    title,
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    repositoryPath: '/tmp/repo',
    worktreePath: `/tmp/worktrees/${id}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    ...overrides,
  };
}

function renderWith(workspaces: Workspace[]) {
  return render(ActiveWorkspacesCardHarness, {
    props: {
      setup: () => {
        workspaces.forEach((w) => appStore.dispatch(setWorkspaceEntity(w)));
        appStore.dispatch(setWorkspaceHasLoaded(true));
      },
      expanded: true,
    },
  });
}

function pressEnterOnCard(container: HTMLElement): void {
  const card = container.querySelector('div[tabindex]') as HTMLElement;
  card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

describe('ActiveWorkspacesCard unread-row activation', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(resetWorkspaceState());
    gotoMock.mockClear();
    focusFirstUnreadAgentMock.mockClear();
  });

  it('focuses the unread agent when an Unread row is clicked', async () => {
    renderWith([makeWorkspace('ws-unread', 'Unread WS', { attention: 'unread' })]);

    const row = await screen.findByText('Unread WS');
    row.click();

    await waitFor(() => {
      expect(gotoMock).toHaveBeenCalledWith('/workspace/ws-unread');
      expect(focusFirstUnreadAgentMock).toHaveBeenCalledWith('ws-unread', true);
    });
  });

  it('focuses the unread agent when Enter activates a highlighted Unread row', async () => {
    const { container } = renderWith([
      makeWorkspace('ws-unread', 'Unread WS', { attention: 'unread' }),
    ]);

    await screen.findByText('Unread WS');
    pressEnterOnCard(container);

    await waitFor(() => {
      expect(gotoMock).toHaveBeenCalledWith('/workspace/ws-unread');
      expect(focusFirstUnreadAgentMock).toHaveBeenCalledWith('ws-unread', true);
    });
  });

  it('does not focus an unread agent when Enter activates a non-unread row', async () => {
    const { container } = renderWith([
      makeWorkspace('ws-wait', 'Waiting WS', { displayStatus: 'in_progress' }),
    ]);

    await screen.findByText('Waiting WS');
    pressEnterOnCard(container);

    await waitFor(() => {
      expect(gotoMock).toHaveBeenCalledWith('/workspace/ws-wait');
    });
    expect(focusFirstUnreadAgentMock).not.toHaveBeenCalled();
  });
});
