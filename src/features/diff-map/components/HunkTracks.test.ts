/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import HunkTracks from './HunkTracks.svelte';

afterEach(cleanup);

describe('HunkTracks', () => {
  it('clamps positions and keeps a minimum segment width', () => {
    const { container } = render(HunkTracks, {
      props: { oldTrack: [-1, 0], newTrack: [2, -0.5] },
    });
    const oldSegment = container.querySelector<HTMLElement>('[data-track-side="old"]')!;
    const newSegment = container.querySelector<HTMLElement>('[data-track-side="new"]')!;

    expect(oldSegment.style.left).toBe('0%');
    expect(oldSegment.style.width).toBe('1.5%');
    expect(newSegment.style.left).toBe('100%');
    expect(newSegment.style.width).toBe('1.5%');
  });

  it.each([
    ['old', { oldTrack: [0.25, 0.2] }],
    ['new', { newTrack: [0.75, 0.3] }],
  ] as const)('renders the %s track independently', (side, props) => {
    const { container } = render(HunkTracks, { props });
    expect(container.querySelectorAll(`[data-track-side="${side}"]`)).toHaveLength(1);
    expect(
      container.querySelectorAll(`[data-track-side]:not([data-track-side="${side}"])`),
    ).toHaveLength(0);
    expect(container.querySelector('.hunk-tracks')?.getAttribute('aria-hidden')).toBe('true');
  });
});
