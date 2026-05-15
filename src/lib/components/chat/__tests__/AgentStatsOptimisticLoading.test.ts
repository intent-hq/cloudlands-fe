import {
  fireEvent,
  render,
  waitFor,
} from '@testing-library/svelte';
import { tick } from 'svelte';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  AGENT_STATS_TOOLTIP_TITLE,
  AGENT_STATS_TRIGGER_LABEL,
} from '../agent-stats-tooltip-copy';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const subscribeToAgent = vi.fn();
  const statsState = {
    stats: undefined as unknown,
    loading: false,
    error: undefined as string | undefined,
  };
  const agents = {} as Record<string, Record<string, unknown> | undefined>;

  const readable = <T>(getter: () => T) => ({
    subscribe(run: (value: T) => void) {
      run(getter());
      return () => {};
    },
  });

  return { dispatch, subscribeToAgent, statsState, agents, readable };
});

vi.mock('$lib/components/ui/tooltip', async () => {
  const TooltipRich = (await import('./mocks/TooltipRich.svelte')).default;
  return { TooltipRich, TooltipShortcut: TooltipRich };
});

vi.mock('$lib/components/ui/button', async () => ({
  Button: (await import('./mocks/Button.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({ default: (await import('./mocks/SlotOnly.svelte')).default }));
vi.mock('$lib/components/chat/ChatPanel.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/shared/LineChangeStats.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/ui/RelativeTime.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/chat/AgentPreviewToolLabel.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: () => ({ getState: () => ({}), dispatch: mocks.dispatch }),
}));
vi.mock('$lib/store/utils/svelte-context', () => ({
  getDispatch: () => mocks.dispatch,
}));
vi.mock('$features/agent/browser', () => ({ subscribeToAgent: mocks.subscribeToAgent }));
vi.mock('$lib/store/slices/session-stats/session-stats-slice', () => ({
  fetchAgentStats: vi.fn((agentId: string, sessionId: string) => ({
    type: 'sessionStats/fetchAgentStats',
    payload: [agentId, sessionId],
  })),
}));
vi.mock('$lib/store/slices/session-stats/session-stats-selectors', () => ({
  selectAgentStats: () => mocks.readable(() => mocks.statsState.stats),
  selectIsLoadingAgentStats: () => mocks.readable(() => mocks.statsState.loading),
  selectAgentStatsError: () => mocks.readable(() => mocks.statsState.error),
}));
vi.mock('$lib/store/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: Object.assign((agentId: string) => mocks.readable(() => mocks.agents[agentId]), {
    select: (_state: unknown, agentId: string) => mocks.agents[agentId],
  }),
  selectAgentIsResponding: () => mocks.readable(() => false),
  selectAgentIsWaiting: () => mocks.readable(() => false),
  selectAgentSessionStreamingContent: () => mocks.readable(() => ''),
}));
vi.mock('$lib/store/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAgentSession: Object.assign((agentId: string) => mocks.readable(() => mocks.agents[agentId]), {
    select: (_state: unknown, agentId: string) => mocks.agents[agentId],
  }),
  selectWorkspaceAgentSession: {
    select: (_state: unknown, _wsId: string, agentId: string) => mocks.agents[agentId],
  },
  selectInitialAgentId: () => mocks.readable(() => undefined),
}));
vi.mock('$lib/store/slices/workspace-agents/workspace-agents-slice', () => ({
  ensureAgentSessionLoaded: vi.fn((wsId: string, agentId: string) => ({
    type: 'ensure',
    payload: [wsId, agentId],
  })),
}));
vi.mock('$lib/store/slices/changes/changes-selectors', () => ({
  selectAgentLineStats: () => mocks.readable(() => null),
}));
vi.mock('$lib/store/slices/permission/permission-selectors', () => ({
  selectPendingCount: () => mocks.readable(() => 0),
}));
vi.mock('$lib/store/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: { select: () => 'ws-1' },
  selectWorkspaceById: () => mocks.readable(() => ({ id: 'ws-1', name: 'Workspace' })),
}));
vi.mock('$lib/store/slices/model/model-selectors', () => ({
  selectWorkspaceDefaultModel: () => mocks.readable(() => 'auggie:opus'),
}));
vi.mock('$lib/store/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: () => mocks.readable(() => []),
  selectSpecialistName: { select: () => null },
}));
vi.mock('$lib/store/slices/panel-layout/panel-layout-slice', () => ({
  closeTab: vi.fn((workspaceId: string, tabId: string) => ({
    type: 'closeTab',
    payload: [workspaceId, tabId],
  })),
}));
vi.mock('$lib/store/slices/user-preferences/user-preferences-slice', () => ({
  cycleFontStyle: vi.fn(() => ({ type: 'cycleFontStyle' })),
}));
vi.mock('$lib/store/slices/user-preferences/user-preferences-selectors', () => ({
  selectAgentFontStyleLabel: () => mocks.readable(() => 'Sans'),
  selectIsAgentMonospace: () => mocks.readable(() => false),
}));
vi.mock('$lib/store/slices/app-layout/app-layout-slice', () => ({
  openAgentTabRequested: vi.fn((workspaceId: string, payload: unknown) => ({
    type: 'openAgent',
    payload: [workspaceId, payload],
  })),
}));
vi.mock('$lib/store/slices/agent-session/agent-session-slice', () => ({
  updateSession: vi.fn((agentId: string, update: unknown) => ({
    type: 'updateSession',
    payload: [agentId, update],
  })),
}));
vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: vi.fn(),
  hasPanelLayoutManager: vi.fn(() => false),
}));
vi.mock('$lib/utils/workspace-navigation', () => ({
  findSourcePanelId: vi.fn(() => undefined),
  navigateToNote: vi.fn(),
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
}));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn() } }));

