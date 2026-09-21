import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { m } from '$shared/paraglide/messages.js';
import { store as appStore } from '$store/renderer/store';
import {
  closePanel,
  openPanel,
  setShowCreateModal,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import SidebarPanelHarness from './mocks/SidebarPanelHarness.svelte';

vi.mock('$lib/components/layout/sidebar-nav/cards/AllWorkspacesCard.svelte', async () => ({
  default: (await import('./mocks/MockSidebarTabContent.svelte')).default,
}));
vi.mock('$lib/components/layout/sidebar-nav/cards/ChiefCard.svelte', async () => ({
  default: (await import('./mocks/MockSidebarTabContent.svelte')).default,
}));
vi.mock('$lib/components/layout/sidebar-nav/cards/ActiveWorkspacesCard.svelte', async () => ({
  default: (await import('./mocks/MockHoverCardContent.svelte')).default,
}));
vi.mock('$lib/components/layout/sidebar-nav/cards/SettingsCard.svelte', async () => ({
  default: (await import('./mocks/MockHoverCardContent.svelte')).default,
}));

function renderPanel(item: 'all-workspaces' | 'chief' = 'all-workspaces') {
  return render(SidebarPanelHarness, { setup: () => appStore.dispatch(openPanel(item)) });
}

describe('Sidebar workspace and Intent tabs', () => {
  beforeEach(() => appStore.init());
  afterEach(() => {
    cleanup();
    appStore.dispatch(closePanel());
    appStore.dispatch(setShowCreateModal(false));
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('switches destinations without closing the sidebar and links tabs to panels', async () => {
    renderPanel();
    const workspaces = screen.getByRole('tab', {
      name: m.layout_sidebarPanel_workspacesTab_label(),
    });
    const intent = screen.getByRole('tab', { name: m.layout_chiefCard_title() });
    expect(workspaces.getAttribute('aria-selected')).toBe('true');

    await fireEvent.click(intent);
    expect(appStore.state.sidebarNav.panelItem).toBe('chief');
    expect(intent.getAttribute('aria-selected')).toBe('true');
    const panel = screen.getByRole('tabpanel');
    expect(panel.id).toBe(intent.getAttribute('aria-controls'));
    expect(panel.getAttribute('aria-labelledby')).toBe(intent.id);

    await fireEvent.click(workspaces);
    expect(appStore.state.sidebarNav.panelItem).toBe('all-workspaces');
    expect(workspaces.getAttribute('aria-selected')).toBe('true');
  });

  it('keeps pane interactivity in sync with selection before the Redux frame arrives', async () => {
    renderPanel();
    await tick();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);

    const workspaces = screen.getByRole('tab', {
      name: m.layout_sidebarPanel_workspacesTab_label(),
    });
    const intent = screen.getByRole('tab', { name: m.layout_chiefCard_title() });
    for (const tab of [intent, workspaces]) {
      await fireEvent.click(tab);
      expect(tab.getAttribute('aria-selected')).toBe('true');
      const activePanel = screen.getByRole('tabpanel');
      expect(activePanel.id).toBe(tab.getAttribute('aria-controls'));
      expect(activePanel.hasAttribute('inert')).toBe(false);
      const inactivePanel = screen
        .getAllByRole('tabpanel', { hidden: true })
        .find((panel) => panel !== activePanel)!;
      expect(inactivePanel.hasAttribute('hidden')).toBe(true);
      expect(inactivePanel.hasAttribute('inert')).toBe(true);
      expect(screen.getByTestId('intent-content').getAttribute('data-active')).toBe(
        String(tab === intent),
      );
    }
  });

  it('honors external Intent navigation and hides inactive content from interaction', async () => {
    const { container } = renderPanel();
    appStore.dispatch(openPanel('chief'));
    await waitFor(() =>
      expect(screen.getByRole('tab', { selected: true }).textContent).toContain(
        m.layout_chiefCard_title(),
      ),
    );
    const spaces = container.querySelector('[data-combined-panel-spaces]');
    expect(spaces?.hasAttribute('hidden')).toBe(true);
    expect(spaces?.hasAttribute('inert')).toBe(true);
    expect(screen.getByTestId('intent-content').getAttribute('data-active')).toBe('true');

    appStore.dispatch(closePanel());
    await waitFor(() =>
      expect(screen.getByTestId('intent-content').getAttribute('data-active')).toBe('false'),
    );
  });

  it('preserves each tab subtree and draft through switches and sidebar close/reopen', async () => {
    renderPanel();
    const workspaceInput = screen.getByRole('textbox', { name: 'Workspace search' });
    await fireEvent.input(workspaceInput, { target: { value: 'sidebar' } });
    await fireEvent.click(screen.getByRole('tab', { name: m.layout_chiefCard_title() }));
    const chatInput = screen.getByRole('textbox', { name: 'Chat draft' });
    await fireEvent.input(chatInput, { target: { value: 'Help me plan tomorrow' } });
    await fireEvent.click(
      screen.getByRole('tab', { name: m.layout_sidebarPanel_workspacesTab_label() }),
    );
    expect(screen.getByRole('textbox', { name: 'Workspace search' })).toBe(workspaceInput);
    expect((workspaceInput as HTMLInputElement).value).toBe('sidebar');
    expect(screen.getByTestId('intent-content').getAttribute('data-active')).toBe('false');

    appStore.dispatch(closePanel());
    await tick();
    appStore.dispatch(openPanel('chief'));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Chat draft' })).toBe(chatInput),
    );
    expect((chatInput as HTMLInputElement).value).toBe('Help me plan tomorrow');
  });

  it('retains workspace search and create actions within the workspace tab', async () => {
    renderPanel();
    await fireEvent.click(
      screen.getByRole('button', { name: m.layout_sidebarPanel_searchWorkspaces_ariaLabel() }),
    );
    expect(
      screen
        .getByRole('button', { name: m.layout_sidebarPanel_hideSearch_ariaLabel() })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    await fireEvent.click(
      screen.getByRole('button', { name: m.layout_sidebarNav_newWorkspace_title() }),
    );
    await waitFor(() => expect(appStore.state.sidebarNav.showCreateModal).toBe(true));
  });
});
