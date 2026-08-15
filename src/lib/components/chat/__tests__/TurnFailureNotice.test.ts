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

  it('displays failure icon', () => {
    const { container } = render(TurnFailureNotice);

    // Check for icon presence via SVG element
    const icon = container.querySelector('svg');
    expect(icon).toBeTruthy();
  });

  it('applies custom class when provided', () => {
    const customClass = 'custom-test-class';
    const { container } = render(TurnFailureNotice, { props: { class: customClass } });

    const notice = container.querySelector('.turn-failure-notice');
    expect(notice).toBeTruthy();
    expect(notice?.className).toContain(customClass);
  });

  it('uses sandbox-scoped CSS variables for vertical spacing with 1rem fallback', () => {
    const { container } = render(TurnFailureNotice);

    const notice = container.querySelector('.turn-failure-notice') as HTMLElement;
    expect(notice).toBeTruthy();
    // The component should have the turn-failure-notice class which applies the CSS variables
    // The actual computed values are tested in the Playwright geometry test (chat-polish-controls.spec.ts)
    expect(notice.className).toContain('turn-failure-notice');
  });
});
