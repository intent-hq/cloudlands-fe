/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import CatalogFixtureList from './CatalogFixtureList.svelte';
import CatalogShell from './CatalogShell.svelte';
import { getCatalogEntry } from './catalog';

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.className = '';
});

function renderEntry(slug: string) {
  const entry = getCatalogEntry(slug);
  expect(entry).toBeDefined();
  return render(CatalogFixtureList, { props: { entry: entry! } });
}

describe('CatalogFixtureList real previews', () => {
  it('applies catalog theme and reduced motion at document root and restores prior classes', async () => {
    document.documentElement.classList.add('light');
    const { unmount } = render(CatalogShell);
    await fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    await fireEvent.click(screen.getByRole('switch', { name: 'Reduce motion' }));

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.classList.contains('catalog-reduced-motion')).toBe(true);
    });
    unmount();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('catalog-reduced-motion')).toBe(false);
  });

  it('mounts and operates the canonical Button renderer', async () => {
    const { container } = renderEntry('button');

    expect(container.querySelectorAll('[data-catalog-preview="button"]')).toHaveLength(2);
    await fireEvent.click(screen.getByRole('button', { name: 'Run action' }));
    expect(screen.getByLabelText('Button click count').textContent).toBe('1');
    expect(screen.getByLabelText('Button action status').textContent).toBe('Run action completed');

    for (const [name, status] of [
      ['Secondary', 'Secondary action completed'],
      ['Outline', 'Outline action completed'],
      ['Delete', 'Delete requested'],
      ['Add item', 'Item added'],
    ] as const) {
      await fireEvent.click(screen.getByRole('button', { name }));
      expect(screen.getByLabelText('Button action status').textContent).toBe(status);
    }
    expect(screen.getByLabelText('Button click count').textContent).toBe('5');

    await fireEvent.click(screen.getByRole('button', { name: 'Disabled action' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Loading action' }));
    expect(screen.getByLabelText('Button click count').textContent).toBe('5');
    expect(screen.getByRole('button', { name: 'Loading action' }).getAttribute('aria-busy')).toBe(
      'true',
    );

    await fireEvent.click(
      screen.getByRole('button', {
        name: 'A long button label that remains readable in compact layouts',
      }),
    );
    expect(screen.getByLabelText('Long button action status').textContent).toBe(
      'Long-label action completed',
    );
  });

  it('keeps machine-readable fixture state out of the visual preview', () => {
    const checkboxRender = renderEntry('checkbox');
    expect(screen.getByText('Selection required').className).toContain('text-danger');
    checkboxRender.unmount();

    const toggleGroupRender = renderEntry('toggle-group');
    expect(screen.getByLabelText('Display mode value').className).toContain('sr-only');
    toggleGroupRender.unmount();
  });

  it('renders truthful Combobox open, multi-select, size, and long-list states', () => {
    const { container } = renderEntry('combobox');

    const open = screen.getByRole('combobox', { name: 'Open catalog combobox' });
    expect(open.getAttribute('aria-expanded')).toBe('true');
    const openState = container.querySelector('[data-catalog-state="combobox-open"]');
    expect(within(openState as HTMLElement).getAllByRole('option')).toHaveLength(3);

    const multi = screen.getByRole('combobox', { name: 'Multi-select catalog combobox' });
    expect((multi as HTMLInputElement).value).toBe('Ada Lovelace, Grace Hopper');
    expect(screen.getByLabelText('Multi-select combobox value').textContent).toBe(
      '["ada","grace"]',
    );
    expect(screen.getByLabelText('Multi-select combobox value').className).toContain('sr-only');

    expect(screen.getByRole('combobox', { name: 'Compact catalog combobox' }).className).toContain(
      'h-(--control-height-small)',
    );
    expect(screen.getByRole('combobox', { name: 'Medium catalog combobox' }).className).toContain(
      'h-(--control-height-medium)',
    );
    expect(screen.getByRole('combobox', { name: 'Large catalog combobox' }).className).toContain(
      'h-(--control-height-large)',
    );

    const longList = screen.getByRole('combobox', { name: 'Long-list catalog combobox' });
    expect(longList.getAttribute('aria-expanded')).toBe('true');
    const longState = container.querySelector('[data-catalog-state="combobox-long-list"]');
    expect(within(longState as HTMLElement).getAllByRole('option')).toHaveLength(18);
    expect(longState?.querySelector('.overflow-y-auto')).not.toBeNull();
  });

  it('renders truthful Select open, size, and long-list states', () => {
    const { container } = renderEntry('select');

    const open = screen.getByRole('button', { name: 'Open catalog select' });
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(open.textContent).toContain('Apple');
    const openState = container.querySelector('[data-catalog-state="select-open"]');
    const closedState = container.querySelector('[data-catalog-rendered-state~="closed"]');
    expect(closedState?.className).toContain('z-20');
    expect(openState?.className).toContain('z-10');
    const openListbox = within(openState as HTMLElement).getByRole('listbox');
    expect(within(openListbox).getAllByRole('option')).toHaveLength(3);
    expect(
      openListbox.querySelector('[role="option"][aria-selected="true"]')?.textContent,
    ).toContain('Apple');
    expect(screen.getByLabelText('Select value').className).toContain('sr-only');

    expect(screen.getByRole('button', { name: 'Compact catalog select' }).className).toContain(
      'h-(--control-height-small)',
    );
    expect(screen.getByRole('button', { name: 'Compact catalog select' }).textContent).toContain(
      'Apple',
    );
    expect(screen.getByRole('button', { name: 'Medium catalog select' }).className).toContain(
      'h-(--control-height-medium)',
    );
    expect(screen.getByRole('button', { name: 'Large catalog select' }).className).toContain(
      'h-(--control-height-large)',
    );

    const longList = screen.getByRole('button', { name: 'Long-list catalog select' });
    expect(longList.getAttribute('aria-expanded')).toBe('true');
    const longState = container.querySelector('[data-catalog-state="select-long-list"]');
    expect(within(longState as HTMLElement).getAllByRole('option')).toHaveLength(18);
    expect(longState?.querySelector('.overflow-y-auto')).not.toBeNull();
  });

  it('opens and dismisses the canonical Dialog preview', async () => {
    renderEntry('dialog');
    const trigger = screen.getByRole('button', { name: 'Open catalog dialog' });

    await fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Catalog dialog' })).not.toBeNull();
    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Catalog dialog' })).toBeNull();
  });

  it('keeps collapsed Sidebar navigation recognizable with icons', () => {
    const { container } = renderEntry('sidebar');

    expect(screen.getByRole('button', { name: 'Catalog overview' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unavailable catalog page' })).toBeTruthy();
    expect(container.querySelectorAll('[data-catalog-sidebar-icon]')).toHaveLength(2);
  });

  it('mounts the daemon-free subscription row catalog', async () => {
    const { container } = renderEntry('subscription-rows');
    await waitFor(() => {
      expect(container.querySelector('[data-testid="subscription-rows-preview"]')).toBeTruthy();
    });
    expect(
      container.querySelectorAll('[data-testid="event-subscriptions-card"]').length,
    ).toBeGreaterThan(20);
    expect(container.querySelector('[data-testid="delegation-group-section"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="agent-message-disclosure-header"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="hook-wake-attribution"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="pr-monitor-wake-attribution"]')).toBeTruthy();
    await waitFor(() => {
      const expandedDelegations = container.querySelectorAll(
        '[data-catalog-delegation-state="expanded"]',
      );
      expect(expandedDelegations.length).toBeGreaterThan(0);
      for (const specimen of expandedDelegations) {
        expect(specimen.querySelector('[data-testid="delegation-group-agent-list"]')).toBeTruthy();
      }
    });
  });

  it('mounts and operates the canonical Settings Slider and FileInput previews', async () => {
    const sliderRender = renderEntry('slider');
    const slider = screen.getByRole('slider', { name: 'Catalog volume' });
    await fireEvent.input(slider, { target: { value: '52' } });
    expect(screen.getByLabelText('Catalog slider value').textContent).toBe('52');
    expect(screen.getByLabelText('Catalog slider value').className).toContain('sr-only');
    sliderRender.unmount();

    const fileRender = renderEntry('file-input');
    const input = fileRender.container.querySelector('#catalog-theme-file') as HTMLInputElement;
    const file = new File(['{}'], 'catalog-theme.json', { type: 'application/json' });
    await fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getAllByRole('status')[0].textContent).toContain('catalog-theme.json');
  });

  it('mounts each canonical Settings presentation pattern', () => {
    const page = renderEntry('settings-page-shell');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Application settings' }).length).toBe(
      2,
    );
    page.unmount();
    const section = renderEntry('settings-section');
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeTruthy();
    section.unmount();
    renderEntry('settings-field-row');
    expect(screen.getByLabelText('Notification volume')).toBeTruthy();
  });
});
