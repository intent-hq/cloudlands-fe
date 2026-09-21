import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentAttentionToast from '../AgentAttentionToast.svelte';

describe('AgentAttentionToast', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('keeps compact elapsed time live and exposes the full timestamp', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T12:00:18Z'));
    render(AgentAttentionToast, {
      title: 'Coordinator requests a discussion',
      reason: 'Choose the next step',
      kind: 'discussion',
      timestamp: '2026-09-13T12:00:00Z',
      onSwitchTo: vi.fn(),
      onClose: vi.fn(),
    });
    const time = screen.getByText('18s');
    expect(time.getAttribute('title')).toMatch(/2026/);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(screen.getByText('2m')).toBeTruthy();
  });

  it('fills the shared toast width and preserves Switch To and close actions', async () => {
    const onSwitchTo = vi.fn();
    const onClose = vi.fn();
    const { container } = render(AgentAttentionToast, {
      props: {
        title: 'Implementor requests a discussion',
        reason: 'Need a decision on the API shape',
        kind: 'discussion',
        onSwitchTo,
        onClose,
      },
    });

    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains('w-full')).toBe(true);
    expect(root.classList.contains('min-w-0')).toBe(true);
    await fireEvent.click(screen.getByText('Switch To'));
    await fireEvent.click(screen.getByLabelText('Dismiss attention request'));
    expect(onSwitchTo).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
