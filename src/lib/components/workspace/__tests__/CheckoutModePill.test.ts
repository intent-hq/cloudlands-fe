/**
 * CheckoutModePill visibility/label tests (Task: checkout-mode pill on the
 * org/repo subtitle). The pill renders "CoW" for `checkoutMode === 'cow'`,
 * "Worktree" for `'worktree'`, and nothing at all when the field is absent
 * (direct / non-daemon-provisioned checkouts).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import CheckoutModePill from '../CheckoutModePill.svelte';

describe('CheckoutModePill', () => {
  afterEach(cleanup);

  it('renders "CoW" when checkoutMode is cow', () => {
    render(CheckoutModePill, { props: { checkoutMode: 'cow' } });
    const pill = screen.getByText('CoW');
    expect(pill).toBeTruthy();
    expect(pill.classList.contains('shrink-0')).toBe(true);
  });

  it('renders "Worktree" when checkoutMode is worktree', () => {
    render(CheckoutModePill, { props: { checkoutMode: 'worktree' } });
    expect(screen.getByText('Worktree')).toBeTruthy();
  });

  it('renders nothing when checkoutMode is undefined (direct)', () => {
    const { container } = render(CheckoutModePill, { props: {} });
    expect(container.textContent?.trim()).toBe('');
    expect(container.querySelector('span')).toBeNull();
  });
});
