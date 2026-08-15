/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { store as appStore } from '$store/renderer/store';
import {
  closePanel,
  setExpandedItem,
  setHoveredItem,
  setOnboardingActive,
  togglePanel,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import SidebarNavHarness from './__tests__/mocks/SidebarNavHarness.svelte';

vi.mock('./SidebarNavHoverCard.svelte', async () => ({
  default: (await import('./__tests__/mocks/MockHoverCardContent.svelte')).default,
}));

describe('SidebarNav unified Spaces control', () => {
  function resetNavState() {
    appStore.dispatch(setOnboardingActive(false));
    appStore.dispatch(closePanel());
    appStore.dispatch(setHoveredItem(null));
    appStore.dispatch(setExpandedItem(null));
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ['pointer', 1],
    ['Enter or Space keyboard-generated', 0],
  ])('dispatches exactly one sidebar toggle for %s activation', async (_source, detail) => {
    render(SidebarNavHarness);
    resetNavState();
    const dispatch = vi.spyOn(appStore, 'dispatch');
    const control = screen.getByRole('button', { name: 'Toggle Spaces' });

    await fireEvent.click(control, { detail });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(togglePanel('all-workspaces'));
    expect(dispatch.mock.calls[0]?.[0].type).not.toBe('tabState/setWorkspaceViewMode');
  });

  it('opens the existing Spaces menu from pointer hover, ArrowDown, and context menu', async () => {
    render(SidebarNavHarness);
    resetNavState();
    const control = screen.getByRole('button', { name: 'Toggle Spaces' });

    await fireEvent.mouseEnter(control);
    await waitFor(() => {
      expect(appStore.state.sidebarNav.hoveredItem).toBe('all-workspaces');
      expect(control.getAttribute('aria-expanded')).toBe('true');
    });

    appStore.dispatch(setHoveredItem(null));
    await fireEvent.keyDown(control, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(appStore.state.sidebarNav.hoveredItem).toBe('all-workspaces');
      expect(control.getAttribute('aria-expanded')).toBe('true');
    });

    appStore.dispatch(setHoveredItem(null));
    await fireEvent.contextMenu(control);
    await waitFor(() => {
      expect(appStore.state.sidebarNav.hoveredItem).toBe('all-workspaces');
      expect(control.getAttribute('aria-expanded')).toBe('true');
    });
    expect(control.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('renders one 16px dandelion in a 20px optical box and a 32px active target', async () => {
    const { container } = render(SidebarNavHarness);
    resetNavState();
    appStore.dispatch(togglePanel('all-workspaces'));
    await tick();
    const control = screen.getByRole('button', { name: 'Toggle Spaces' });
    const dandelion = container.querySelector('[data-navigation-icon="dandelion"]');

    expect(container.querySelectorAll('[data-navigation-icon]')).toHaveLength(1);
    expect(container.querySelector('[data-navigation-icon="spaces"]')).toBeNull();
    expect(control.className).toContain('size-8');
    expect(control.className).toContain('text-foreground');
    expect(control.className).toContain('opacity-100');
    expect(control.className).toContain('titlebar-navigation-control');
    expect(getComputedStyle(control).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(control.className).toContain('focus-visible:ring-0');
    expect(control.className).not.toContain('focus-visible:ring-2');
    expect(control.className).not.toContain('shadow-xs');
    expect(control.hasAttribute('title')).toBe(false);
    expect(control.textContent?.trim()).toBe('');
    expect(dandelion?.parentElement?.className).toContain('size-5');
    expect(dandelion?.getAttribute('width')).toBe('16');
    expect(dandelion?.getAttribute('height')).toBe('16');
  });

  it('shows one accessible shortcut tooltip from keyboard focus', async () => {
    render(SidebarNavHarness);
    resetNavState();
    const control = screen.getByRole('button', { name: 'Toggle Spaces' });

    control.focus();
    await fireEvent.focus(control);
    const tooltip = await screen.findByRole('tooltip', { hidden: true });
    const shortcut = tooltip.querySelector<HTMLElement>('[data-tooltip-shortcut]');

    expect(screen.getAllByRole('tooltip', { hidden: true })).toHaveLength(1);
    expect(tooltip.textContent).toContain('Toggle Spaces');
    expect(shortcut?.textContent).toBe('Ctrl+O');
    expect(shortcut?.className).toContain('text-muted-foreground');
    expect(control.getAttribute('aria-describedby')).toBe(tooltip.id);
    expect(control.getAttribute('aria-label')).toBe('Toggle Spaces');
  });

  it('opens the same custom shortcut tooltip on pointer hover', async () => {
    render(SidebarNavHarness);
    resetNavState();
    const control = screen.getByRole('button', { name: 'Toggle Spaces' });

    await fireEvent.pointerMove(control, { pointerType: 'mouse' });
    const tooltip = await screen.findByRole('tooltip', { hidden: true });

    expect(screen.getAllByRole('tooltip', { hidden: true })).toHaveLength(1);
    expect(tooltip.querySelector('[data-tooltip-label]')?.textContent).toBe('Toggle Spaces');
    expect(tooltip.querySelector('[data-tooltip-shortcut]')?.textContent).toBe('Ctrl+O');
  });
});
