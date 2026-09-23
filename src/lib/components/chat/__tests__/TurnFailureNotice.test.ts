/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import TurnFailureNotice from '../TurnFailureNotice.svelte';

describe('TurnFailureNotice', () => {
  it('renders default title when no reason is provided', () => {
    render(TurnFailureNotice);

    expect(screen.getByRole('alert')).toBeTruthy();
    // The title should be present from the i18n message
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBeTruthy();
  });

  it('renders custom reason when provided', () => {
    const customReason = 'The agent encountered a critical error';
    render(TurnFailureNotice, { props: { reason: customReason } });

    expect(screen.getByText(customReason)).toBeTruthy();
  });

  it('has proper ARIA attributes for accessibility', () => {
    render(TurnFailureNotice);

    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('polite');
  });

  it('updates the failure reason without losing alert semantics', async () => {
    const { rerender } = render(TurnFailureNotice, { props: { reason: 'First failure' } });
    await rerender({ reason: 'Updated failure' });
    expect(screen.getByRole('alert').textContent).toContain('Updated failure');
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
