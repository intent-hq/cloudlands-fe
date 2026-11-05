/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import ChatNotice from '../ChatNotice.svelte';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

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
