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
    await fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith(id);
  });

  it('delegates specialist navigation without making the section heading clickable', async () => {
    const onSelectSpecialist = vi.fn();
    render(SettingsSidebarNav, {
      activeTab: 'specialists',
      onSelect: vi.fn(),
      agentsNavigation: createSpecialistsNavigation(onSelectSpecialist),
    });

    expect(screen.getByRole('heading', { level: 3, name: 'Specialists' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Specialists' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Implementor' }));

    expect(onSelectSpecialist).toHaveBeenCalledWith('Implementor');
  });
});
