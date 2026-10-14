import { expect, it, vi } from 'vitest';
import { videoSource } from './video-source';

it('stops each retired source exactly once, including an unplayed pending source', () => {
  const video = document.createElement('video');
  const calls: (string | null)[] = [];
  const pause = vi.spyOn(video, 'pause').mockImplementation(() => {});
  vi.spyOn(video, 'load').mockImplementation(() => calls.push(video.getAttribute('src')));
  const source = videoSource(video, 'blob:https://example.test/first');
  source.update('blob:https://example.test/first');
  expect(pause).not.toHaveBeenCalled();
  source.update('blob:https://example.test/second');
  expect(video.getAttribute('src')).toBe('blob:https://example.test/second');
  source.destroy();
  source.destroy();
  source.update('blob:https://example.test/retired');
  expect(video.getAttribute('src')).toBeNull();
  expect(pause).toHaveBeenCalledTimes(2);
  expect(calls).toEqual([null, null]);
  vi.restoreAllMocks();
});
