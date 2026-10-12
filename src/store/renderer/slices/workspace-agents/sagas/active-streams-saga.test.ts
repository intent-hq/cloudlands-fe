import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
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
  it('restarts and clears the tracker on admission changes and keeps pushes scan-free', async () => {
    const channel = stdChannel();
    let state = withLegacyPrincipal({});
    const listeners = new Set<() => void>();
    const reduxStore = {
      getState: () => state,
      subscribe: (fn: () => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
    const task = runSaga(
      { channel, getState: reduxStore.getState, context: { reduxStore } },
      activeStreamsSaga,
    );
    await vi.waitFor(() => expect(tracker.startPolling).toHaveBeenCalledTimes(1));
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
    state = { ...state, principal: { ...state.principal, status: 'loading' } };
    listeners.forEach((fn) => fn());
    await vi.waitFor(() => expect(tracker.stopPolling).toHaveBeenCalledTimes(1));
    channel.put(eventReceived('ws-1', event));
    expect(tracker.applyEvent).toHaveBeenCalledTimes(2);
    state = withLegacyPrincipal({ daemonHealth: { connectionGeneration: 2 } });
    listeners.forEach((fn) => fn());
    await vi.waitFor(() => expect(tracker.startPolling).toHaveBeenCalledTimes(2));
    task.cancel();
    expect(tracker.stopPolling).toHaveBeenCalledTimes(2);
  });
});
