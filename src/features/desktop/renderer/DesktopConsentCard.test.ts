import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DesktopConsentCard from './DesktopConsentCard.svelte';
import { request } from './desktop-test-fixtures';
afterEach(cleanup);
describe('desktop consent card', () => {
  it('keeps Deny available while OS setup waits and prevents repeated Allow', async () => {
    const onDecision = vi.fn();
    render(DesktopConsentCard, { request, pending: true, settingUp: true, onDecision });
    expect(screen.getByRole('button', { name: 'Allow once' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Deny' }).hasAttribute('disabled')).toBe(false);
    expect(
      screen.queryByText('Sending your decision. Waiting for the desktop to confirm.'),
    ).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onDecision).toHaveBeenCalledExactlyOnceWith('deny');
  });
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
  it('explains that Allow selects this computer only for an unassigned workspace', () => {
    render(DesktopConsentCard, {
      request: { ...request, claimsPrimary: true },
      onDecision: vi.fn(),
    });
    expect(
      screen.getByText(/Allowing control sets Windows workstation as this workspace/),
    ).not.toBeNull();
  });
  it('does not suggest changing an assigned primary', () => {
    render(DesktopConsentCard, { request, onDecision: vi.fn() });
    expect(screen.queryByText(/Allowing control sets/)).toBeNull();
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
