import { describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { setBrowserViewsLabRequested } from '../browser-views-lab-slice';

const page = vi.hoisted(() => ({
  loadBrowserViewsLab: vi.fn(async () => undefined),
  setBrowserViewsLabEnabled: vi.fn(async () => undefined),
}));
vi.mock('$lib/components/browser/main-owned-browser-page', () => page);

import { browserViewsLabSaga } from './browser-views-lab-saga';

describe('browserViewsLabSaga', () => {
  it('reads the setting at start and saves a requested change', async () => {
    const channel = stdChannel();
    const task = runSaga(
      { channel, dispatch: () => {}, getState: () => ({}) },
      browserViewsLabSaga,
    );
    await Promise.resolve();
    expect(page.loadBrowserViewsLab).toHaveBeenCalledTimes(1);

    channel.put(setBrowserViewsLabRequested(true));
    await Promise.resolve();
    expect(page.setBrowserViewsLabEnabled).toHaveBeenCalledWith(true);
    task.cancel();
  });
});
