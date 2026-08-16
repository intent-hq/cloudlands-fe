/**
 * @vitest-environment jsdom
 *
 * AgentTabType — read-only "Harness vX.Y" entry in the panel actions (⋯)
 * menu (PROTOCOL §5.5 `harnessVersion` / `harnessFeatures`; monorepo#2459).
 *
 * Mirrors AgentCard-harness-version.test.ts for the tab menu: renders the
 * agentActions snippet through the real panel-header context and real Menu
 * components, and asserts the item's visibility, the feature-list flyout
 * (on/off states), and that legacy/absent shapes render sensibly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';

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
    defaultModel: store('auggie:default'),
    dispatch: vi.fn(),
    agents: store<Record<string, any>>({}),
  };
});

vi.mock('$lib/components/chat/ChatPanel.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({ agents: mockState.agents.get() }),
    dispatch: mockState.dispatch,
  });
});
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: () => mockState.workspace,
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectInitialAgentId: () => ({
    subscribe: (run: (value: string | null) => void) => (run(null), () => {}),
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
vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectSelectedModel: () => mockState.defaultModel,
}));
vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectAgentFontStyle: () => ({
    subscribe: (run: (value: string) => void) => (run('sans'), () => {}),
  }),
  selectAgentFontStyleLabel: () => ({
    subscribe: (run: (value: string) => void) => (run('Default'), () => {}),
  }),
  selectIsAgentMonospace: () => ({
    subscribe: (run: (value: boolean) => void) => (run(false), () => {}),
  }),
  selectShowReasoningBlocks: () => ({
    subscribe: (run: (value: boolean) => void) => (run(false), () => {}),
  }),
}));
vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: () => ({
    subscribe: (run: (value: unknown[]) => void) => (run([]), () => {}),
  }),
  selectSpecialistName: { select: () => undefined },
}));
vi.mock('$features/agent/browser', () => ({
  subscribeToAgent: (agentId: string, run: (session: any) => void) => {
    run(mockState.agents.get()[agentId]);
    return () => {};
  },
}));
vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToNote: vi.fn() }));
vi.mock('$lib/utils/clipboard-formatters', () => ({
  formatAgentMessagesForClipboard: vi.fn(() => ''),
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import AgentTabType from '../AgentTabType.svelte';
import MockTabTypeHeaderHarness from './mocks/MockTabTypeHeaderHarness.svelte';

function seedSession(overrides: Record<string, unknown> = {}) {
  mockState.agents.set({
    'agent-1': {
      id: 'agent-1',
      workspaceId: 'ws-1',
      name: 'Harnessed Agent',
      messages: [],
      ...overrides,
    },
  });
}

function renderTab() {
  render(MockTabTypeHeaderHarness, {
    props: {
      component: AgentTabType,
      tab: { id: 'tab-1', type: 'agent', title: 'Agent', agentId: 'agent-1' },
      workspaceId: 'ws-1',
      isActive: true,
    },
  });
}

async function openPanelActionsMenu() {
  const trigger = await screen.findByRole('button', { name: 'Panel actions' });
  await fireEvent.click(trigger);
  await screen.findByRole('menu');
}

describe('AgentTabType harness version panel-actions menu item', () => {
  beforeEach(() => {
    mockState.dispatch.mockClear();
    mockState.agents.set({});
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('shows a disabled "Harness v1.0" item for a legacy session without a features snapshot', async () => {
    seedSession({ harnessVersion: '1.0' });
    renderTab();
    await openPanelActionsMenu();

    const item = await screen.findByText('Harness v1.0');
    const menuItem = item.closest('[role="menuitem"]');
    expect(menuItem).not.toBeNull();
    expect(menuItem!.getAttribute('aria-disabled')).toBe('true');
  });

  it('lists feature on/off states in a flyout when the session carries harnessFeatures', async () => {
    seedSession({
      harnessVersion: '1.0',
      harnessFeatures: { structuredQuestions: true, agentActions: false },
    });
    renderTab();
    await openPanelActionsMenu();

    const item = await screen.findByText('Harness v1.0');
    const subTrigger = item.closest('[role="menuitem"]');
    expect(subTrigger).not.toBeNull();
    // Parent is enabled so the flyout can open, and marked as a submenu host.
    expect(subTrigger!.getAttribute('aria-disabled')).not.toBe('true');
    expect(subTrigger!.getAttribute('aria-haspopup')).toBe('menu');

    (subTrigger as HTMLElement).focus();
    await fireEvent.keyDown(subTrigger!, { key: 'ArrowRight' });

    // Feature identifiers rendered verbatim; enabled entries show the check.
    const enabledEntry = await screen.findByText('structuredQuestions');
    const disabledEntry = await screen.findByText('agentActions');
    const enabledItem = enabledEntry.closest('[role="menuitem"]') as HTMLElement;
    const disabledItem = disabledEntry.closest('[role="menuitem"]') as HTMLElement;
    expect(enabledItem.querySelector('svg')).not.toBeNull();
    expect(disabledItem.querySelector('svg')).toBeNull();
    // Submenu entries are informational (inert).
    expect(enabledItem.getAttribute('aria-disabled')).toBe('true');
    expect(disabledItem.getAttribute('aria-disabled')).toBe('true');

    // Opening the flyout does not close the menu (informational, not an action).
    expect(screen.queryByText('Delete agent')).toBeTruthy();
  });

  it('renders the version verbatim (no reformatting)', async () => {
    seedSession({ harnessVersion: '2.3' });
    renderTab();
    await openPanelActionsMenu();

    expect(await screen.findByText('Harness v2.3')).toBeTruthy();
  });

  it('omits the item entirely when the session has no harnessVersion (older daemon)', async () => {
    seedSession();
    renderTab();
    await openPanelActionsMenu();

    // Menu is open (Delete agent present) but no harness entry.
    expect(await screen.findByText('Delete agent')).toBeTruthy();
    expect(screen.queryByText(/^Harness v/)).toBeNull();
  });

  it('does not close the menu when the disabled item is clicked', async () => {
    seedSession({ harnessVersion: '1.0' });
    renderTab();
    await openPanelActionsMenu();

    const item = await screen.findByText('Harness v1.0');
    await fireEvent.click(item);

    // Still rendered: a disabled menu item is inert.
    await waitFor(() => {
      expect(screen.queryByText('Harness v1.0')).toBeTruthy();
      expect(screen.queryByText('Delete agent')).toBeTruthy();
    });
  });
});
