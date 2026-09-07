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
    const listbox = screen.getByRole('listbox', { name: 'Choose fruit' });
    expect(trigger.getAttribute('aria-controls')).toBe(listbox.id);
    expect(listbox.getAttribute('aria-labelledby')).toBe(trigger.id);
    expect(trigger.hasAttribute('aria-activedescendant')).toBe(false);
    expect(listbox.getAttribute('data-select-viewport')).not.toBeNull();
    expect(listbox.getAttribute('tabindex')).toBe('0');
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

  it('opens long content without changing its accessible option name', async () => {
    render(SelectHarness);
    const trigger = screen.getByRole('button', { name: 'Choose fruit' });
    expect(trigger.closest('[data-slot="select-root"]')).toBeTruthy();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    const longOption = screen.getByRole('option', { name: /very long cherry/ });
    expect(longOption.textContent).toContain('A very long cherry');
  });
});
