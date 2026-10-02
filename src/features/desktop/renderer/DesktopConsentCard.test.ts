import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DesktopConsentCard from './DesktopConsentCard.svelte';
import { request } from './desktop-test-fixtures';
afterEach(cleanup);
describe('desktop consent card', () => {
  it.each([
    ['Allow once', 'allow_once'],
    ['Allow future sessions for this agent', 'allow_future'],
    ['Deny', 'deny'],
  ] as const)('offers %s for the named agent and computer', async (label, decision) => {
    const onDecision = vi.fn();
    render(DesktopConsentCard, { request, onDecision });
    expect(screen.getByText('Implementor wants to control Windows workstation')).not.toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: label }));
    expect(onDecision).toHaveBeenCalledWith(decision);
  });
  it('disables all choices while a decision awaits the outcome', () => {
    render(DesktopConsentCard, { request, pending: true, onDecision: vi.fn() });
    expect(screen.getByRole('status').textContent).toContain('Waiting for the desktop to confirm');
    for (const button of screen.getAllByRole('button'))
      expect(button.hasAttribute('disabled')).toBe(true);
  });
  it.each(['Windows workstation', 'MacBook'])('has neutral OS guidance for %s', (computerName) => {
    render(DesktopConsentCard, { request: { ...request, computerName }, onDecision: vi.fn() });
    expect(screen.queryByText(/System Settings|Accessibility|Screen Recording/)).toBeNull();
    expect(screen.getByText(/You can stop control at any time/)).not.toBeNull();
  });
});
