/**
 * @vitest-environment jsdom
 *
 * AgentTabType — read-only "Harness vX.Y" entry in the panel actions (⋯)
 * menu (PROTOCOL §5.5 `harnessVersion` / `harnessFeatures`; monorepo#2459).
 *
 * Mirrors AgentCard-harness-version.test.ts for the tab menu: renders the
 * agentActions snippet through the real panel-header context and real Menu
 * components, and asserts the item's visibility, that selecting it opens
 * the read-only harness-features modal, and that legacy/absent shapes
 * render sensibly.
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
    panels: {} as Record<string, any>,
    hiddenTabs: [] as any[],
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
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => {
  const readable = (getter: () => unknown) => ({
    subscribe: (run: (value: unknown) => void) => (run(getter()), () => {}),
  });
  const selectPanels = () => readable(() => mockState.panels);
  selectPanels.select = () => mockState.panels;
  const selectHiddenTabs = () => readable(() => mockState.hiddenTabs);
  selectHiddenTabs.select = () => mockState.hiddenTabs;
  return { selectPanels, selectHiddenTabs };
});
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
  selectSpecialistName: {
    select: (_state: unknown, id: string) => (id === 'implementor' ? 'Implementor' : undefined),
  },
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

  it('opens the harness-features modal when clicked (features snapshot present)', async () => {
    seedSession({
      harnessVersion: '1.0',
      harnessFeatures: { structuredQuestions: true, taskGraph: false },
    });
    renderTab();
    await openPanelActionsMenu();

    const item = await screen.findByText('Harness v1.0');
    const menuItem = item.closest('[role="menuitem"]');
    expect(menuItem).not.toBeNull();
    // Enabled, plain command item (no flyout).
    expect(menuItem!.getAttribute('aria-disabled')).not.toBe('true');
    expect(menuItem!.getAttribute('aria-haspopup')).not.toBe('menu');

    await fireEvent.click(menuItem!);

    const dialog = await screen.findByRole('dialog', { name: 'Harness v1.0' });
    expect(dialog).toBeTruthy();
    // Settings-page labels, not raw keys; snapshot value wins.
    const list = dialog.querySelector('[data-testid="harness-features-list"]')!;
    expect(list).not.toBeNull();
    expect(screen.getByText('Structured questions')).toBeTruthy();
    const states = Array.from(
      dialog.querySelectorAll('[data-testid="harness-feature-state"]'),
    ) as HTMLElement[];
    const stateFor = (key: string) => states.find((el) => el.dataset.feature === key);
    expect(stateFor('structuredQuestions')!.dataset.enabled).toBe('true');
    expect(stateFor('taskGraph')!.dataset.enabled).toBe('false');
    // Catalog keys absent from the snapshot render OFF.
    expect(stateFor('backgroundHooks')!.dataset.enabled).toBe('false');
  });

  it('opens the modal for a legacy session without a features snapshot (all OFF)', async () => {
    seedSession({ harnessVersion: '1.0' });
    renderTab();
    await openPanelActionsMenu();

    const item = await screen.findByText('Harness v1.0');
    const menuItem = item.closest('[role="menuitem"]');
    expect(menuItem!.getAttribute('aria-disabled')).not.toBe('true');
    await fireEvent.click(menuItem!);

    const dialog = await screen.findByRole('dialog', { name: 'Harness v1.0' });
    const states = Array.from(
      dialog.querySelectorAll('[data-testid="harness-feature-state"]'),
    ) as HTMLElement[];
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((el) => el.dataset.enabled === 'false')).toBe(true);
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

  it('dismisses the modal with Escape', async () => {
    seedSession({ harnessVersion: '1.0', harnessFeatures: { structuredQuestions: true } });
    renderTab();
    await openPanelActionsMenu();

    await fireEvent.click(await screen.findByText('Harness v1.0'));
    const dialog = await screen.findByRole('dialog', { name: 'Harness v1.0' });

    await fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('AgentTabType specialist panel-actions menu item', () => {
  // The harness and the embedded view-settings snippet render their own
  // separators above the actions, so count only separators after Delete —
  // i.e. the info section's shared separator.
  function separatorsAfterDelete(): number {
    const menu = screen.getByRole('menu');
    const deleteItem = screen.getByText('Delete agent').closest('[role="menuitem"]')!;
    return Array.from(menu.querySelectorAll('[data-slot="menu-separator"]')).filter(
      (sep) => deleteItem.compareDocumentPosition(sep) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).length;
  }

  beforeEach(() => {
    mockState.dispatch.mockClear();
    mockState.agents.set({});
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('renders a disabled info item before the harness entry, with one shared separator', async () => {
    seedSession({ harnessVersion: '1.0', metadata: { specialist: 'implementor' } });
    renderTab();
    await openPanelActionsMenu();

    const item = await screen.findByText('Specialist: Implementor');
    const menuItem = item.closest('[role="menuitem"]');
    expect(menuItem).not.toBeNull();
    // Read-only informational entry: disabled, no flyout.
    expect(menuItem!.getAttribute('aria-disabled')).toBe('true');
    expect(menuItem!.getAttribute('aria-haspopup')).not.toBe('menu');

    // Specialist precedes the harness version entry (AgentCard ordering).
    const harnessItem = screen.getByText('Harness v1.0').closest('[role="menuitem"]');
    expect(
      menuItem!.compareDocumentPosition(harnessItem!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Single shared separator for the info section, no double separator.
    expect(separatorsAfterDelete()).toBe(1);
  });

  it('shows the item (and the separator) when only the specialist is present', async () => {
    seedSession({ metadata: { specialist: 'implementor' } });
    renderTab();
    await openPanelActionsMenu();

    expect(await screen.findByText('Specialist: Implementor')).toBeTruthy();
    expect(screen.queryByText(/^Harness v/)).toBeNull();
    expect(separatorsAfterDelete()).toBe(1);
  });

  it('falls back to the raw specialist id when the display-name lookup misses (AgentCard parity)', async () => {
    seedSession({ metadata: { specialist: 'mystery-specialist' } });
    renderTab();
    await openPanelActionsMenu();

    const item = await screen.findByText('Specialist: mystery-specialist');
    const menuItem = item.closest('[role="menuitem"]');
    expect(menuItem).not.toBeNull();
    expect(menuItem!.getAttribute('aria-disabled')).toBe('true');
  });

  it('omits the item entirely when the agent has no specialist', async () => {
    seedSession({ harnessVersion: '1.0' });
    renderTab();
    await openPanelActionsMenu();

    expect(await screen.findByText('Harness v1.0')).toBeTruthy();
    expect(screen.queryByText(/^Specialist:/)).toBeNull();
  });

  it('omits the item and the separator when neither specialist nor harness version exists', async () => {
    seedSession();
    renderTab();
    await openPanelActionsMenu();

    expect(await screen.findByText('Delete agent')).toBeTruthy();
    expect(screen.queryByText(/^Specialist:/)).toBeNull();
    expect(separatorsAfterDelete()).toBe(0);
  });
});

describe('AgentTabType primary header actions', () => {
  beforeEach(() => {
    seedSession();
    mockState.panels = {
      browser: {
        id: 'browser',
        activeTabId: 'browser-1',
        tabs: [
          {
            id: 'browser-1',
            type: 'browser',
            title: 'Docs',
            ownerAgentId: 'agent-1',
            closable: true,
          },
        ],
      },
    };
    mockState.hiddenTabs = [];
  });

  afterEach(() => {
    cleanup();
    mockState.panels = {};
    mockState.hiddenTabs = [];
  });

  it('renders browser tabs before the message navigator in the primary actions', async () => {
    render(MockTabTypeHeaderHarness, {
      props: {
        component: AgentTabType,
        tab: { id: 'tab-1', type: 'agent', title: 'Agent', agentId: 'agent-1' },
        workspaceId: 'ws-1',
        isActive: true,
        renderPrimary: true,
      },
    });

    const primary = await screen.findByTestId('header-primary-actions');
    const browserTabs = await screen.findByTestId('browser-tabs-trigger');
    const navigator = await screen.findByTestId('chat-header-navigation-controls');
    expect(primary.contains(browserTabs)).toBe(true);
    expect(primary.contains(navigator)).toBe(true);
    expect(
      browserTabs.compareDocumentPosition(navigator) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
