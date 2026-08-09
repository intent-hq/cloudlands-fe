/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsSidebarNav from './SettingsSidebarNav.svelte';

describe('SettingsSidebarNav', () => {
  afterEach(cleanup);

  it('renders all settings categories and marks the active category', () => {
    render(SettingsSidebarNav, { activeTab: 'setup', onSelect: vi.fn() });

    expect(screen.getAllByRole('button')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Accounts' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Agents' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Workspace Setup' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(screen.getByRole('button', { name: 'Fonts & Colors' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'General' })).toBeTruthy();
  });

  it('selects a category when clicked', async () => {
    const onSelect = vi.fn();
    render(SettingsSidebarNav, { activeTab: 'accounts', onSelect });

    await fireEvent.click(screen.getByRole('button', { name: 'Agents' }));

    expect(onSelect).toHaveBeenCalledWith('agents');
  });
});
