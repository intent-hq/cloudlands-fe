import { describe, expect, it, vi } from 'vitest';
import { WINDOW_CHANNELS } from '$shared/ipc/channels';
import { createDockPointerRegionController } from './dock-pointer-routing';

describe('dock pointer region controller', () => {
  it('signals only pointer-region transitions', () => {
    const invoke = vi.fn(async () => ({ success: true }));
    const controller = createDockPointerRegionController({ invoke });

    controller.activate();
    controller.activate();
    controller.deactivate();
    controller.deactivate();

    expect(invoke.mock.calls).toEqual([
      [WINDOW_CHANNELS.SET_DOCK_POINTER_REGION, { active: true }],
      [WINDOW_CHANNELS.SET_DOCK_POINTER_REGION, { active: false }],
    ]);
  });

  it('resets an active region during cleanup and ignores later signals', () => {
    const invoke = vi.fn(async () => ({ success: true }));
    const controller = createDockPointerRegionController({ invoke });

    controller.activate();
    controller.destroy();
    controller.activate();

    expect(invoke).toHaveBeenLastCalledWith(WINDOW_CHANNELS.SET_DOCK_POINTER_REGION, {
      active: false,
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('is a safe no-op without an Electron preload bridge', () => {
    const controller = createDockPointerRegionController(undefined);
    expect(() => {
      controller.activate();
      controller.deactivate();
      controller.destroy();
    }).not.toThrow();
  });
});
