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

  it('marks the active category for assistive technology', () => {
    render(SettingsSidebarNav, {
      activeTab: 'setup',
      onSelect: vi.fn(),
      agentsNavigation: createSpecialistsNavigation(),
    });

    const setup = screen.getByRole('button', { name: 'Workspace setup' });
    expect(setup.getAttribute('aria-current')).toBe('page');
    expect(
      screen.getByRole('button', { name: 'Providers' }).getAttribute('aria-current'),
    ).toBeNull();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('selects a category when clicked', async () => {
    const onSelect = vi.fn();
    render(SettingsSidebarNav, {
      activeTab: 'providers',
      onSelect,
      agentsNavigation: createSpecialistsNavigation(),
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Agent defaults' }));

    expect(onSelect).toHaveBeenCalledWith('agent-behavior');
  });

  it.each([
    'display',
    'app-behavior',
    'input',
    'agent-behavior',
    'providers',
    'connections',
    'devices',
    'setup',
    'advanced',
  ] as const)('preserves selection through the %s tab identifier', async (id) => {
    const onSelect = vi.fn();
    const { container } = render(SettingsSidebarNav, {
      activeTab: id,
      onSelect,
      agentsNavigation: createSpecialistsNavigation(),
    });
    const button = container.querySelector(`[data-settings-tab="${id}"]`)!;
    expect(button.getAttribute('aria-current')).toBe('page');
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(button.getAttribute('data-state')).toBe('active');
    await fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith(id);
  });

  it('withholds hidden categories while keeping the rest navigable (collaborator, multiplayer w3)', () => {
    render(SettingsSidebarNav, {
      activeTab: 'display',
      onSelect: vi.fn(),
      agentsNavigation: createSpecialistsNavigation(),
      hiddenTabs: ['providers', 'connections'],
    });

    expect(screen.queryByRole('button', { name: 'Providers' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Connections' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Workspace setup' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Agent defaults' })).toBeTruthy();
  });

  it('delegates specialist navigation without making the section heading clickable', async () => {
    const onSelectSpecialist = vi.fn();
    const onSelect = vi.fn();
    render(SettingsSidebarNav, {
      activeTab: 'specialists',
      onSelect,
      agentsNavigation: createSpecialistsNavigation(onSelectSpecialist),
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Implementor' }));

    expect(onSelectSpecialist).toHaveBeenCalledWith('Implementor');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
