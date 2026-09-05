/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { store as appStore } from '$store/renderer/store';
import {
  closePanel,
  setHoveredItem,
  setWorkspaceCreationActive,
  togglePanel,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import SidebarNavHarness from './__tests__/mocks/SidebarNavHarness.svelte';

describe('SidebarNav unified Spaces control', () => {
  function resetNavState() {
    appStore.dispatch(setWorkspaceCreationActive(false));
    appStore.dispatch(closePanel());
    appStore.dispatch(setHoveredItem(null));
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
    const control = screen.getByRole('button', { name: 'Toggle sidebar' });

    await fireEvent.click(control, { detail });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(togglePanel('all-workspaces'));
  });

  it('does not expose or open a popup from hover, ArrowDown, or context menu', async () => {
    render(SidebarNavHarness);
    resetNavState();
    const dispatch = vi.spyOn(appStore, 'dispatch');
    const control = screen.getByRole('button', { name: 'Toggle sidebar' });

    await fireEvent.mouseEnter(control);
    await fireEvent.keyDown(control, { key: 'ArrowDown' });
    await fireEvent.contextMenu(control);

    expect(dispatch).not.toHaveBeenCalled();
    expect(appStore.state.sidebarNav.hoveredItem).toBeNull();
    expect(control.hasAttribute('aria-haspopup')).toBe(false);
    expect(control.hasAttribute('aria-expanded')).toBe(false);
    expect(control.hasAttribute('aria-controls')).toBe(false);
    expect(document.querySelector('.sidebar-hover-card')).toBeNull();
  });

  it('renders one 16px dandelion in a 20px optical box and a 32px active target', async () => {
    const { container } = render(SidebarNavHarness);
    resetNavState();
    appStore.dispatch(togglePanel('all-workspaces'));
    await tick();
    const control = screen.getByRole('button', { name: 'Toggle sidebar' });
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
    const control = screen.getByRole('button', { name: 'Toggle sidebar' });

    control.focus();
    await fireEvent.focus(control);
    const tooltip = await screen.findByRole('tooltip', { hidden: true });
    const shortcut = tooltip.querySelector<HTMLElement>('[data-tooltip-shortcut]');

    expect(screen.getAllByRole('tooltip', { hidden: true })).toHaveLength(1);
    expect(tooltip.textContent).toContain('Toggle sidebar');
    expect(shortcut?.textContent).toBe('Ctrl+O');
    expect(shortcut?.className).toContain('text-muted-foreground');
    expect(control.getAttribute('aria-describedby')).toBe(tooltip.id);
    expect(control.getAttribute('aria-label')).toBe('Toggle sidebar');
  });

  it('opens the same custom shortcut tooltip on pointer hover', async () => {
    render(SidebarNavHarness);
    resetNavState();
    const control = screen.getByRole('button', { name: 'Toggle sidebar' });

    await fireEvent.pointerMove(control, { pointerType: 'mouse' });
    const tooltip = await screen.findByRole('tooltip', { hidden: true });

    expect(screen.getAllByRole('tooltip', { hidden: true })).toHaveLength(1);
    expect(tooltip.querySelector('[data-tooltip-label]')?.textContent).toBe('Toggle sidebar');
    expect(tooltip.querySelector('[data-tooltip-shortcut]')?.textContent).toBe('Ctrl+O');
  });
});
