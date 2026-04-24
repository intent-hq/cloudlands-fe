import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockMemoryMonitor = {
  start: vi.fn(),
  stop: vi.fn(),
};

const mockMemoryLeakDetector = {
  dispose: vi.fn(),
  getStats: vi.fn(() => ({ timers: 0, intervals: 0 })),
};

const mockComponentDisposalManager = {
  disposeAll: vi.fn(),
  getStats: vi.fn(() => ({ componentCount: 0, components: [] })),
};

vi.mock('$lib/utils/logger', () => ({
  Logger: class {
     
    constructor(_config?: unknown) {}
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

vi.mock('../../agent/agent.service', () => ({
  agentService: {
    dispose: vi.fn(),
  },
}));

vi.mock('./memory-leak-detector.service', () => ({
  memoryLeakDetector: mockMemoryLeakDetector,
}));

vi.mock('./disposal-manager.service', () => ({
  componentDisposalManager: mockComponentDisposalManager,
}));

vi.mock('$shared/monitoring/memory-monitor', () => ({
  getMemoryMonitor: vi.fn(() => mockMemoryMonitor),
}));

describe('globalCleanupService visibility lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('does not register a visibilitychange handler', async () => {
    const addWindowListenerSpy = vi.spyOn(window, 'addEventListener');
    const addDocumentListenerSpy = vi.spyOn(document, 'addEventListener');

    await import('./global-cleanup.service');
    vi.runOnlyPendingTimers();

    expect(addWindowListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    expect(addWindowListenerSpy).toHaveBeenCalledWith('unload', expect.any(Function));
    expect(addDocumentListenerSpy).not.toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );
  });

  it('does not perform cleanup when visibility changes', async () => {
    await import('./global-cleanup.service');
    vi.runOnlyPendingTimers();

    vi.clearAllMocks();

    document.dispatchEvent(new Event('visibilitychange'));

    expect(mockMemoryLeakDetector.dispose).not.toHaveBeenCalled();
    expect(mockComponentDisposalManager.disposeAll).not.toHaveBeenCalled();
    expect(mockMemoryMonitor.stop).not.toHaveBeenCalled();
  });
});
