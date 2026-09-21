import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateTabViewport } from '$store/renderer/slices/panel-layout/panel-layout-slice';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$store/renderer/store', () => ({ store: { dispatch: mocks.dispatch } }));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));

import { applyBrowserTabViewport } from './browser-viewport-action';

describe('applyBrowserTabViewport', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists the viewport and sends the exact main-process request', async () => {
    const viewport = { mode: 'custom' as const, width: 412, height: 915 };

    await applyBrowserTabViewport('workspace-1', 'tab-1', viewport);

    expect(mocks.dispatch).toHaveBeenCalledWith(
      updateTabViewport('workspace-1', 'tab-1', viewport),
    );
    expect(mocks.invoke).toHaveBeenCalledWith('browser:set-tab-viewport', {
      tabId: 'tab-1',
      viewport,
    });
  });
});
