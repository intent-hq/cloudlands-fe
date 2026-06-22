import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceEvent } from '../../../../../features/events/types';
import {
  clearDeliveryDedupCache,
  clearDeliveryDedupCacheForWorkspace,
  filterAlreadyDelivered,
  recordDeliveredEventIds,
} from './delivery-saga';
import {
  clearAllCaches,
  clearWorkspaceCache,
  isDuplicateEvent,
} from '../../workspace-events/dedup-cache';
import {
  clearEventStoreCache,
  deleteEventStoreForWorkspace,
  getOrCreateEventStore,
} from '../../workspace-events/sagas/persistence-saga';

const CACHE_LIFECYCLE_MATRIX = [
  {
    name: 'delivery dedup',
    scope: 'workspaceId -> agentId -> eventId',
    cleanup: 'clearDeliveryDedupCacheForWorkspace(wsId)',
  },
  {
    name: 'workspace event dedup',
    scope: 'workspaceId -> event key',
    cleanup: 'clearWorkspaceCache(wsId)',
  },
  {
    name: 'event store cache',
    scope: 'workspaceId -> EventStore',
    cleanup: 'deleteEventStoreForWorkspace(wsId)',
  },
] as const;

function event(wsId: string, id: string): WorkspaceEvent {
  return {
    id,
    workspaceId: wsId,
    type: 'agent:idle',
    actor: { type: 'agent', id: 'agent-1' },
    timestamp: '2026-06-19T00:00:00.000Z',
    data: { id },
  } as WorkspaceEvent;
}

describe('main-process cache lifecycle matrix', () => {
  afterEach(() => {
    clearDeliveryDedupCache();
    clearAllCaches();
    clearEventStoreCache();
  });

  it('documents the expected cache scopes and cleanup hooks', () => {
    expect(CACHE_LIFECYCLE_MATRIX).toEqual([
      expect.objectContaining({
        name: 'delivery dedup',
        scope: 'workspaceId -> agentId -> eventId',
      }),
      expect.objectContaining({ name: 'workspace event dedup', scope: 'workspaceId -> event key' }),
      expect.objectContaining({ name: 'event store cache', scope: 'workspaceId -> EventStore' }),
    ]);
  });

  it('keeps delivery dedup isolated by workspace and clears one workspace at a time', () => {
    const ws1Event = event('ws-1', 'same-id');
    const ws2Event = event('ws-2', 'same-id');
    recordDeliveredEventIds('ws-1', 'agent-1', [ws1Event.id]);
    recordDeliveredEventIds('ws-2', 'agent-1', [ws2Event.id]);

    clearDeliveryDedupCacheForWorkspace('ws-1');

    expect(filterAlreadyDelivered('ws-1', 'agent-1', [ws1Event])).toEqual([ws1Event]);
    expect(filterAlreadyDelivered('ws-2', 'agent-1', [ws2Event])).toEqual([]);
  });

  it('keeps workspace event dedup isolated by workspace and clears one workspace', () => {
    const ws1Event = event('ws-1', 'event-a');
    const ws2Event = event('ws-2', 'event-a');
    expect(isDuplicateEvent(ws1Event, 1_000)).toBe(false);
    expect(isDuplicateEvent(ws2Event, 1_000)).toBe(false);
    expect(isDuplicateEvent(ws1Event, 1_100)).toBe(true);
    expect(isDuplicateEvent(ws2Event, 1_100)).toBe(true);

    clearWorkspaceCache('ws-1');

    expect(isDuplicateEvent(ws1Event, 1_200)).toBe(false);
    expect(isDuplicateEvent(ws2Event, 1_200)).toBe(true);
  });

  it('disposes and recreates one cached EventStore without clearing other workspaces', async () => {
    class FakeEventStore {
      disposed = false;
      constructor(
        public readonly workspaceId: string,
        public readonly options: unknown,
      ) {}
      async dispose() {
        this.disposed = true;
      }
    }

    const ws1Store = getOrCreateEventStore('ws-1', '/tmp/ws-1', FakeEventStore);
    const ws2Store = getOrCreateEventStore('ws-2', '/tmp/ws-2', FakeEventStore);
    expect(getOrCreateEventStore('ws-1', '/tmp/ws-1', FakeEventStore)).toBe(ws1Store);

    await deleteEventStoreForWorkspace('ws-1');

    expect(ws1Store.disposed).toBe(true);
    expect(getOrCreateEventStore('ws-2', '/tmp/ws-2', FakeEventStore)).toBe(ws2Store);
    expect(getOrCreateEventStore('ws-1', '/tmp/ws-1', FakeEventStore)).not.toBe(ws1Store);
  });
});
