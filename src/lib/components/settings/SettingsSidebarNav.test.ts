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

    const setup = screen.getByRole('button', { name: 'Setup' });
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

    await fireEvent.click(screen.getByRole('button', { name: 'Agent Behavior' }));

    expect(onSelect).toHaveBeenCalledWith('agent-behavior');
  });

  it('delegates specialist navigation without making the section heading clickable', async () => {
    const onSelectSpecialist = vi.fn();
    render(SettingsSidebarNav, {
      activeTab: 'specialists',
      onSelect: vi.fn(),
      agentsNavigation: createSpecialistsNavigation(onSelectSpecialist),
    });

    expect(screen.getByRole('heading', { level: 2, name: 'Specialists' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Specialists' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Implementor' }));

    expect(onSelectSpecialist).toHaveBeenCalledWith('Implementor');
  });
});
