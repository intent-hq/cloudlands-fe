/**
 * The combined Spaces + Chief sidebar panel, rendered against the real store
 * with the workspace cards and the Chief chat mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { m } from '$shared/paraglide/messages.js';
import { store as appStore } from '$store/renderer/store';
import {
  closePanel,
  openPanel,
  setChiefCollapsed,
  setShowCreateModal,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import SidebarPanelHarness from './mocks/SidebarPanelHarness.svelte';

vi.mock('$lib/components/layout/sidebar-nav/cards/ActiveWorkspacesCard.svelte', async () => ({
  default: (await import('./mocks/MockHoverCardContent.svelte')).default,
}));
vi.mock('$lib/components/layout/sidebar-nav/cards/AllWorkspacesCard.svelte', async () => ({
  default: (await import('./mocks/MockHoverCardContent.svelte')).default,
}));
vi.mock('$lib/components/layout/sidebar-nav/cards/SettingsCard.svelte', async () => ({
  default: (await import('./mocks/MockHoverCardContent.svelte')).default,
}));
vi.mock('$lib/components/chat/ChatPanel.svelte', async () => ({
  default: (await import('./mocks/MockChiefChatPanel.svelte')).default,
}));

vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    fetchActiveStreams: vi.fn(),
    startPolling: vi.fn(),
    getStreamingAgentIdsForWorkspace: vi.fn(() => []),
    subscribe: vi.fn(() => () => {}),
  },
}));

vi.mock('$lib/electron-bridge', () => ({
  on: vi.fn(),
  off: vi.fn(),
  once: vi.fn(),
  invoke: vi.fn(),
  listenSync: vi.fn(),
}));

function renderPanel(item: 'chief' | 'settings' = 'chief') {
  return render(SidebarPanelHarness, {
    props: { setup: () => appStore.dispatch(openPanel(item)) },
  });
}

function closeButtons(root: ParentNode) {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].filter(
    (button) => button.getAttribute('aria-label') === m.layout_sidebarPanel_close_ariaLabel(),
  );
}

describe('All Workspaces panel presentation', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(setChiefCollapsed(false));
    appStore.dispatch(setShowCreateModal(false));
    global.ResizeObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    } as never;
    global.MutationObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn();
    } as never;
  });

  afterEach(() => {
    cleanup();
    appStore.dispatch(closePanel());
  });

  it('keeps Spaces and Chief mounted with the list height following the collapse state', async () => {
    const { container } = renderPanel();

    const spaces = container.querySelector<HTMLElement>('[data-combined-panel-spaces]')!;
    expect(spaces).not.toBeNull();
    expect(container.querySelectorAll('[data-combined-panel-chief]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-chief-header-row]')).toHaveLength(1);
    expect(spaces.style.height).toMatch(/%$/);

    appStore.dispatch(setChiefCollapsed(true));
    await waitFor(() => expect(spaces.style.height).toBe(''));

    expect(container.querySelectorAll('[data-combined-panel-chief]')).toHaveLength(1);
    expect(container.querySelector<HTMLElement>('#combined-panel-chief-content')?.hidden).toBe(
      true,
    );
    expect(appStore.state.sidebarNav.panelItem).toBe('chief');
  });

  it('offers a create-space action while the Spaces section is visible', async () => {
    const { container } = renderPanel();

    const create = container.querySelector<HTMLButtonElement>(
      '[data-combined-panel-spaces] [data-spaces-create]',
    )!;
    expect(create).not.toBeNull();
    expect(appStore.state.sidebarNav.showCreateModal).toBe(false);

    await fireEvent.click(create);

    expect(appStore.state.sidebarNav.showCreateModal).toBe(true);
  });

  it('omits close controls from the combined Spaces and Chief panel', async () => {
    const { container } = renderPanel();

    expect(closeButtons(container)).toHaveLength(0);
    expect(closeButtons(container.querySelector('[data-combined-panel-chief]')!)).toHaveLength(0);

    await fireEvent.click(
      container.querySelector<HTMLButtonElement>('[data-chief-section-toggle]')!,
    );
    expect(appStore.state.sidebarNav.panelItem).toBe('chief');
    expect(appStore.state.sidebarNav.isChiefCollapsed).toBe(true);
  });

  it('keeps the close control on non-combined panels', async () => {
    const { container } = renderPanel('settings');

    const [close] = closeButtons(container);
    expect(close).toBeDefined();
    expect(screen.getByRole('button', { name: m.layout_sidebarPanel_close_ariaLabel() })).toBe(
      close,
    );

    await fireEvent.click(close);

    expect(appStore.state.sidebarNav.panelItem).toBeNull();
  });
});
