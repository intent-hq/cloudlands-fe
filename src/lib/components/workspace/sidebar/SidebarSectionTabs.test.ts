import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSession } from '$shared/types';
import SidebarSectionTabs from './SidebarSectionTabs.svelte';

const live = await vi.hoisted(async () => {
  const { writable } = await import('svelte/store');
  return {
    agents: writable<AgentSession[]>([]),
    selected: writable(['agents']),
    unread: writable(false),
    collaborator: writable(false),
    people: writable([]),
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule();
});

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', async (original) => ({
  ...(await original<
    typeof import('$store/renderer/slices/workspace-agents/workspace-agents-selectors')
  >()),
  selectAllWorkspaceAgents: () => live.agents,
  selectWorkspaceHasUnreadForegroundAgents: () => live.unread,
}));

vi.mock('$store/renderer/slices/sidebar-nav/sidebar-nav-selectors', () => ({
  selectMultiSelectSidebarSelectedTabIds: () => live.selected,
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectIsWorkspaceCollaborator: () => live.collaborator,
}));

vi.mock('$store/renderer/slices/presence/presence-selectors', () => ({
  selectWorkspacePeopleTilePeople: () => live.people,
}));

function agent(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    workspaceId: 'workspace',
    status: 'idle',
    messages: [],
    createdAt: '2026-10-23T12:00:00Z',
    updatedAt: '2026-10-23T12:00:00Z',
    ...overrides,
  } as AgentSession;
}

beforeEach(() => {
  live.agents.set([]);
  live.selected.set(['agents']);
  live.unread.set(false);
  live.collaborator.set(false);
  live.people.set([]);
});

afterEach(cleanup);

describe('sidebar main-agent identity', () => {
  it('keeps the coordinator identity across section changes and follows its live state', async () => {
    const ordinary = agent('conversation');
    const main = agent('main', {
      metadata: { specialist: 'spec-writer' },
      status: 'active',
      isStreaming: true,
    });
    live.agents.set([ordinary, main]);
    const view = render(SidebarSectionTabs, { props: { workspaceId: 'workspace' } });
    const identity = () => view.container.querySelector('[data-sidebar-main-agent]');
    const avatarState = () => identity()?.querySelector('[data-avatar-state]');

    await waitFor(() => expect(identity()?.getAttribute('data-sidebar-main-agent')).toBe('main'));
    expect(avatarState()?.getAttribute('data-avatar-state')).toBe('running');
    live.selected.set(['context']);
    await waitFor(() =>
      expect(view.getByRole('tab', { name: 'Context' }).getAttribute('aria-selected')).toBe('true'),
    );
    expect(identity()?.getAttribute('data-sidebar-main-agent')).toBe('main');

    live.agents.set([ordinary, { ...main, status: 'idle', isStreaming: false } as AgentSession]);
    await waitFor(() => expect(avatarState()?.getAttribute('data-avatar-state')).toBe('idle'));
    expect(identity()?.getAttribute('aria-hidden')).toBe('true');
    expect(view.getByRole('tab', { name: 'Agents', exact: true })).toBeTruthy();

    live.unread.set(true);
    live.agents.set([
      ordinary,
      { ...main, status: 'idle', isStreaming: false, hasUnread: true } as AgentSession,
    ]);
    await waitFor(() =>
      expect(view.container.querySelector('[data-sidebar-tab-unread-dot]')).not.toBeNull(),
    );
    expect(avatarState()?.getAttribute('data-avatar-state')).toBe('idle');
    expect(identity()?.querySelector('[data-avatar-unread-dot]')).toBeNull();
  });

  it('uses the robot when no eligible main agent exists and recovers as agents load', async () => {
    const delegated = agent('delegated', {
      parentSessionId: 'parent',
      metadata: { specialist: 'spec-writer' },
    });
    const background = agent('background', { isBackground: true });
    const retired = agent('retired', { retiredAt: '2026-10-23T13:00:00Z' });
    live.agents.set([delegated, background, retired]);
    const view = render(SidebarSectionTabs, { props: { workspaceId: 'workspace' } });
    const tab = () => view.getByRole('tab', { name: 'Agents', exact: true });

    expect(tab().querySelector('[data-sidebar-main-agent]')).toBeNull();
    expect(tab().querySelector('[data-icon="robot"]')).not.toBeNull();

    live.agents.set([delegated, background, retired, agent('main')]);
    await waitFor(() =>
      expect(
        tab().querySelector('[data-sidebar-main-agent]')?.getAttribute('data-sidebar-main-agent'),
      ).toBe('main'),
    );
    expect(tab().querySelector('[data-icon="robot"]')).toBeNull();

    await view.rerender({ workspaceId: 'another-workspace' });
    await waitFor(() => expect(tab().querySelector('[data-sidebar-main-agent]')).toBeNull());
    expect(tab().querySelector('[data-icon="robot"]')).not.toBeNull();
  });
});
