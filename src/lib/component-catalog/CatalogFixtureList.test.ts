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
    await fireEvent.click(screen.getByRole('button', { name: '1. Primary' }));
    expect(screen.getByLabelText('Button click count').textContent).toBe('1');
    expect(screen.getByLabelText('Button action status').textContent).toBe(
      'Primary action completed',
    );

    for (const [name, status] of [
      ['2. Secondary', 'Secondary action completed'],
      ['3. Ghost', 'Ghost action completed'],
      ['4. Destructive', 'Delete requested'],
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

  it('distinguishes transient ButtonGroup activity from selection', () => {
    const { container } = renderEntry('button-group');

    const preview = container.querySelector('[data-catalog-preview="button-group"]');
    expect(preview).not.toBeNull();
    const groups = within(preview as HTMLElement).getAllByRole('group');
    expect(groups).toHaveLength(2);
    const activeButton = groups[1].querySelector('[data-state="active"]');
    expect(activeButton?.getAttribute('aria-expanded')).toBe('true');
    expect(activeButton?.hasAttribute('aria-pressed')).toBe(false);
    expect(
      (within(groups[0]).getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('keeps machine-readable fixture state out of the visual preview', () => {
    const checkboxRender = renderEntry('checkbox');
    expect(screen.getByText('Selection required').className).toContain('text-danger');
    checkboxRender.unmount();

    const toggleGroupRender = renderEntry('toggle-group');
    expect(screen.getByLabelText('Display mode value').className).toContain('sr-only');
    toggleGroupRender.unmount();
  });

  it('renders one-line Radio and selected Checkbox group row fixtures', () => {
    const radioRender = renderEntry('radio-group');
    const oneLineRadios = screen.getByRole('radiogroup', { name: 'One-line delivery speed' });
    expect(within(oneLineRadios).getAllByRole('radio')).toHaveLength(3);
    expect(
      within(oneLineRadios).getByRole('radio', { name: 'Standard' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(oneLineRadios.textContent).not.toContain('Balanced delivery');
    radioRender.unmount();

    const checkboxRender = renderEntry('checkbox-group');
    const selectedRows = screen.getByRole('group', { name: 'One-line notifications' });
    expect(within(selectedRows).getAllByRole('checkbox')).toHaveLength(3);
    expect(
      within(selectedRows).getByRole('checkbox', { name: 'Alerts' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(selectedRows.textContent).not.toContain('Important changes');
    checkboxRender.unmount();
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
    const { container } = renderEntry('dialog');
    const trigger = screen.getByRole('button', { name: 'Open catalog dialog' });

    await fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Catalog dialog' });
    expect(dialog.closest('[data-catalog-portal-target="dialog"]')).not.toBeNull();
    await fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Catalog dialog' })).toBeNull(),
    );
    expect(container.querySelector('[data-catalog-portal-target="dialog"]')).not.toBeNull();
  });

  it('mounts Dialog and Tooltip capture fixtures open and preserves trigger focus on close', async () => {
    const dialogRender = renderEntry('dialog');
    const dialogTrigger = screen.getByRole('button', { name: 'Open-state dialog trigger' });
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Catalog dialog open state' })).toBeTruthy(),
    );
    await fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Catalog dialog open state' })).toBeNull(),
    );
    expect(document.activeElement).toBe(dialogTrigger);
    dialogRender.unmount();

    const originalResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    const tooltipRender = renderEntry('tooltip');
    const tooltipFixture = tooltipRender.container.querySelector(
      '[data-catalog-fixture-id="tooltip-open-state"]',
    );
    if (!(tooltipFixture instanceof HTMLElement)) throw new Error('Tooltip fixture did not render');
    const tooltipPreview = within(tooltipFixture);
    const tooltipTrigger = tooltipPreview.getByRole('button', {
      name: 'Open-state tooltip trigger',
    });
    await waitFor(() => expect(tooltipPreview.getByRole('tooltip', { hidden: true })).toBeTruthy());
    expect(document.activeElement).toBe(tooltipTrigger);
    await fireEvent.keyDown(tooltipTrigger, { key: 'Escape' });
    await waitFor(() => expect(tooltipPreview.queryByRole('tooltip', { hidden: true })).toBeNull());
    expect(document.activeElement).toBe(tooltipTrigger);
    tooltipRender.unmount();
    window.ResizeObserver = originalResizeObserver;
  });

  it('renders all thirteen Toast catalog states', () => {
    const { container } = renderEntry('toast');
    expect(container.querySelectorAll('[data-toast-preview]')).toHaveLength(13);
  });

  it('operates the canonical Menu, Sheet, and Accordion previews', async () => {
    const menuRender = renderEntry('menu');
    const menuTrigger = screen.getByRole('button', { name: 'Open catalog menu' });
    menuTrigger.focus();
    await fireEvent.keyDown(menuTrigger, { key: 'ArrowDown' });
    const menu = await screen.findByRole('menu');
    expect(menu.closest('[data-catalog-portal-target="menu"]')).not.toBeNull();
    await fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    menuRender.unmount();

    const sheetRender = renderEntry('sheet');
    const sheetTrigger = screen.getByRole('button', { name: 'Open catalog sheet' });
    await fireEvent.click(sheetTrigger);
    const sheet = screen.getByRole('dialog', { name: 'Catalog sheet' });
    expect(sheet.closest('[data-catalog-portal-target="sheet"]')).not.toBeNull();
    await fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Catalog sheet' })).toBeNull());
    sheetRender.unmount();

    renderEntry('accordion');
    const details = screen.getByRole('button', { name: 'Details' });
    expect(details.getAttribute('aria-expanded')).toBe('true');
    await fireEvent.click(details);
    expect(details.getAttribute('aria-expanded')).toBe('false');
    details.focus();
    await fireEvent.keyDown(details, { key: 'Enter' });
    expect(details.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps Sidebar navigation operable from its collapsed state', async () => {
    const { container } = renderEntry('sidebar');
    const sidebar = container.querySelector('[data-slot="sidebar"][data-state]');

    expect(sidebar?.getAttribute('data-state')).toBe('collapsed');
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('data-active')).toBe(
      'true',
    );
    expect(
      (screen.getByRole('button', { name: 'Disabled navigation' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await fireEvent.click(container.querySelector<HTMLButtonElement>('[data-sidebar="trigger"]')!);
    expect(sidebar?.getAttribute('data-state')).toBe('expanded');
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
    expect(screen.getByRole('region', { name: 'Editorial Settings shell' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Busy Settings shell' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Editorial Settings shell general' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Busy Settings shell general' })).toBeTruthy();
    page.unmount();
    const section = renderEntry('settings-section');
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeTruthy();
    section.unmount();
    renderEntry('settings-field-row');
    expect(screen.getByLabelText('Notification volume')).toBeTruthy();
  });
});
