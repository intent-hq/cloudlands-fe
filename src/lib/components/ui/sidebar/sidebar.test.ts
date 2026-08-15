// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import SidebarHarness from './SidebarHarness.svelte';
import { sidebarFixtures } from './sidebar.fixtures';
import * as sidebarApi from './index';
import { m } from '$shared/paraglide/messages.js';

const originalMatchMedia = window.matchMedia;

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((media: string) => ({
      matches,
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
  document.cookie = 'sidebar:state=; max-age=0; path=/';
});

describe('Sidebar', () => {
  it('toggles collapsed desktop state through the public trigger and keyboard shortcut', async () => {
    stubMatchMedia(false);
    const { container } = render(SidebarHarness);
    const sidebar = container.querySelector('[data-slot="sidebar"][data-state]');
    expect(sidebar?.getAttribute('data-state')).toBe('collapsed');
    await fireEvent.click(screen.getByRole('button', { name: m.ui_sidebar_toggle_label() }));
    expect(sidebar?.getAttribute('data-state')).toBe('expanded');
    expect(screen.getByLabelText('Sidebar open state').textContent).toBe('true');
    await fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expect(sidebar?.getAttribute('data-state')).toBe('collapsed');
    expect(screen.getByLabelText('Sidebar open state').textContent).toBe('false');
  });

  it('exposes active, disabled, and selectable menu states through public menu APIs', async () => {
    stubMatchMedia(false);
    render(SidebarHarness, { props: { open: true } });
    const active = screen.getByRole('button', { name: 'Overview' });
    expect(active.getAttribute('data-active')).toBe('true');
    expect(active.className).toContain('type-body');
    expect(active.className).toContain('rounded-md');
    expect(active.className).toContain('data-[active=true]:bg-sidebar-accent');
    expect(active.className).toContain('motion-reduce:transition-none');
    await fireEvent.click(active);
    expect(screen.getByLabelText('Sidebar menu selections').textContent).toBe('1');
    expect(
      (screen.getByRole('button', { name: 'Disabled navigation' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('opens and dismisses the responsive mobile sheet through the public trigger', async () => {
    stubMatchMedia(true);
    render(SidebarHarness);
    expect(screen.queryByRole('dialog', { name: 'Sidebar' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: m.ui_sidebar_toggle_label() }));
    expect(await screen.findByRole('dialog', { name: 'Sidebar' })).not.toBeNull();
    await fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sidebar' })).toBeNull());
  });

  it('publishes a host-independent pattern classification and complete public barrel', () => {
    expect(() => parseUiComponentMetadata(sidebarApi.sidebarMetadata)).not.toThrow();
    expect(sidebarApi.sidebarMetadata.category).toBe('pattern');
    expect(sidebarApi.sidebarMetadata.callers).toEqual(
      expect.arrayContaining(['src/lib/components/file-explorer/file-explorer-sidebar.svelte']),
    );
    expect(sidebarFixtures[0].states).toEqual(
      expect.arrayContaining(['collapsed', 'mobile-open', 'active-menu-item', 'keyboard-shortcut']),
    );
    expect(Object.keys(sidebarApi).sort()).toEqual([...sidebarApi.sidebarMetadata.exports].sort());
  });
});
