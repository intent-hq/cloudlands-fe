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

  it('coalesces a status and idle burst into one trailing scan with the latest snapshot', async () => {
    const firstScan = deferred<ActiveStreamsResponse>();
    const trailingScan = deferred<ActiveStreamsResponse>();
    bridge.invoke
      .mockImplementationOnce(() => firstScan.promise)
      .mockImplementationOnce(() => trailingScan.promise);

    tracker.startPolling();
    const statusChanged = bridge.handlers.get('agent:status-changed');
    const idle = bridge.handlers.get('agent:idle');
    expect(statusChanged).toBeDefined();
    expect(idle).toBeDefined();

    for (let index = 0; index < 10; index++) {
      statusChanged?.({ agentId: `agent-${index}` });
      idle?.({ agentId: `agent-${index}` });
    }
    expect(bridge.invoke).toHaveBeenCalledTimes(1);

    firstScan.resolve({
      success: true,
      data: [
        { agentId: 'stale-agent', sessionId: 'stale-agent', workspaceId: 'ws-1', startTime: 1 },
      ],
    });
    await vi.waitFor(() => expect(bridge.invoke).toHaveBeenCalledTimes(2));

    trailingScan.resolve({
      success: true,
      data: [
        { agentId: 'latest-agent', sessionId: 'latest-agent', workspaceId: 'ws-2', startTime: 2 },
      ],
    });
    await vi.waitFor(() => expect(tracker.isAgentStreaming('latest-agent')).toBe(true));

    expect(tracker.isAgentStreaming('stale-agent')).toBe(false);
    expect(tracker.getStreamingAgentIdsForWorkspace('ws-2')).toEqual(['latest-agent']);
    expect(bridge.invoke).toHaveBeenCalledTimes(2);
  });

  it('does not multiply the initial scan across startPolling callers', async () => {
    const firstScan = deferred<ActiveStreamsResponse>();
    bridge.invoke
      .mockImplementationOnce(() => firstScan.promise)
      .mockResolvedValue({ success: true, data: [] });

    for (let index = 0; index < 12; index++) tracker.startPolling();

    expect(bridge.invoke).toHaveBeenCalledTimes(1);
    firstScan.resolve({ success: true, data: [] });
    await vi.waitFor(() => expect(bridge.invoke.mock.calls.length).toBeLessThanOrEqual(2));
  });
});
