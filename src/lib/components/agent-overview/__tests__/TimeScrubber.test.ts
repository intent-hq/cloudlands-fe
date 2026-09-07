import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../ui/__tests__/mocks/Fa.svelte')).default,
}));

import TimeScrubber from '../TimeScrubber.svelte';

afterEach(cleanup);

describe('TimeScrubber', () => {
  it('drives play, pause, rate, cursor, and live controls', async () => {
    const start = '2026-09-04T00:00:00.000Z';
    const middle = '2026-09-04T00:01:00.000Z';
    const end = '2026-09-04T00:02:00.000Z';
    const onTimeChange = vi.fn();
    const onTogglePlay = vi.fn();
    const onSpeedChange = vi.fn();
    const onGoLive = vi.fn();
    const view = render(TimeScrubber, {
      props: {
        currentTime: middle,
        minTime: start,
        maxTime: end,
        isLive: false,
        isPlaying: false,
        speed: 1,
        onTimeChange,
        onTogglePlay,
        onSpeedChange,
        onGoLive,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: /play/i }));
    await view.rerender({ isPlaying: true });
    await fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    await fireEvent.click(screen.getByRole('button', { name: '1×' }));
    await fireEvent.input(screen.getByRole('slider'), {
      target: { value: String(Date.parse(start) + 30_000) },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Live' }));

    expect(onTogglePlay).toHaveBeenCalledTimes(2);
    expect(onSpeedChange).toHaveBeenCalledWith(2);
    expect(onTimeChange).toHaveBeenCalledWith('2026-09-04T00:00:30.000Z');
    expect(onGoLive).toHaveBeenCalledOnce();
  });

  it('handles playback, event stepping, bounds, and live keyboard shortcuts', async () => {
    const start = '2026-09-04T00:00:00.000Z';
    const middle = '2026-09-04T00:01:00.000Z';
    const end = '2026-09-04T00:02:00.000Z';
    const onTimeChange = vi.fn();
    const onTogglePlay = vi.fn();
    const onGoLive = vi.fn();
    const { container } = render(TimeScrubber, {
      props: {
        currentTime: middle,
        minTime: start,
        maxTime: end,
        eventTimes: [start, middle, end],
        isLive: false,
        isPlaying: false,
        speed: 1,
        onTimeChange,
        onTogglePlay,
        onSpeedChange: vi.fn(),
        onGoLive,
      },
    });
    const scrubber = container.querySelector<HTMLElement>('[data-time-scrubber]')!;

    await fireEvent.keyDown(scrubber, { key: 'ArrowLeft' });
    await fireEvent.keyDown(scrubber, { key: 'ArrowRight' });
    await fireEvent.keyDown(scrubber, { key: 'Home' });
    await fireEvent.keyDown(scrubber, { key: 'End' });
    await fireEvent.keyDown(scrubber, { key: ' ' });
    await fireEvent.keyDown(scrubber, { key: 'L' });

    expect(onTimeChange.mock.calls.map(([time]) => time)).toEqual([start, end, start, end]);
    expect(onTogglePlay).toHaveBeenCalledOnce();
    expect(onGoLive).toHaveBeenCalledOnce();
  });
});
