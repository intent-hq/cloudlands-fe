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

  it('exposes combobox/listbox semantics and supports keyboard selection with focus restoration', async () => {
    render(SelectHarness);
    const trigger = screen.getByRole('combobox', { name: 'Choose fruit' });
    expect(trigger.textContent).toContain('Apple');
    expect(trigger.textContent).not.toContain('apple');
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.hasAttribute('aria-activedescendant')).toBe(false);

    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    const listbox = screen.getByRole('listbox', { name: 'Choose fruit' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(listbox.id);
    expect(listbox.getAttribute('aria-labelledby')).toBe(trigger.id);
    expect(listbox.getAttribute('data-select-viewport')).not.toBeNull();
    expect(listbox.getAttribute('tabindex')).toBe('-1');
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

  it('references the highlighted option from the focused trigger while arrowing', async () => {
    render(SelectHarness);
    const trigger = screen.getByRole('combobox', { name: 'Choose fruit' });
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });

    const apple = screen.getByRole('option', { name: 'Apple' });
    await waitFor(() => expect(apple.getAttribute('data-highlighted')).not.toBeNull());
    expect(trigger.getAttribute('aria-activedescendant')).toBe(apple.id);

    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const banana = screen.getByRole('option', { name: 'Banana' });
    await waitFor(() => expect(banana.getAttribute('data-highlighted')).not.toBeNull());
    expect(banana.id).not.toBe('');
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-activedescendant')).toBe(banana.id);

    await fireEvent.keyDown(trigger, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(trigger.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('honours a consumer trigger id for external labels and listbox labelling', async () => {
    render(SelectHarness, { props: { consumerId: 'fruit-select' } });
    const trigger = screen.getByLabelText('Fruit');
    expect(trigger.id).toBe('fruit-select');
    expect(screen.getByRole('combobox', { name: 'Fruit' })).toBe(trigger);
    expect(trigger.hasAttribute('aria-label')).toBe(false);

    await fireEvent.keyDown(trigger, { key: 'Enter' });
    const listbox = screen.getByRole('listbox', { name: 'Fruit' });
    expect(listbox.getAttribute('aria-labelledby')).toBe('fruit-select');
  });

  it.each([
    { mode: 'inline', portal: false, staticPosition: false },
    { mode: 'portalled', portal: true, staticPosition: false },
  ])(
    'restores trigger focus when Escape dismisses a focused $mode search field',
    async ({ portal, staticPosition }) => {
      render(SelectHarness, { props: { portal, staticPosition, searchable: true } });
      const trigger = screen.getByRole('combobox', { name: 'Choose fruit' });
      trigger.focus();
      await fireEvent.keyDown(trigger, { key: 'Enter' });
      const search = screen.getByRole('textbox', { name: 'Filter fruit' });
      search.focus();
      await fireEvent.keyDown(search, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(trigger));
      expect(screen.getByTestId('select-value').textContent).toBe('apple');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
    },
  );

  it('does not restore trigger focus when a focused search field is dismissed outside', async () => {
    render(SelectHarness, { props: { portal: true, searchable: true } });
    const trigger = screen.getByRole('combobox', { name: 'Choose fruit' });
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    screen.getByRole('textbox', { name: 'Filter fruit' }).focus();
    await fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(document.activeElement).not.toBe(trigger);
  });

  it('names an unlabelled combobox from its visible content and follows the selection', async () => {
    render(SelectHarness, { props: { unlabelled: true } });
    const trigger = await screen.findByRole('combobox', { name: 'Apple' });

    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'b' });
    await waitFor(() => expect(screen.getByTestId('select-value').textContent).toBe('banana'));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Banana' })).toBe(trigger));
  });

  it('supports closed-state typeahead and controlled invalid/disabled states', async () => {
    const { unmount } = render(SelectHarness, { props: { invalid: true } });
    const trigger = screen.getByRole('combobox', { name: 'Choose fruit' });
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
      (screen.getByRole('combobox', { name: 'Choose fruit' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('supports portalled content and outside dismissal', async () => {
    const { container } = render(SelectHarness, { props: { portal: true } });
    const trigger = screen.getByRole('combobox', { name: 'Choose fruit' });
    await fireEvent.keyDown(trigger, { key: 'Enter' });

    const listbox = screen.getByRole('listbox');
    expect(container.contains(listbox)).toBe(false);
    await fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('opens long content without changing its accessible option name', async () => {
    render(SelectHarness);
    const trigger = screen.getByRole('combobox', { name: 'Choose fruit' });
    expect(trigger.closest('[data-slot="select-root"]')).toBeTruthy();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    const longOption = screen.getByRole('option', { name: /very long cherry/ });
    expect(longOption.textContent).toContain('A very long cherry');
  });
});
