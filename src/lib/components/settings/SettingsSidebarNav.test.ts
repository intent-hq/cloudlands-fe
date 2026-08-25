/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsSidebarNav from './SettingsSidebarNav.svelte';

describe('SettingsSidebarNav', () => {
  afterEach(cleanup);

  function createAgentsNavigation(onSelect = vi.fn()) {
    return createRawSnippet(() => ({
      render: () =>
        '<div><button type="button">All agents</button><button type="button">Implementor</button><button type="button">Create Specialist</button></div>',
      setup: (element) => {
        const handleClick = (event: Event) => {
          onSelect((event.target as HTMLButtonElement).textContent);
        };
        element.addEventListener('click', handleClick);
        return () => element.removeEventListener('click', handleClick);
      },
    }));
  }

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
    const tools = screen.getByRole('button', { name: 'Tools' });
    expect(tools.getAttribute('aria-current')).toBe('page');
    expect(tools.className).toContain('bg-muted');
    expect(tools.className).toContain('shadow-xs');
    expect(screen.getByRole('button', { name: 'Advanced' })).toBeTruthy();
  });

  it('selects a category when clicked', async () => {
    const onSelect = vi.fn();
    render(SettingsSidebarNav, { activeTab: 'providers', onSelect });

    await fireEvent.click(screen.getByRole('button', { name: 'Agents' }));

    expect(onSelect).toHaveBeenCalledWith('agents');
  });

  it('nests agent navigation directly below the active Agents category', async () => {
    const onSelectAgent = vi.fn();
    const { container } = render(SettingsSidebarNav, {
      activeTab: 'agents',
      onSelect: vi.fn(),
      agentsNavigation: createAgentsNavigation(onSelectAgent),
    });

    expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      'General',
      'Appearance',
      'Providers',
      'Agents',
      'All agents',
      'Implementor',
      'Create Specialist',
      'Connections',
      'Git & Workspace',
      'Tools',
      'Advanced',
    ]);
    expect(container.querySelector('[data-settings-agents-submenu]')?.className).toContain('ml-5');
    const agents = screen.getByRole('button', { name: 'Agents' });
    expect(agents.getAttribute('aria-current')).toBe('page');
    expect(agents.className).not.toContain('bg-muted font-medium');
    expect(agents.className).not.toContain('shadow-xs');
    expect(agents.querySelector('[data-slot="settings-sidebar-icon"] svg')).not.toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Implementor' }));

    expect(onSelectAgent).toHaveBeenCalledWith('Implementor');
  });

  it('hides agent navigation while a different settings category is active', () => {
    const { container } = render(SettingsSidebarNav, {
      activeTab: 'providers',
      onSelect: vi.fn(),
      agentsNavigation: createAgentsNavigation(),
    });

    expect(container.querySelector('[data-settings-agents-submenu]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'All agents' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create Specialist' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Providers' }).className).toContain('shadow-xs');
  });

  it('keeps the Agents category highlighted when it has no expanded submenu', () => {
    render(SettingsSidebarNav, { activeTab: 'agents', onSelect: vi.fn() });

    const agents = screen.getByRole('button', { name: 'Agents' });
    expect(agents.getAttribute('aria-current')).toBe('page');
    expect(agents.className).toContain('bg-muted');
    expect(agents.className).toContain('shadow-xs');
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
