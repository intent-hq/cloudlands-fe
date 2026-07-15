/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import InterruptionNotice from '../InterruptionNotice.svelte';

describe('InterruptionNotice', () => {
  it('renders default message when no message prop is provided', () => {
    render(InterruptionNotice);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/This conversation was interrupted because intentd restarted/i)).toBeTruthy();
  });

  it('renders custom message when message prop is provided', () => {
    const customMessage = 'Custom interruption message';
    render(InterruptionNotice, { props: { message: customMessage } });

    expect(screen.getByText(customMessage)).toBeTruthy();
  });

  it('has proper ARIA attributes for accessibility', () => {
    render(InterruptionNotice);

    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('polite');
  });

  it('displays warning icon', () => {
    const { container } = render(InterruptionNotice);

    // Check for icon presence via SVG element
    const icon = container.querySelector('svg');
    expect(icon).toBeTruthy();
  });

  it('applies custom class when provided', () => {
    const customClass = 'custom-test-class';
    const { container } = render(InterruptionNotice, { props: { class: customClass } });

    const notice = container.querySelector('.interruption-notice');
    expect(notice).toBeTruthy();
    expect(notice?.className).toContain(customClass);
  });
});
