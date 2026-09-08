import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidControlContrastCases } from '../../../../../tests/helpers/invalid-control-contrast';
import SelectHarness from './select.test-harness.svelte';

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

describe('Select', () => {
  afterEach(cleanup);

  it('exposes button/listbox semantics and supports keyboard selection with focus restoration', async () => {
    render(SelectHarness);
    const trigger = screen.getByRole('button', { name: 'Choose fruit' });
    expect(trigger.textContent).toContain('Apple');
    expect(trigger.textContent).not.toContain('apple');

    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Apple' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(
      screen
        .getByRole('option', { name: 'Apple' })
        .querySelector('[data-slot="select-item-check"]'),
    ).toBeTruthy();

    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await fireEvent.keyDown(trigger, { key: 'Enter' });

    await waitFor(() => expect(screen.getByTestId('select-value').textContent).toBe('banana'));
    expect(trigger.textContent).toContain('Banana');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('supports closed-state typeahead and controlled invalid/disabled states', async () => {
    const { unmount } = render(SelectHarness, { props: { invalid: true } });
    const trigger = screen.getByRole('button', { name: 'Choose fruit' });
    expect(trigger.getAttribute('aria-invalid')).toBe('true');
    expect(trigger.className.split(/\s+/)).toContain('aria-invalid:border-danger');
    expect(trigger.className.split(/\s+/)).toContain('aria-invalid:ring-1');
    expect(trigger.className.split(/\s+/)).toContain('aria-invalid:ring-danger/25');
    for (const { label, ratio } of invalidControlContrastCases()) {
      expect(ratio, label).toBeGreaterThanOrEqual(3);
    }

    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'b' });
    await waitFor(() => expect(screen.getByTestId('select-value').textContent).toBe('banana'));
    unmount();

    render(SelectHarness, { props: { disabled: true } });
    expect(
      (screen.getByRole('button', { name: 'Choose fruit' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('supports portalled content and outside dismissal', async () => {
    const { container } = render(SelectHarness, { props: { portal: true } });
    const trigger = screen.getByRole('button', { name: 'Choose fruit' });
    await fireEvent.keyDown(trigger, { key: 'Enter' });

    const listbox = screen.getByRole('listbox');
    expect(container.contains(listbox)).toBe(false);
    await fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('uses compact editorial geometry and safe long-content treatment', async () => {
    render(SelectHarness);
    const trigger = screen.getByRole('button', { name: 'Choose fruit' });
    expect(trigger.parentElement?.className.split(/\s+/)).toContain('min-w-0');
    expect(trigger.className).toContain('h-(--control-height-medium)');
    expect(trigger.className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        'type-body',
        'border-border',
        'bg-card',
        'hover:border-input',
        'focus-visible:ring-ring/40',
      ]),
    );
    expect(trigger.className.split(/\s+/)).not.toContain('border-input');
    expect(trigger.className.split(/\s+/)).not.toContain('text-sm');
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    const longOption = screen.getByRole('option', { name: /very long cherry/ });
    expect(longOption.firstElementChild?.className).toContain('truncate');
    expect(longOption.className.split(/\s+/)).toContain('type-body');
  });
});
