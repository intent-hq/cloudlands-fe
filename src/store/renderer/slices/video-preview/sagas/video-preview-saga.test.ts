import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, expect, it, vi } from 'vitest';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { videoPreviewRequested } from '../video-preview-slice';
import { videoPreviewSaga } from './video-preview-saga';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Component integration tests own success/error/release/timeout behavior. This covers
// workspace teardown while a component is still mounted and cannot release its demand.
it('aborts only the closed workspace and never publishes its late conversion result', async () => {
  const signals: AbortSignal[] = [];
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url, options) => {
      signals.push(options.signal);
      return new Promise<Response>((resolve) => {
        if (signals.length === 1) finish = resolve;
      });
    }),
  );
  const createUrl = vi.spyOn(URL, 'createObjectURL');
  const dispatch = vi.fn();
  const channel = stdChannel();
  const task = runSaga({ channel, dispatch }, videoPreviewSaga);
  try {
    channel.put(videoPreviewRequested('one', 'ws1', 'workspace-file://ws1/a.mp4?preview=h264'));
    channel.put(videoPreviewRequested('two', 'ws2', 'workspace-file://ws2/a.mp4?preview=h264'));
    channel.put(workspaceUnmounted('ws1'));
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    finish(new Response(new Uint8Array([1, 2, 3])));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createUrl).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  } finally {
    task.cancel();
  }
  expect(signals[1].aborted).toBe(true);
});
