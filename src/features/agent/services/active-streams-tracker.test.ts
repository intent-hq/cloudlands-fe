import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  handlers: new Map<string, (data: unknown) => void>(),
  invoke: vi.fn(),
}));

vi.mock('$lib/electron-bridge', () => ({
  on: vi.fn((event: string, handler: (data: unknown) => void) => {
    bridge.handlers.set(event, handler);
    return `listener-${event}`;
  }),
  off: vi.fn((event: string) => bridge.handlers.delete(event)),
}));

vi.mock('../../../shared/generated/ipc-client', () => ({
  invoke: bridge.invoke,
}));

interface ActiveStreamsResponse {
  success: boolean;
  data: Array<{
    agentId: string;
    sessionId: string;
    workspaceId: string;
    startTime: number;
  }>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe('ActiveStreamsTracker refresh coalescing', () => {
  let tracker: typeof import('./active-streams-tracker').activeStreamsTracker;
  const originalElectronAPI = window.electronAPI;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    bridge.handlers.clear();
    bridge.invoke.mockReset();
    (window as any).electronAPI = {};
    ({ activeStreamsTracker: tracker } = await import('./active-streams-tracker'));
  });

  afterEach(() => {
    tracker.stopPolling();
    window.electronAPI = originalElectronAPI;
  });

  it('keeps concurrent fetches to one underlying scan while in flight', async () => {
    const firstScan = deferred<ActiveStreamsResponse>();
    bridge.invoke
      .mockImplementationOnce(() => firstScan.promise)
      .mockResolvedValue({ success: true, data: [] });

    const fetches = Array.from({ length: 12 }, () => tracker.fetchActiveStreams());

    expect(bridge.invoke).toHaveBeenCalledTimes(1);
    expect(bridge.invoke).toHaveBeenCalledWith('agent:get-active-streams');

    firstScan.resolve({ success: true, data: [] });
    await Promise.all(fetches);
    expect(bridge.invoke.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('applies busy/idle/deletion pushes across workspaces without dependent scans, even during hydration', async () => {
    const firstScan = deferred<ActiveStreamsResponse>();
    bridge.invoke.mockImplementationOnce(() => firstScan.promise);
    tracker.startPolling();
    const push = (type: string, agentId: string, workspaceId: string, data = {}) =>
      tracker.applyEvent({
        type,
        workspaceId,
        sessionId: agentId,
        timestamp: '2026-10-12T00:00:00Z',
        data: { agentId, ...data },
      });
    push('agent:status-changed', 'live', 'ws-2', { isActive: true, status: 'active' });
    push('agent:idle', 'finished', 'ws-1');
    push('agent:deleted', 'deleted', 'ws-1');
    expect(tracker.getStreamingAgentIdsForWorkspace('ws-2')).toEqual(['live']);
    firstScan.resolve({
      success: true,
      data: [
        { agentId: 'finished', sessionId: 'finished', workspaceId: 'ws-1', startTime: 1 },
        { agentId: 'deleted', sessionId: 'deleted', workspaceId: 'ws-1', startTime: 1 },
        { agentId: 'other', sessionId: 'other', workspaceId: 'ws-3', startTime: 1 },
      ],
    });
    await vi.waitFor(() => expect(tracker.isAgentStreaming('other')).toBe(true));
    expect(tracker.isAgentStreaming('finished')).toBe(false);
    expect(tracker.isAgentStreaming('deleted')).toBe(false);
    expect(tracker.isAgentStreaming('live')).toBe(true);
    push('agent:idle', 'live', 'ws-2');
    expect(tracker.isAgentStreaming('live')).toBe(false);
    expect(bridge.invoke).toHaveBeenCalledTimes(1);
  });

  it('does not multiply the initial scan across startPolling callers', async () => {
    const firstScan = deferred<ActiveStreamsResponse>();
    bridge.invoke
      .mockImplementationOnce(() => firstScan.promise)
      .mockResolvedValue({ success: true, data: [] });

    for (let index = 0; index < 12; index++) tracker.startPolling();

    expect(bridge.invoke).toHaveBeenCalledTimes(1);
    firstScan.resolve({ success: true, data: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bridge.invoke).toHaveBeenCalledTimes(1);
  });

  it('stopPolling during an in-flight refresh drops the trailing scan and map updates', async () => {
    const firstScan = deferred<ActiveStreamsResponse>();
    bridge.invoke
      .mockImplementationOnce(() => firstScan.promise)
      .mockResolvedValue({ success: true, data: [] });

    tracker.startPolling();
    // An explicit recovery request during hydration queues one trailing read.
    const inFlight = tracker.fetchActiveStreams();
    expect(bridge.invoke).toHaveBeenCalledTimes(1);

    tracker.stopPolling();

    firstScan.resolve({
      success: true,
      data: [{ agentId: 'agent-1', sessionId: 'agent-1', workspaceId: 'ws-1', startTime: 1 }],
    });
    await inFlight;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bridge.invoke).toHaveBeenCalledTimes(1);
    expect(tracker.isAgentStreaming('agent-1')).toBe(false);
    expect(tracker.getStreamingAgentIdsForWorkspace('ws-1')).toEqual([]);
  });
});
