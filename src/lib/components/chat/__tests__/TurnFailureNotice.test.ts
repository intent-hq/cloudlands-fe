/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import TurnFailureNotice from '../TurnFailureNotice.svelte';

describe('TurnFailureNotice', () => {
  it('renders default title when no reason is provided', () => {
    render(TurnFailureNotice);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: '1 recorded failure' })).toBeTruthy();
  });

  it('discloses the custom reason when requested', async () => {
    const customReason = 'The agent encountered a critical error';
    render(TurnFailureNotice, { props: { reason: customReason } });

    await fireEvent.click(screen.getByRole('button', { name: '1 recorded failure' }));
    expect(screen.getByText(customReason)).toBeTruthy();
  });

  it('has proper ARIA attributes for accessibility', () => {
    render(TurnFailureNotice);

    const disclosure = screen.getByRole('button', { name: '1 recorded failure' });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(disclosure.getAttribute('aria-controls')).toBeTruthy();
  });

  it('updates the disclosed reason without announcing historical errors', async () => {
    const { rerender } = render(TurnFailureNotice, { props: { reason: 'First failure' } });
    await fireEvent.click(screen.getByRole('button', { name: '1 recorded failure' }));
    await rerender({ reason: 'Updated failure' });
    expect(screen.getByRole('region').textContent).toContain('Updated failure');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('First failure')).toBeNull();
  });

  it('applies custom class when provided', () => {
    const customClass = 'custom-test-class';
    const { container } = render(TurnFailureNotice, { props: { class: customClass } });

    const notice = container.querySelector('.turn-failure-notice');
    expect(notice).toBeTruthy();
    expect(notice?.className).toContain(customClass);
  });
});
