// @vitest-environment jsdom
import axe from 'axe-core';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TimeScrubber from '../TimeScrubber.svelte';

afterEach(cleanup);

const minTime = '2026-01-01T00:00:00.000Z';
const currentTime = '2026-01-01T00:00:05.000Z';
const maxTime = '2026-01-01T00:00:10.000Z';

function renderScrubber(isLive = false) {
  const onTimeChange = vi.fn();
  const result = render(TimeScrubber, {
    props: { currentTime, minTime, maxTime, isLive, onTimeChange, onGoLive: vi.fn() },
  });
  return { ...result, onTimeChange };
}

function mockTrack(track: HTMLElement) {
  Object.defineProperty(track, 'offsetWidth', { configurable: true, value: 200 });
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    right: 200,
    top: 0,
    bottom: 36,
    width: 200,
    height: 36,
    toJSON: () => ({}),
  });
}

describe('TimeScrubber', () => {
  it('scrubs through the primitive with pointer drag and keyboard steps', async () => {
    const { container, getByRole, onTimeChange } = renderScrubber();
    const slider = getByRole('slider');
    const track = container.querySelector<HTMLElement>('[data-slot="slider-track"]')!;
    mockTrack(track);

    await fireEvent.pointerDown(track, { clientX: 145, pointerId: 1, button: 0 });
    await fireEvent.pointerMove(track, { clientX: 46, pointerId: 1 });
    await fireEvent.pointerUp(track, { pointerId: 1 });
    await fireEvent.keyDown(slider, { key: 'ArrowRight' });

    expect(onTimeChange.mock.calls.map(([time]) => time)).toEqual([
      '2026-01-01T00:00:07.500Z',
      '2026-01-01T00:00:02.000Z',
      '2026-01-01T00:00:02.001Z',
    ]);
  });

  it('pauses live mode even when the initial press keeps the current value', async () => {
    const { container, onTimeChange } = renderScrubber(true);
    const track = container.querySelector<HTMLElement>('[data-slot="slider-track"]')!;
    mockTrack(track);

    await fireEvent.pointerDown(track, { clientX: 100, pointerId: 1, button: 0 });
    expect(onTimeChange).toHaveBeenCalledWith(currentTime);
  });

  it('has no scoped axe violations', async () => {
    const { container } = renderScrubber();
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map(({ id }) => id)).toEqual([]);
  });
});