const auggieSession = { id: 'agent-1', provider: 'auggie', acpSessionId: 'sess-1', name: 'Agent' };

describe('agent stats optimistic tooltip loading', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.subscribeToAgent.mockReset().mockImplementation((_agentId, cb) => {
      cb(auggieSession);
      return () => {};
    });
    mocks.statsState.stats = undefined;
    mocks.statsState.loading = false;
    mocks.statsState.error = undefined;
    mocks.agents['agent-1'] = auggieSession;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('AgentCard shows the stats skeleton immediately after hover intent while Redux loading is still false', async () => {
    vi.useFakeTimers();
    const AgentCard = (await import('../AgentCard.svelte')).default;
    const screen = render(AgentCard, { props: { agentId: 'agent-1' } });

    expect(screen.getByTestId('mock-tooltip-rich').dataset.title).toBe(AGENT_STATS_TOOLTIP_TITLE);
    await fireEvent.mouseEnter(screen.getByTestId('mock-tooltip-rich'));
    await tick();

    expect(screen.getByLabelText('Loading agent stats')).toBeTruthy();
    expect(screen.queryByText('No stats available')).toBeNull();
    expect(mocks.dispatch).not.toHaveBeenCalledWith({
      type: 'sessionStats/fetchAgentStats',
      payload: ['agent-1', 'sess-1'],
    });

    await vi.advanceTimersByTimeAsync(400);
    await tick();

    await waitFor(() => expect(screen.getByLabelText('Loading agent stats')).toBeTruthy());
    expect(screen.queryByText('No stats available')).toBeNull();
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'sessionStats/fetchAgentStats',
      payload: ['agent-1', 'sess-1'],
    });
  });

  it('AgentCard does not render or fetch stats tooltip for non-Auggie sidebar agents', async () => {
    vi.useFakeTimers();
    mocks.agents['agent-1'] = { ...auggieSession, provider: 'opencode' };
    const AgentCard = (await import('../AgentCard.svelte')).default;
    const screen = render(AgentCard, { props: { agentId: 'agent-1' } });

    expect(screen.getByTestId('agent-list-item')).toBeTruthy();
    expect(screen.queryByTestId('mock-tooltip-rich')).toBeNull();

    await fireEvent.mouseEnter(screen.getByTestId('agent-list-item'));
    await vi.advanceTimersByTimeAsync(500);
    await tick();

    expect(screen.queryByLabelText('Loading agent stats')).toBeNull();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sessionStats/fetchAgentStats' }),
    );
  });

  it('AgentCard does not render stats tooltip for unknown sidebar agents', async () => {
    vi.useFakeTimers();
    const AgentCard = (await import('../AgentCard.svelte')).default;
    const screen = render(AgentCard, {
      props: { agentId: 'unknown-agent', agentName: 'Unknown Agent' },
    });

    expect(screen.getByTestId('agent-list-item')).toBeTruthy();
    expect(screen.queryByTestId('mock-tooltip-rich')).toBeNull();

    await fireEvent.mouseEnter(screen.getByTestId('agent-list-item'));
    await vi.advanceTimersByTimeAsync(500);
    await tick();

    expect(screen.queryByLabelText('Loading agent stats')).toBeNull();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sessionStats/fetchAgentStats' }),
    );
  });

  it('AgentTabType shows the stats skeleton on first open before Redux loading catches up', async () => {
    const AgentTabTypeHarness = (await import('./mocks/AgentTabTypeHarness.svelte')).default;
    const screen = render(AgentTabTypeHarness, {
      props: {
        tab: { id: 'tab-1', type: 'agent', title: 'Agent', closable: true, agentId: 'agent-1' },
        workspaceId: 'ws-1',
        isActive: true,
        isPanelFocused: true,
      },
    });

    expect(screen.getByLabelText(AGENT_STATS_TRIGGER_LABEL)).toBeTruthy();
    expect(screen.getByTestId('mock-tooltip-rich').dataset.title).toBe(AGENT_STATS_TOOLTIP_TITLE);
    await fireEvent.mouseEnter(screen.getByTestId('mock-tooltip-rich'));
    await tick();

    expect(screen.getByLabelText('Loading agent stats')).toBeTruthy();
    expect(screen.queryByText('No stats available')).toBeNull();
    expect(mocks.dispatch).not.toHaveBeenCalledWith({
      type: 'sessionStats/fetchAgentStats',
      payload: ['agent-1', 'sess-1'],
    });
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: 'sessionStats/fetchAgentStats',
        payload: ['agent-1', 'sess-1'],
      }),
    );
  });

  it('AgentTabType retry suppresses a stale Redux error while the optimistic retry is pending', async () => {
    mocks.statsState.error = 'previous failure';
    const AgentTabTypeHarness = (await import('./mocks/AgentTabTypeHarness.svelte')).default;
    const screen = render(AgentTabTypeHarness, {
      props: {
        tab: { id: 'tab-1', type: 'agent', title: 'Agent', closable: true, agentId: 'agent-1' },
        workspaceId: 'ws-1',
        isActive: true,
        isPanelFocused: true,
      },
    });

    await fireEvent.mouseEnter(screen.getByTestId('mock-tooltip-rich'));
    await tick();

    await waitFor(() => expect(screen.getByLabelText('Loading agent stats')).toBeTruthy());
    expect(screen.queryByText('Failed to load stats')).toBeNull();
  });

  it('AgentTabType shows the stats action when provider falls back from acp to an Auggie model', async () => {
    mocks.agents['agent-1'] = {
      ...auggieSession,
      provider: 'acp',
      model: 'auggie:opus4.7',
    };
    const AgentTabTypeHarness = (await import('./mocks/AgentTabTypeHarness.svelte')).default;
    const screen = render(AgentTabTypeHarness, {
      props: {
        tab: { id: 'tab-1', type: 'agent', title: 'Agent', closable: true, agentId: 'agent-1' },
        workspaceId: 'ws-1',
        isActive: true,
        isPanelFocused: true,
      },
    });

    expect(screen.getByLabelText(AGENT_STATS_TRIGGER_LABEL)).toBeTruthy();
    expect(screen.getByTestId('mock-tooltip-rich').dataset.title).toBe(AGENT_STATS_TOOLTIP_TITLE);
  });

  it('AgentTabType hides the stats action for non-Auggie agents', async () => {
    mocks.agents['agent-1'] = { ...auggieSession, provider: 'opencode' };
    const AgentTabTypeHarness = (await import('./mocks/AgentTabTypeHarness.svelte')).default;
    const screen = render(AgentTabTypeHarness, {
      props: {
        tab: { id: 'tab-1', type: 'agent', title: 'Agent', closable: true, agentId: 'agent-1' },
        workspaceId: 'ws-1',
        isActive: true,
        isPanelFocused: true,
      },
    });

    expect(screen.queryByLabelText(AGENT_STATS_TRIGGER_LABEL)).toBeNull();
    expect(screen.queryByTestId('mock-tooltip-rich')).toBeNull();
    expect(screen.queryByLabelText('Loading agent stats')).toBeNull();
  });
});
