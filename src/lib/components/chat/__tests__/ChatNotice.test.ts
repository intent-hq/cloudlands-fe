/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ChatNotice from '../ChatNotice.svelte';

describe('ChatNotice', () => {
  it('updates and removes the optional reason when its input changes', async () => {
    const { rerender } = render(ChatNotice, {
      props: { title: 'Needs review', tone: 'warning', reason: 'Original reason' },
    });
    expect(screen.getByRole('alert').textContent).toContain('Original reason');
    await rerender({ reason: 'Updated reason' });
    expect(screen.queryByText('Original reason')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Updated reason');
    await rerender({ reason: '' });
    expect(screen.queryByTestId('chat-notice-reason')).toBeNull();
  });

  it('only exposes a timestamp when one is supplied', async () => {
    const { rerender } = render(ChatNotice, {
      props: { title: 'Needs review', tone: 'danger' },
    });
    const header = screen.getByTestId('chat-notice-header');
    expect(header.querySelector('[title]')).toBeNull();
    await rerender({ timestamp: '2026-08-25T12:00:00.000Z' });
    expect(header.querySelector('[title]')).not.toBeNull();
    await rerender({ timestamp: undefined });
    expect(header.querySelector('[title]')).toBeNull();
  });

  it('preserves alert announcements without announcing the repeated pending summary', async () => {
    const { rerender } = render(ChatNotice, {
      props: { title: 'Needs review', tone: 'warning', announce: false },
    });
    expect(screen.queryByRole('alert')).toBeNull();
    await rerender({ announce: true });
    expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('polite');
    await rerender({ announce: false });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
