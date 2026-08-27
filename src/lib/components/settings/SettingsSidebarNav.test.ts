/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsSidebarNav from './SettingsSidebarNav.svelte';

describe('SettingsSidebarNav', () => {
  afterEach(cleanup);

  function createSpecialistsNavigation(onSelect = vi.fn()) {
    return createRawSnippet(() => ({
      render: () =>
        '<div><button type="button">Implementor</button><button type="button">Create Specialist</button></div>',
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
      activeTab: 'setup',
      onSelect: vi.fn(),
      agentsNavigation: createSpecialistsNavigation(),
    });

    const specialistsHeading = screen.getByRole('heading', { level: 2, name: 'Specialists' });
    expect(specialistsHeading.className).toContain('type-caption');
    expect(specialistsHeading.className).toContain('font-semibold');
    expect(specialistsHeading.className).toContain('uppercase');
    expect(specialistsHeading.className).toContain('tracking-wider');
    expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      'Display',
      'App Behavior',
      'Agent Behavior',
      'Providers',
      'Connections',
      'Setup',
      'Input',
      'Advanced',
      'Implementor',
      'Create Specialist',
    ]);
    expect(screen.getByRole('button', { name: 'Display' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Agent Behavior' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Providers' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connections' })).toBeTruthy();
    const setup = screen.getByRole('button', { name: 'Setup' });
    expect(setup.getAttribute('aria-current')).toBe('page');
    expect(setup.className).toContain('bg-muted');
    expect(setup.className).toContain('shadow-xs');
    const advanced = screen.getByRole('button', { name: 'Advanced' });
    expect(screen.queryByRole('button', { name: 'Specialists' })).toBeNull();
    const specialistsSection = container.querySelector('[data-settings-specialists-section]')!;
    expect(advanced.nextElementSibling).toBe(specialistsSection);
    expect(specialistsSection.firstElementChild).toBe(specialistsHeading);
    expect(specialistsSection.className).toContain('mt-8');
    expect(specialistsSection.className).not.toMatch(/border|pt-/);
  });

  it('selects a category when clicked', async () => {
    const onSelect = vi.fn();
    render(SettingsSidebarNav, {
      activeTab: 'providers',
      onSelect,
      agentsNavigation: createSpecialistsNavigation(),
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Agent Behavior' }));

    expect(onSelect).toHaveBeenCalledWith('agent-behavior');
  });

  it('renders a non-clickable Specialists heading above flat specialist navigation rows', async () => {
    const onSelectSpecialist = vi.fn();
    const { container } = render(SettingsSidebarNav, {
      activeTab: 'specialists',
      onSelect: vi.fn(),
      agentsNavigation: createSpecialistsNavigation(onSelectSpecialist),
    });

    expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      'Display',
      'App Behavior',
      'Agent Behavior',
      'Providers',
      'Connections',
      'Setup',
      'Input',
      'Advanced',
      'Implementor',
      'Create Specialist',
    ]);
    expect(screen.getByRole('heading', { level: 2, name: 'Specialists' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Specialists' })).toBeNull();
    expect(container.querySelector('[data-settings-agents-submenu]')).toBeNull();
    const specialistsSection = container.querySelector('[data-settings-specialists-section]')!;
    expect(specialistsSection.className).toContain('mt-8');
    expect(specialistsSection.className).not.toMatch(/border|ml-|p[lt]-/);

    await fireEvent.click(screen.getByRole('button', { name: 'Implementor' }));

    expect(onSelectSpecialist).toHaveBeenCalledWith('Implementor');
  });

  it('keeps flat specialist navigation visible while a different category is active', () => {
    const { container } = render(SettingsSidebarNav, {
      activeTab: 'providers',
      onSelect: vi.fn(),
      agentsNavigation: createSpecialistsNavigation(),
    });

    expect(container.querySelector('[data-settings-agents-section]')).not.toBeNull();
    expect(container.querySelector('[data-settings-agents-submenu]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Implementor' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Specialist' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Providers' }).className).toContain('shadow-xs');
  });

  it('uses larger icons in a fixed column without changing row geometry', () => {
    const { container } = render(SettingsSidebarNav, {
      activeTab: 'setup',
      onSelect: vi.fn(),
      agentsNavigation: createSpecialistsNavigation(),
    });
    const buttons = [...container.querySelectorAll('[data-settings-tab]')];
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
