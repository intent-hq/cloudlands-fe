import { describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import type { WorkspaceEvent } from '$features/events/types';
import { eventReceived } from '../../workspace-events/workspace-events-slice';

const tracker = vi.hoisted(() => ({
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  applyEvent: vi.fn(),
}));
vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: tracker,
}));
import { activeStreamsSaga } from './active-streams-saga';

describe('activeStreamsSaga', () => {
  it('keeps the tracker alive for admitted pushes until the root owner stops', () => {
    const channel = stdChannel();
    const task = runSaga({ channel }, activeStreamsSaga);
    const event = {
      type: 'agent:status-changed',
      workspaceId: 'ws-1',
      timestamp: '2026-10-12T00:00:00Z',
      data: { agentId: 'agent-1', status: 'active', isActive: true },
    } as WorkspaceEvent;
    channel.put(eventReceived('ws-1', event));
    channel.put(eventReceived('ws-1', { ...event, type: 'agent:idle' } as WorkspaceEvent));
    expect(tracker.startPolling).toHaveBeenCalledTimes(1);
    expect(tracker.applyEvent).toHaveBeenCalledTimes(2);
    expect(tracker.applyEvent).toHaveBeenNthCalledWith(1, event);
    expect(tracker.stopPolling).not.toHaveBeenCalled();
    task.cancel();
    expect(tracker.stopPolling).toHaveBeenCalledTimes(1);
  });
});
