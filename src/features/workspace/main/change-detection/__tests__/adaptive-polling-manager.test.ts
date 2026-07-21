// @vitest-environment node

/**
 * Regression test: MaxListenersExceededWarning on the AdaptivePollingManager
 * singleton. The singleton receives one `intervalChanged` listener per
 * workspace change-detector, so with 10+ workspaces open the default cap of
 * 10 logged a spurious leak warning even though each detector deregisters
 * cleanly on stop(). The constructor must raise the cap.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));

vi.mock('$shared/logger', () => {
  const noop = () => {};
  class MockLogger {
    info = noop;
    warn = warnSpy;
    error = noop;
    debug = noop;
  }
  return {
    Logger: MockLogger,
    logger: { info: noop, warn: warnSpy, error: noop, debug: noop },
  };
});

import { AdaptivePollingManager } from '../adaptive-polling-manager';

describe('AdaptivePollingManager listener cap', () => {
  afterEach(() => {
    (AdaptivePollingManager as any).instance?.destroy();
    (AdaptivePollingManager as any).instance = undefined;
    warnSpy.mockClear();
  });

  it('raises the max listener cap to 100 for per-workspace registration', () => {
    const manager = AdaptivePollingManager.getInstance();
    expect(manager.getMaxListeners()).toBe(100);
  });

  it('does not log MaxListenersExceededWarning for 20 intervalChanged listeners', () => {
    const manager = AdaptivePollingManager.getInstance();

    for (let i = 0; i < 20; i++) {
      manager.on('intervalChanged', () => {});
    }

    expect(manager.listenerCount('intervalChanged')).toBe(20);
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('MaxListenersExceededWarning'),
    );
  });

  it('control: the warning path is observable through the mocked logger', () => {
    const manager = AdaptivePollingManager.getInstance();
    manager.setMaxListeners(1);

    manager.on('intervalChanged', () => {});
    manager.on('intervalChanged', () => {});

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('MaxListenersExceededWarning'));
  });
});
