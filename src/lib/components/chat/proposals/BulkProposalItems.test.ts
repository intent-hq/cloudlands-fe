/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import BulkProposalItems from './BulkProposalItems.svelte';

describe('BulkProposalItems', () => {
  it('uses textless Toggles beside item labels and preserves selection state', async () => {
    const onSelectionChange = vi.fn();
    render(BulkProposalItems, {
      props: {
        items: [
          { id: 'one', title: 'Update notifications', selected: true },
          { id: 'two', title: 'Update theme' },
        ],
        selectedIds: ['one'],
        onSelectionChange,
      },
    });

    const selected = screen.getByRole('button', { name: 'Toggle Update notifications' });
    const unselected = screen.getByRole('button', { name: 'Toggle Update theme' });
    expect(selected.textContent?.trim()).toBe('');
    expect(unselected.textContent?.trim()).toBe('');
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    expect(unselected.getAttribute('aria-pressed')).toBe('false');

    await fireEvent.click(unselected);
    expect(unselected.getAttribute('aria-pressed')).toBe('true');
    expect(onSelectionChange).toHaveBeenLastCalledWith(['one', 'two']);
    expect(screen.getByText('2 / 2 selected')).toBeTruthy();

    await fireEvent.click(selected);
    expect(selected.getAttribute('aria-pressed')).toBe('false');
    expect(onSelectionChange).toHaveBeenLastCalledWith(['two']);
  });

  it('keeps disabled item and collection controls inert', async () => {
    const onSelectionChange = vi.fn();
    const { rerender } = render(BulkProposalItems, {
      props: {
        items: [{ id: 'locked', title: 'Locked update', disabled: true }],
        onSelectionChange,
      },
    });

    const item = screen.getByRole('button', { name: 'Toggle Locked update' });
    expect(item.hasAttribute('disabled')).toBe(true);
    await fireEvent.click(item);
    expect(onSelectionChange).not.toHaveBeenCalled();

    await rerender({
      items: [{ id: 'available', title: 'Available update' }],
      disabled: true,
      onSelectionChange,
    });
    expect(
      screen.getByRole('button', { name: 'Toggle Available update' }).hasAttribute('disabled'),
    ).toBe(true);
  });
});
