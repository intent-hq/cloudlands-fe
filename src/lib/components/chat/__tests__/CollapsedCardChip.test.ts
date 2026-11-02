/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import CollapsedCardChip from '../CollapsedCardChip.svelte';

function setup(props: { heading?: string; count?: number; withDismiss?: boolean } = {}) {
  const onExpand = vi.fn();
  const onDismiss = vi.fn();
  render(CollapsedCardChip, {
    props: {
      heading: props.heading ?? 'Card heading',
      count: props.count,
      hint: 'Open card',
      onExpand,
      dismiss: props.withDismiss
        ? { label: 'Dismiss card', tooltip: 'Dismiss this card', onDismiss }
        : undefined,
    },
  });
  return { onExpand, onDismiss };
}

describe('CollapsedCardChip', () => {
  it('expands on click and reports itself as collapsed', async () => {
    const { onExpand } = setup();
    const expand = screen.getByRole('button', { name: 'Card heading Open card' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(expand);
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it('includes the count in the expand button name only when one is given', () => {
    setup({ heading: 'Heading 2', count: 3 });
    expect(screen.getByRole('button', { name: 'Heading 2 3 Open card' })).toBeTruthy();
  });

  it('leaves the count out of the expand button name when none is given', () => {
    setup({ heading: 'Heading 2' });
    expect(screen.getByRole('button', { name: 'Heading 2 Open card' })).toBeTruthy();
  });

  it('offers Dismiss as its own control that does not expand', async () => {
    const { onExpand, onDismiss } = setup({ withDismiss: true });
    const expand = screen.getByRole('button', { name: 'Card heading Open card' });
    const dismiss = screen.getByRole('button', { name: 'Dismiss card' });
    expect(expand.contains(dismiss)).toBe(false);
    await fireEvent.click(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onExpand).not.toHaveBeenCalled();
  });

  it('offers no Dismiss control when none is given', () => {
    setup();
    expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
  });
});
