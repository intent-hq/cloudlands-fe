import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationService } from './notification.service';
import { getWorkspaceEventBus } from '../../events/main/workspace-event-bus';

vi.mock('../../../shared/logger', () => ({
  Logger: class {
    constructor(_category?: string) {}
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

vi.mock('electron-store', () => ({
  default: class {
    constructor(_options?: unknown) {}
    get = vi.fn(() => ({ enabled: true, showWhenFocused: false }));
  },
}));

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    getPath: vi.fn(() => '/tmp/test'),
    getName: vi.fn(() => 'test-app'),
    getVersion: vi.fn(() => '1.0.0'),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  Notification: class {
    static isSupported() {
      return false;
    }

    on = vi.fn();
    show = vi.fn();
  },
}));

vi.mock('../../agent/main/agent-backend-handler.service', () => ({
  AgentBackendHandler: {
    getInstance: vi.fn(() => ({
      getActiveStreams: vi.fn(() => []),
    })),
  },
}));

vi.mock('../../events/main/workspace-event-bus', () => ({
  getWorkspaceEventBus: vi.fn(),
}));

describe('NotificationService start lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unsubscribes previous listener before resubscribing on repeated start()', () => {
    const unsubscribeFirst = vi.fn();
    const unsubscribeSecond = vi.fn();

    const subscribe = vi
      .fn()
      .mockReturnValueOnce({ unsubscribe: unsubscribeFirst })
      .mockReturnValueOnce({ unsubscribe: unsubscribeSecond });

    vi.mocked(getWorkspaceEventBus).mockReturnValue({ subscribe } as any);

    const service = new NotificationService('workspace-1');

    service.start();
    service.start();

    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(unsubscribeFirst).toHaveBeenCalledTimes(1);
    expect(unsubscribeSecond).not.toHaveBeenCalled();
  });

  it('keeps only latest subscription active after repeated start()', () => {
    const unsubscribeFirst = vi.fn();
    const unsubscribeSecond = vi.fn();

    const subscribe = vi
      .fn()
      .mockReturnValueOnce({ unsubscribe: unsubscribeFirst })
      .mockReturnValueOnce({ unsubscribe: unsubscribeSecond });

    vi.mocked(getWorkspaceEventBus).mockReturnValue({ subscribe } as any);

    const service = new NotificationService('workspace-1');

    service.start();
    service.start();
    service.stop();

    expect(unsubscribeFirst).toHaveBeenCalledTimes(1);
    expect(unsubscribeSecond).toHaveBeenCalledTimes(1);
  });
});
