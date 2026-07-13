import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  cleanup,
  render,
  screen,
  waitFor,
} from '@testing-library/svelte';

const mockState = vi.hoisted(() => {
  type Subscriber<T> = (value: T) => void;
  function store<T>(initial: T) {
    let value = initial;
    const subscribers = new Set<Subscriber<T>>();
    return {
      get: () => value,
      set: (next: T) => {
        value = next;
        subscribers.forEach((run) => run(value));
      },
      subscribe: (run: Subscriber<T>) => {
        run(value);
        subscribers.add(run);
        return () => subscribers.delete(run);
      },
    };
  }

  return {
    workspace: store({ id: 'ws-1', path: '/tmp/ws-1', branchName: 'main' }),
    activeAgentId: store('agent-1'),
    defaultModel: store('auggie:default'),
    dispatch: vi.fn(),
    agents: store<Record<string, any>>({
      'agent-1': { id: 'agent-1', workspaceId: 'ws-1', model: 'auggie:butler', provider: 'auggie' },
    }),
  };
});

vi.mock('$lib/components/chat/ChatPanel.svelte', async () => ({
  default: (await import('./mocks/ChatPanelAgentModel.svelte')).default,
}));
vi.mock('$lib/components/AgentBrowserPanel.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$features/agent/browser/components/AgentBrowserPanel.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/ui/button', async () => ({
  Button: (await import('$lib/components/ui/__tests__/mocks/button.svelte')).default,
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));
vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faCheck: { iconName: 'check' },
  faCopy: { iconName: 'copy' },
  faTrash: { iconName: 'trash' },
}));
vi.mock('$lib/icons/faNote', () => ({ faNote: { iconName: 'note' } }));
vi.mock('$lib/components/layout/panel-system/panel-header-context.svelte', () => ({
  getPanelHeaderContext: () => ({ registerActions: vi.fn(), registerState: vi.fn() }),
}));
vi.mock('$features/agent/browser', () => ({
  subscribeToAgent: (agentId: string, run: (session: any) => void) => {
    run(mockState.agents.get()[agentId]);
    return () => {};
  },
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({ agents: mockState.agents.get() }),
    dispatch: mockState.dispatch,
  });
});
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: () => mockState.workspace,
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectActiveAgentId: () => mockState.activeAgentId,
  selectInitialAgentId: () => ({
    subscribe: (run: (value: string | null) => void) => (run(null), () => {}),
  }),
  selectAgentSession: (
    agentIdStore: { subscribe: (run: (value: string) => void) => () => void } | string,
  ) => ({
    subscribe: (run: (value: any) => void) => {
      let currentAgentId = typeof agentIdStore === 'string' ? agentIdStore : '';
      const unsubs: Array<() => void> = [];
      if (typeof agentIdStore !== 'string') {
        unsubs.push(
          agentIdStore.subscribe((agentId) => {
            currentAgentId = agentId;
            run(mockState.agents.get()[currentAgentId]);
          }),
        );
      }
      unsubs.push(mockState.agents.subscribe((agents) => run(agents[currentAgentId])));
      if (typeof agentIdStore === 'string') run(mockState.agents.get()[currentAgentId]);
      return () => unsubs.forEach((unsub) => unsub());
    },
  }),
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: (
    agentIdStore: { subscribe: (run: (value: string) => void) => () => void } | string,
  ) => ({
    subscribe: (run: (value: any) => void) => {
      let currentAgentId = typeof agentIdStore === 'string' ? agentIdStore : '';
      const unsubs: Array<() => void> = [];
      if (typeof agentIdStore !== 'string') {
        unsubs.push(
          agentIdStore.subscribe((agentId) => {
            currentAgentId = agentId;
            run(mockState.agents.get()[currentAgentId]);
          }),
        );
      }
      unsubs.push(mockState.agents.subscribe((agents) => run(agents[currentAgentId])));
      if (typeof agentIdStore === 'string') run(mockState.agents.get()[currentAgentId]);
      return () => unsubs.forEach((unsub) => unsub());
    },
  }),
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectAgentTabInfoByTabId: () => ({
    subscribe: (run: (value: null) => void) => (run(null), () => {}),
  }),
}));
vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectWorkspaceDefaultModel: () => mockState.defaultModel,
}));
vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectAgentFontStyleLabel: () => ({
    subscribe: (run: (value: string) => void) => (run('Default'), () => {}),
  }),
  selectIsAgentMonospace: () => ({
    subscribe: (run: (value: boolean) => void) => (run(false), () => {}),
  }),
}));
vi.mock('$store/renderer/slices/user-preferences/user-preferences-slice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$store/renderer/slices/user-preferences/user-preferences-slice')>()),
  cycleFontStyle: () => ({ type: 'userPreferences/cycleFontStyle' }),
}));
vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: () => ({
    subscribe: (run: (value: unknown[]) => void) => (run([]), () => {}),
  }),
  selectSpecialistName: { select: () => undefined },
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-slice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$store/renderer/slices/panel-layout/panel-layout-slice')>()),
  closeTab: () => ({ type: 'panelLayout/closeTab' }),
}));
vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToNote: vi.fn() }));
vi.mock('$lib/utils/clipboard-formatters', () => ({
  formatAgentMessagesForClipboard: vi.fn(() => ''),
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import AgentTabType from '../AgentTabType.svelte';

describe('AgentTabType agent model reactivity', () => {
  beforeEach(() => {
    mockState.workspace.set({ id: 'ws-1', path: '/tmp/ws-1', branchName: 'main' });
    mockState.activeAgentId.set('agent-1');
    mockState.defaultModel.set('auggie:default');
    mockState.dispatch.mockClear();
    mockState.agents.set({
      'agent-1': { id: 'agent-1', workspaceId: 'ws-1', model: 'auggie:butler', provider: 'auggie' },
    });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('updates the ChatPanel agentModel prop when Redux session model changes', async () => {
    render(AgentTabType, {
      props: {
        tab: { id: 'tab-1', type: 'agent', title: 'Agent', agentId: 'agent-1' },
        workspaceId: 'ws-1',
        isActive: true,
        isPanelFocused: true,
      },
    });

    expect(screen.getByTestId('chat-panel-agent-model').dataset.agentModel).toBe('auggie:butler');

    mockState.agents.set({
      'agent-1': {
        id: 'agent-1',
        workspaceId: 'ws-1',
        model: 'anthropic:claude-opus-4-7',
        provider: 'anthropic',
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('chat-panel-agent-model').dataset.agentModel).toBe(
        'anthropic:claude-opus-4-7',
      );
    });
  });
});
