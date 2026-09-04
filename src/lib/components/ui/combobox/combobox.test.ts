import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildUiComponentInventory } from '../../../../../scripts/ui-component-inventory';
import { invalidControlContrastCases } from '../../../../../tests/helpers/invalid-control-contrast';
import ComboboxHarness from './combobox.test-harness.svelte';

describe('Combobox inventory', () => {
  it('owns the canonical pattern with every legacy searchable family barrel removed', () => {
    const inventory = buildUiComponentInventory();
    const canonical = inventory.components.find(
      (component) => component.publicImport === '$lib/components/ui/combobox',
    );
    expect(canonical).toMatchObject({ category: 'pattern', owner: '007-B6', replacement: null });
    expect(canonical?.source).toBeTruthy();

    for (const publicImport of [
      '$lib/components/ui/grouped-combobox',
      '$lib/components/ui/searchable-combobox',
      '$lib/components/ui/searchable-select',
    ]) {
      const legacy = inventory.components.find(
        (component) => component.publicImport === publicImport,
      );
      expect(legacy, publicImport).toBeUndefined();
    }
  });
});

describe('Combobox behavior', () => {
  afterEach(cleanup);

  it('tears down an open primitive without reading inert derived values', async () => {
    let warningStack = '';
    const warn = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      if (args.some((arg) => String(arg).includes('derived_inert'))) {
        warningStack = new Error('derived_inert').stack ?? '';
      }
    });
    try {
      render(ComboboxHarness);
      await fireEvent.focus(screen.getByRole('combobox', { name: 'Search people' }));
      cleanup();

      render(ComboboxHarness, { props: { multiple: true, value: ['ada'] } });
      await fireEvent.focus(screen.getByRole('combobox', { name: 'Search people' }));
      cleanup();
      await tick();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(warningStack).toBe('');
    } finally {
      warn.mockRestore();
    }
  });

  it('filters, selects by keyboard, dismisses, and restores focus', async () => {
    render(ComboboxHarness);
    const input = screen.getByRole('combobox', { name: 'Search people' });
    input.focus();
    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: 'Grace' } });
    expect(screen.getByRole('option', { name: 'Grace Hopper' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Ada Lovelace' })).toBeNull();

    await waitFor(() => expect(input.getAttribute('aria-activedescendant')).toBeTruthy());
    await fireEvent.keyDown(input, { key: 'Home' });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('combobox-value').textContent).toBe('"grace"'));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('supports multi-select while leaving disabled options unavailable', async () => {
    render(ComboboxHarness, { props: { multiple: true, value: [] } });
    const input = screen.getByRole('combobox', { name: 'Search people' });
    input.focus();
    await fireEvent.focus(input);
    await fireEvent.pointerUp(screen.getByRole('option', { name: 'Ada Lovelace' }), {
      button: 0,
      pointerType: 'mouse',
    });
    await fireEvent.pointerUp(screen.getByRole('option', { name: 'Grace Hopper' }), {
      button: 0,
      pointerType: 'mouse',
    });
    expect(screen.getByTestId('combobox-value').textContent).toBe('["ada","grace"]');
    expect(
      screen
        .getByRole('option', { name: 'Ada Lovelace' })
        .querySelector('[data-slot="combobox-item-check"]'),
    ).toBeTruthy();
    expect(
      screen.getByRole('option', { name: 'Disabled person' }).hasAttribute('data-disabled'),
    ).toBe(true);
  });

  it('synchronizes visible labels for initial and parent-updated controlled values', async () => {
    const single = render(ComboboxHarness, { props: { value: 'grace' } });
    const singleInput = screen.getByRole('combobox', { name: 'Search people' }) as HTMLInputElement;
    expect(singleInput.value).toBe('Grace Hopper');
    await single.rerender({ value: 'ada' });
    await waitFor(() => expect(singleInput.value).toBe('Ada Lovelace'));
    single.unmount();

    const multiple = render(ComboboxHarness, {
      props: { multiple: true, value: ['ada', 'grace'] },
    });
    const multipleInput = screen.getByRole('combobox', {
      name: 'Search people',
    }) as HTMLInputElement;
    expect(multipleInput.value).toBe('Ada Lovelace, Grace Hopper');
    await multiple.rerender({ multiple: true, value: ['grace'] });
    await waitFor(() => expect(multipleInput.value).toBe('Grace Hopper'));
  });

  it('renders disabled and invalid states without opening', async () => {
    const { unmount } = render(ComboboxHarness, {
      props: { disabled: true, invalid: true },
    });
    const disabledInput = screen.getByRole('combobox', { name: 'Search people' });
    expect((disabledInput as HTMLInputElement).disabled).toBe(true);
    expect(disabledInput.getAttribute('aria-invalid')).toBe('true');
    await fireEvent.focus(disabledInput);
    expect(screen.queryByRole('listbox')).toBeNull();
    unmount();
  });

  it('uses a contrast-validated invalid border and ring', () => {
    render(ComboboxHarness, { props: { invalid: true } });
    const input = screen.getByRole('combobox', { name: 'Search people' });
    expect(input.className.split(/\s+/)).toContain('border-danger');
    expect(input.className.split(/\s+/)).toContain('ring-danger/25');
    for (const { label, ratio } of invalidControlContrastCases()) {
      expect(ratio, label).toBeGreaterThanOrEqual(3);
    }
  });

  it('renders observable loading, empty, long-content, and portal states', async () => {
    const loading = render(ComboboxHarness, { props: { loading: true, portal: true } });
    const loadingInput = screen.getByRole('combobox', { name: 'Search people' });
    await fireEvent.focus(loadingInput);
    expect(screen.getByText('Loading options…').getAttribute('role')).toBe('status');
    expect(loading.container.contains(screen.getByRole('listbox'))).toBe(false);
    loading.unmount();

    const long = render(ComboboxHarness);
    const longInput = screen.getByRole('combobox', { name: 'Search people' });
    await fireEvent.focus(longInput);
    expect(
      screen.getByRole('option', {
        name: 'A very long option label that should remain readable and truncate safely',
      }),
    ).toBeTruthy();
    long.unmount();

    const { container } = render(ComboboxHarness, { props: { options: [], portal: true } });
    const input = screen.getByRole('combobox', { name: 'Search people' });
    input.focus();
    await fireEvent.focus(input);
    expect(screen.getByText('No options available')).toBeTruthy();
    expect(container.contains(screen.getByRole('listbox'))).toBe(false);
  });

  it('uses compact lifted field and editorial scrolling geometry', async () => {
    render(ComboboxHarness);
    const input = screen.getByRole('combobox', { name: 'Search people' });
    expect(input.className).toContain('h-(--control-height-medium)');
    expect(input.className).toContain('type-body');
    expect(input.className).toContain('border-border');
    expect(input.className).toContain('bg-card');
    expect(input.className).toContain('hover:border-input');
    expect(input.className).toContain('rounded-(--radius-medium)');
    expect(input.className).toContain('shadow-(--elevation-raised)');
    await fireEvent.focus(input);
    expect(screen.getByRole('listbox').className).toContain('rounded-(--radius-medium)');
  });

  it('dismisses portal content with Escape and restores input focus', async () => {
    const { container } = render(ComboboxHarness, { props: { portal: true } });
    const input = screen.getByRole('combobox', { name: 'Search people' });
    input.focus();
    await fireEvent.focus(input);
    expect(container.contains(screen.getByRole('listbox'))).toBe(false);
    await fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(document.activeElement).toBe(input);
  });
});
