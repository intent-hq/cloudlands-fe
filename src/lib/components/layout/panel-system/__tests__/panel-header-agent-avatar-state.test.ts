/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener<T> = (value: T) => void;

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));

const constantReadable = <T>(value: T) => ({
  subscribe(run: Listener<T>) {
    run(value);
    return () => {};
  },
});

vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: mocks.dispatch,
    state: { panelLayout: { byWorkspaceId: { 'workspace-1': { panels: {} } } } },
  },
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-selectors', () => ({
  selectIsDragging: () => constantReadable(false),
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-slice', () => ({
  startDrag: () => ({ type: 'tabState/startDrag' }),
  endDrag: () => ({ type: 'tabState/endDrag' }),
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectRecentlyClosed: () => constantReadable([]),
  selectPanelColumnCount: () => constantReadable(1),
  selectPanelLayoutWorkspace: { select: () => ({ panels: {} }) },
}));
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: { select: () => null },
}));
vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  filterPickableSpecialists: (value: unknown[]) => value,
  selectSpecialistName: { select: () => null },
  selectSpecialists: () => constantReadable([]),
}));
vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: () => constantReadable(false),
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: { select: () => null },
  selectIsWorkspaceHostLocal: () => constantReadable(true),
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: () => constantReadable([]),
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: () => constantReadable(null),
  selectAgentProvider: () => constantReadable(undefined),
  selectAgentIsResponding: Object.assign(() => constantReadable(false), {
    select: () => false,
  }),
  selectAgentMessageById: { select: () => undefined },
  selectAgentIsBlockedWaiting: () => constantReadable(false),
  selectAgentAttentionRequest: () => constantReadable(null),
}));
vi.mock('$store/renderer/slices/hud/hud-selectors', () => ({
  selectHudAgentHasPendingQuestion: () => constantReadable(false),
}));
vi.mock('$store/renderer/slices/permission/permission-selectors', () => ({
  selectPermissionRequests: () => constantReadable([]),
  selectPendingCount: () => constantReadable(0),
}));
vi.mock('$lib/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => ({
  default: (await import('$lib/components/workspace/__tests__/mocks/MockAgentAvatar.svelte'))
    .default,
}));
vi.mock('$features/agent/components/agent-avatar/AgentAvatarWithState.svelte', async () => ({
  default: (await import('$lib/components/workspace/__tests__/mocks/MockAgentAvatar.svelte'))
    .default,
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import PanelTabBar from '../PanelTabBar.svelte';
const tabs = [
  { id: 'tab-a', type: 'agent' as const, title: 'Agent A', agentId: 'agent-a', closable: true },
  { id: 'tab-b', type: 'agent' as const, title: 'Agent B', agentId: 'agent-b', closable: true },
];

function expectChatBubbleIdentity(root: ParentNode) {
  expect(root.querySelector('[data-icon="comment"]')).not.toBeNull();
  expect(root.querySelector('[data-testid="mock-avatar"]')).toBeNull();
  expect(root.querySelector('[data-agent-avatar-surface]')).toBeNull();
}

function expectHeaderAvatarIdentity(root: ParentNode, agentId: string) {
  const avatar = root.querySelector<HTMLElement>('[data-testid="mock-avatar"]');
  expect(avatar?.dataset.agentId).toBe(agentId);
  expect(avatar?.dataset.avatarVariant).toBe('emphasized');
  expect(avatar?.hasAttribute('data-agent-avatar-surface')).toBe(true);
  expect(root.querySelector('[data-panel-agent-chat-glyph]')).toBeNull();
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  mocks.dispatch.mockClear();
  document.documentElement.className = '';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('panel header agent identity', () => {
  it('uses the active agent avatar in the tabless header', () => {
    const { container } = render(PanelTabBar, {
      props: {
        tabs: [tabs[0]],
        activeTabId: 'tab-a',
        panelId: 'panel-1',
        workspaceId: 'workspace-1',
      },
    });
    const header = container.querySelector('[data-panel-tabless-header]')!;
    const activeIdentity = header.querySelector('[data-panel-agent-header-identity]')!;
    const leadingSurface = activeIdentity.querySelector(
      '[data-testid="panel-header-agent-avatar-slot"]',
    )!;

    expect(header.querySelector('[data-panel-agent-header-identity]')).not.toBeNull();
    expect(activeIdentity.textContent).toContain('Agent A');
    expect(leadingSurface.hasAttribute('data-panel-header-leading-surface')).toBe(true);
    expectHeaderAvatarIdentity(leadingSurface, 'agent-a');
  });

  it('updates the avatar identity when the active agent pane changes', async () => {
    const view = render(PanelTabBar, {
      props: {
        tabs: [tabs[0]],
        activeTabId: 'tab-a',
        panelId: 'panel-1',
        workspaceId: 'workspace-1',
      },
    });

    await view.rerender({
      tabs: [tabs[1]],
      activeTabId: 'tab-b',
      panelId: 'panel-1',
      workspaceId: 'workspace-1',
    });
    const activeIdentity = view.container.querySelector('[data-panel-agent-header-identity]')!;
    expect(activeIdentity.textContent).toContain('Agent B');
    expectHeaderAvatarIdentity(activeIdentity, 'agent-b');
  });

  it('uses chat bubbles without avatar-state surfaces for agent rows in tabs', () => {
    const { container } = render(PanelTabBar, {
      props: { tabs, activeTabId: 'tab-a', panelId: 'panel-1', workspaceId: 'workspace-1' },
    });
    const rows = Array.from(container.querySelectorAll('[data-tab-id]'));

    expect(rows.map((row) => row.getAttribute('data-tab-id'))).toEqual(['tab-a', 'tab-b']);
    rows.forEach(expectChatBubbleIdentity);
    expect(container.querySelector('[data-testid="pane-stack-selector-trigger"]')).toBeNull();
  });
});
