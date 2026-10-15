import { expect, it, vi } from 'vitest';
import { createDaemonQueueEvents } from './daemon-queue-events';
import type { WorkspaceEvent } from './types';
const row = {
  id: 'q',
  content: 'actual',
  queuedAt: '2026-10-15T00:00:00Z',
  position: 0,
  turnId: 'turn',
};
it('routes real queue identities/order and rejects retired or wrong-workspace events', () => {
  const dispatch = vi.fn(),
    observe = vi.fn(),
    seq = vi.fn();
  let current = true;
  const handlers = createDaemonQueueEvents({
    dispatch,
    getSessionWorkspace: () => 'ws',
    isAgentReadWorkspaceCurrent: () => current,
    observeSubmissionEvidence: observe,
    noteAgentQueueEventSnapshotApplied: seq,
  });
  const event = {
    workspaceId: 'ws',
    type: 'agent:queue:updated',
    data: { agentId: 'a', queue: [row] },
  } as unknown as WorkspaceEvent;
  handlers.handleQueueUpdatedEvent(event);
  expect(dispatch.mock.calls[0][0].payload).toEqual(['a', [row], 'ws']);
  expect(seq).toHaveBeenCalledOnce();
  current = false;
  handlers.handleQueueUpdatedEvent(event);
  handlers.handleQueueProcessingEvent({
    ...event,
    data: { agentId: 'a', messageId: 'q', turnId: 'turn', queuedMessages: [row] },
  } as WorkspaceEvent);
  current = true;
  handlers.handleQueueUpdatedEvent({ ...event, workspaceId: 'other' } as WorkspaceEvent);
  expect(dispatch).toHaveBeenCalledOnce();
  expect(observe).toHaveBeenCalledOnce();
});
it('keeps processing correlation authoritative and rejects malformed consumed batches', () => {
  const dispatch = vi.fn(),
    observe = vi.fn();
  const handlers = createDaemonQueueEvents({
    dispatch,
    getSessionWorkspace: () => 'ws',
    isAgentReadWorkspaceCurrent: () => true,
    observeSubmissionEvidence: observe,
    noteAgentQueueEventSnapshotApplied: vi.fn(),
  });
  const event = {
    workspaceId: 'ws',
    type: 'agent:queue:processing',
    data: { agentId: 'a', messageId: 'q', turnId: 'turn', queuedMessages: [row] },
  } as unknown as WorkspaceEvent;
  handlers.handleQueueProcessingEvent({
    ...event,
    data: { ...event.data, queuedMessages: [row, row] },
  } as WorkspaceEvent);
  expect(dispatch).not.toHaveBeenCalled();
  handlers.handleQueueProcessingEvent(event);
  expect(observe).toHaveBeenCalledWith('a', 'ws', 'processing', [row]);
  expect(dispatch).toHaveBeenCalledOnce();
});
