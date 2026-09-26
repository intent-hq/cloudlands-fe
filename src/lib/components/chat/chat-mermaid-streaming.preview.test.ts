import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Preview from './chat-mermaid-streaming.preview.svelte';

// Only the replay controls own timers; the browser suite exercises the actual chat renderer.
vi.mock('./StreamingMessageContent.svelte', async () => ({
  default: (await import('../workspace/initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await tick();
}

describe('chat Mermaid replay controls', () => {
  it('pauses incoming chunks and stepping stays paused until resumed', async () => {
    render(Preview);
    const next = screen.getByRole<HTMLButtonElement>('button', { name: 'Next chunk' });
    expect(next.disabled).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    expect(next.disabled).toBe(false);
    await fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    const first = screen.getByRole('status').textContent;
    await advance(10_000);
    expect(screen.getByRole('status').textContent).toBe(first);
    await fireEvent.click(next);
    const second = screen.getByRole('status').textContent;
    expect(second).not.toBe(first);
    await advance(10_000);
    expect(screen.getByRole('status').textContent).toBe(second);
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    for (let i = 0; i < 3; i += 1) await advance(1600);
    expect(next.disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Continue' }).disabled).toBe(true);
  });

  it('restarting an active replay cancels the previous deadline and unmount cancels playback', async () => {
    const { unmount } = render(Preview, { startAt: 'start' });
    const first = screen.getByRole('status').textContent;
    const replay = screen.getByRole('button', { name: 'Replay' });
    await fireEvent.click(replay);
    await advance(1000);
    await fireEvent.click(replay);
    await advance(1000);
    expect(screen.getByRole('status').textContent).toBe(first);
    await advance(600);
    expect(screen.getByRole('status').textContent).not.toBe(first);
    await unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
