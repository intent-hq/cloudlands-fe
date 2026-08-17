/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsSidebarNav from './SettingsSidebarNav.svelte';

describe('SettingsSidebarNav', () => {
  afterEach(cleanup);

  it('renders all settings categories and marks the active category', () => {
    render(SettingsSidebarNav, { activeTab: 'tools', onSelect: vi.fn() });

    expect(screen.queryAllByRole('heading')).toHaveLength(0);
    expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      'General',
      'Appearance',
      'Providers',
      'Agents',
      'Connections',
      'Git & Workspace',
      'Tools',
      'Advanced',
    ]);
    expect(screen.getByRole('button', { name: 'General' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Appearance' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Providers' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Agents' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connections' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Git & Workspace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tools' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Advanced' })).toBeTruthy();
  });

  it('selects a category when clicked', async () => {
    const onSelect = vi.fn();
    render(SettingsSidebarNav, { activeTab: 'providers', onSelect });

    await fireEvent.click(screen.getByRole('button', { name: 'Agents' }));

    expect(onSelect).toHaveBeenCalledWith('agents');
  });

  it('uses larger icons in a fixed column without changing row geometry', () => {
    const { container } = render(SettingsSidebarNav, { activeTab: 'tools', onSelect: vi.fn() });
    const buttons = screen.getAllByRole('button');
    const iconSlots = [...container.querySelectorAll('[data-slot="settings-sidebar-icon"]')];

    expect(iconSlots).toHaveLength(buttons.length);
    expect(buttons.every((button) => button.className.includes('py-2'))).toBe(true);
    expect(iconSlots.every((slot) => slot.className.includes('size-4'))).toBe(true);
    for (const icon of container.querySelectorAll('[data-slot="settings-sidebar-icon"] svg')) {
      expect(icon.getAttribute('width')).toBe('0.875em');
      expect(icon.getAttribute('height')).toBe('0.875em');
    }
  });
});
