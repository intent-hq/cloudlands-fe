/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener<T> = (value: T) => void;

const mocks = vi.hoisted(() => {
  function channel<T>(initial: T) {
    let value = initial;
    const listeners = new Set<Listener<T>>();
    return {
      subscribe(run: Listener<T>) {
        listeners.add(run);
        run(value);
        return () => listeners.delete(run);
      },
      set(next: T) {
        value = next;
        listeners.forEach((run) => run(value));
      },
      get: () => value,
    };
  }

  const sessions = channel<Record<string, any>>({});
  const responding = channel<Record<string, boolean>>({});
  const blockedWaiting = channel<Record<string, boolean>>({});
  const attention = channel<Record<string, any>>({});
  const permissions = channel<any[]>([]);
  const agents = channel<any[]>([]);

  function keyed<T>(
    keyStore: { subscribe: (run: Listener<string>) => () => void },
    source: { subscribe: (run: Listener<Record<string, T>>) => () => void },
  ) {
    return {
      subscribe(run: Listener<T | undefined>) {
        let key = '';
        let values: Record<string, T> = {};
        const emit = () => run(values[key]);
        const unsubscribeKey = keyStore.subscribe((next) => {
          key = next;
          emit();
        });
        const unsubscribeSource = source.subscribe((next) => {
          values = next;
          emit();
        });
        return () => {
          unsubscribeKey();
          unsubscribeSource();
        };
      },
    };
  }

  const dispatch = vi.fn((action: any) => {
    const [agentId, value] = action.payload ?? [];
    if (action.type === 'test/session') sessions.set({ ...sessions.get(), [agentId]: value });
    if (action.type === 'test/responding') {
      responding.set({ ...responding.get(), [agentId]: value });
    }
    if (action.type === 'test/blocked-waiting') {
      blockedWaiting.set({ ...blockedWaiting.get(), [agentId]: value });
    }
    if (action.type === 'test/attention') attention.set({ ...attention.get(), [agentId]: value });
    if (action.type === 'test/permissions') permissions.set(value);
  });

  return { agents, attention, blockedWaiting, dispatch, keyed, permissions, responding, sessions };
});

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
  selectAllWorkspaceAgents: () => mocks.agents,
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: (key: any) => mocks.keyed(key, mocks.sessions),
  selectAgentIsResponding: (key: any) => mocks.keyed(key, mocks.responding),
  selectAgentIsBlockedWaiting: (key: any) => mocks.keyed(key, mocks.blockedWaiting),
  selectAgentAttentionRequest: (key: any) => mocks.keyed(key, mocks.attention),
}));
vi.mock('$store/renderer/slices/permission/permission-selectors', () => ({
  selectPermissionRequests: () => mocks.permissions,
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
import { store as appStore } from '$store/renderer/store';

const tabs = [
  { id: 'tab-a', type: 'agent' as const, title: 'Agent A', agentId: 'agent-a', closable: true },
  { id: 'tab-b', type: 'agent' as const, title: 'Agent B', agentId: 'agent-b', closable: true },
];

function session(id: string, changes: Record<string, unknown> = {}) {
  return { id, name: id, status: 'active', messages: [], ...changes };
}

function stateAvatar(container: HTMLElement) {
  return container.querySelector<HTMLElement>(
    '[data-testid="panel-header-agent-avatar-slot"] [data-testid="mock-avatar"]',
  )!;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  mocks.dispatch.mockClear();
  mocks.agents.set(tabs.map((tab) => session(tab.agentId)));
  mocks.sessions.set({ 'agent-a': session('agent-a'), 'agent-b': session('agent-b') });
  mocks.responding.set({});
  mocks.blockedWaiting.set({});
  mocks.attention.set({});
  mocks.permissions.set([]);
  document.documentElement.className = '';
});

afterEach(() => cleanup());

describe('panel header agent avatar state', () => {
  it('reacts idle → running → settled to dispatches without remounting', async () => {
    const { container } = render(PanelTabBar, {
      props: { tabs, activeTabId: 'tab-a', panelId: 'panel-1', workspaceId: 'workspace-1' },
    });
    const avatar = stateAvatar(container);
    expect(avatar.dataset.state).toBe('idle');

    appStore.dispatch({ type: 'test/responding', payload: ['agent-a', true] });
    await waitFor(() => expect(avatar.dataset.state).toBe('running'));

    appStore.dispatch({ type: 'test/responding', payload: ['agent-a', false] });
    appStore.dispatch({ type: 'test/session', payload: ['agent-a', session('agent-a')] });
    await waitFor(() => expect(avatar.dataset.state).toBe('idle'));
  });

  it('switches the reactive key and preserves wait, failure, permission, and attention precedence', async () => {
    appStore.dispatch({ type: 'test/responding', payload: ['agent-b', true] });
    const view = render(PanelTabBar, {
      props: { tabs, activeTabId: 'tab-a', panelId: 'panel-1', workspaceId: 'workspace-1' },
    });
    expect(stateAvatar(view.container).dataset.agentId).toBe('agent-a');

    await view.rerender({
      tabs,
      activeTabId: 'tab-b',
      panelId: 'panel-1',
      workspaceId: 'workspace-1',
    });
    await waitFor(() => expect(stateAvatar(view.container).dataset.state).toBe('running'));

    appStore.dispatch({ type: 'test/blocked-waiting', payload: ['agent-b', true] });
    await waitFor(() => expect(stateAvatar(view.container).dataset.state).toBe('waiting'));

    appStore.dispatch({
      type: 'test/session',
      payload: ['agent-b', session('agent-b', { status: 'error' })],
    });
    await waitFor(() => expect(stateAvatar(view.container).dataset.state).toBe('failed'));

    appStore.dispatch({ type: 'test/session', payload: ['agent-b', session('agent-b')] });
    appStore.dispatch({ type: 'test/blocked-waiting', payload: ['agent-b', false] });
    appStore.dispatch({ type: 'test/permissions', payload: [null, [{ sessionId: 'agent-b' }]] });
    await waitFor(() => expect(stateAvatar(view.container).dataset.state).toBe('needs-permission'));

    appStore.dispatch({ type: 'test/permissions', payload: [null, []] });
    appStore.dispatch({ type: 'test/attention', payload: ['agent-b', { kind: 'blocker' }] });
    await waitFor(() =>
      expect(stateAvatar(view.container).dataset.state).toBe('attention-blocker'),
    );
  });

  it.each([{ theme: 'light' }, { theme: 'dark' }])(
    'keeps a centered 20px surface at narrow 200% in $theme',
    async ({ theme }) => {
      document.documentElement.className = theme === 'dark' ? 'dark' : '';
      const { container } = render(PanelTabBar, {
        props: { tabs, activeTabId: 'tab-a', panelId: 'panel-1', workspaceId: 'workspace-1' },
      });
      container.style.width = '280px';
      container.style.zoom = '2';
      const slot = container.querySelector<HTMLElement>(
        '[data-testid="panel-header-agent-avatar-slot"]',
      )!;
      const avatar = stateAvatar(container);
      expect(slot.className).toContain('size-5');
      expect(slot.className).toContain('items-center');
      expect(slot.className).toContain('justify-center');
      expect(avatar.style.width).toBe('20px');
      expect(avatar.style.height).toBe('20px');
      expect(slot.parentElement?.className).toContain('items-center');
    },
  );
});
