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
        '<div><button type="button">All Agents</button><button type="button">Implementor</button><button type="button">Create Specialist</button></div>',
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
    const { container } = render(SettingsSidebarNav, {
      activeTab: 'system',
      onSelect: vi.fn(),
    });

    const agentsHeading = screen.getByRole('heading', { level: 2, name: 'Agents' });
    expect(agentsHeading.className).toContain('text-ui-sm');
    expect(agentsHeading.className).toContain('font-semibold');
    expect(agentsHeading.className).toContain('uppercase');
    expect(agentsHeading.className).toContain('tracking-wider');
    expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      'General',
      'Appearance',
      'Behavior',
      'Providers',
      'Connections',
      'System',
      'Advanced',
    ]);
    expect(screen.getByRole('button', { name: 'General' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Appearance' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Providers' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connections' })).toBeTruthy();
    const system = screen.getByRole('button', { name: 'System' });
    expect(system.getAttribute('aria-current')).toBe('page');
    expect(system.className).toContain('bg-muted');
    expect(system.className).toContain('shadow-xs');
    const advanced = screen.getByRole('button', { name: 'Advanced' });
    expect(screen.queryByRole('button', { name: 'Agents' })).toBeNull();
    const agentsSection = container.querySelector('[data-settings-agents-section]')!;
    expect(advanced.nextElementSibling).toBe(agentsSection);
    expect(agentsSection.firstElementChild).toBe(agentsHeading);
    expect(agentsSection.className).not.toMatch(/border|mt-|pt-/);
  });

  it('selects a category when clicked', async () => {
    const onSelect = vi.fn();
    render(SettingsSidebarNav, { activeTab: 'providers', onSelect });

    await fireEvent.click(screen.getByRole('button', { name: 'Behavior' }));

    expect(onSelect).toHaveBeenCalledWith('behavior');
  });

  it('renders a non-clickable Agents heading above flat agent navigation rows', async () => {
    const onSelectAgent = vi.fn();
    const { container } = render(SettingsSidebarNav, {
      activeTab: 'agents',
      onSelect: vi.fn(),
      agentsNavigation: createAgentsNavigation(onSelectAgent),
    });

    expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      'General',
      'Appearance',
      'Behavior',
      'Providers',
      'Connections',
      'System',
      'Advanced',
      'All Agents',
      'Implementor',
      'Create Specialist',
    ]);
    expect(screen.getByRole('heading', { level: 2, name: 'Agents' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Agents' })).toBeNull();
    expect(container.querySelector('[data-settings-agents-submenu]')).toBeNull();
    const agentsSection = container.querySelector('[data-settings-agents-section]')!;
    expect(agentsSection.className).not.toMatch(/border|m[lt]-|p[lt]-/);

    await fireEvent.click(screen.getByRole('button', { name: 'Implementor' }));

    expect(onSelectAgent).toHaveBeenCalledWith('Implementor');
  });

  it('keeps flat agent navigation visible while a different settings category is active', () => {
    const { container } = render(SettingsSidebarNav, {
      activeTab: 'providers',
      onSelect: vi.fn(),
      agentsNavigation: createAgentsNavigation(),
    });

    expect(container.querySelector('[data-settings-agents-section]')).not.toBeNull();
    expect(container.querySelector('[data-settings-agents-submenu]')).toBeNull();
    expect(screen.getByRole('button', { name: 'All Agents' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Implementor' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Specialist' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Providers' }).className).toContain('shadow-xs');
  });

  it('renders only the Agents heading when agent rows are not supplied', () => {
    render(SettingsSidebarNav, { activeTab: 'agents', onSelect: vi.fn() });

    expect(screen.getByRole('heading', { level: 2, name: 'Agents' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Agents' })).toBeNull();
  });

  it('uses larger icons in a fixed column without changing row geometry', () => {
    const { container } = render(SettingsSidebarNav, {
      activeTab: 'system',
      onSelect: vi.fn(),
    });
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
