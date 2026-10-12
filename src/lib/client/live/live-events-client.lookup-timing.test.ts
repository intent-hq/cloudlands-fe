import { describe, expect, it, vi } from 'vitest';
import type { BackendRuntime } from './backend-transport-runtime';

const wireEvents = [
  {
    id: 'evt-new',
    workspaceId: 'ws-events',
    timestamp: '2026-06-17T12:01:00Z',
    type: 'file:changed',
    actor: { type: 'agent', id: 'agent-1' },
    data: { relativePath: 'src/new.ts' },
  },
  {
    id: 'evt-old',
    workspaceId: 'ws-events',
    timestamp: '2026-06-17T12:00:00Z',
    type: 'file:changed',
    actor: { type: 'agent', id: 'agent-1' },
    data: { relativePath: 'src/old.ts' },
  },
];

describe('legacy event transport lookup timing', () => {
  it('imports and constructs without reading transport, then uses the current request on each read', async () => {
    vi.resetModules();
    let lookups = 0;
    const first = vi.fn<BackendRuntime['backendRequest']>();
    const second = vi.fn<BackendRuntime['backendRequest']>();
    let current = first;
    vi.doMock('./backend-transport', () => ({
      get backendRequest() {
        lookups += 1;
        return current;
      },
    }));
    try {
      const { LiveEventsClient } = await import('./live-events-client');
      const client = new LiveEventsClient();
      expect(lookups).toBe(0);
      first.mockResolvedValue(wireEvents);
      expect(await client.query('first')).toBe(wireEvents);
      expect(first).toHaveBeenCalledExactlyOnceWith('event.query', { workspaceId: 'first' });
      current = second;
      const page = { items: wireEvents, nextToken: null };
      second.mockResolvedValue(page);
      const pending = client.queryPage('second', { nextToken: 'older' });
      expect(second).toHaveBeenCalledExactlyOnceWith('event.query', {
        workspaceId: 'second',
        nextToken: 'older',
        paginate: true,
      });
      expect(first).toHaveBeenCalledOnce();
      expect(await pending).toBe(page);
      expect(lookups).toBe(2);
    } finally {
      vi.doUnmock('./backend-transport');
      vi.resetModules();
    }
  });

  it('turns a call-time transport getter failure into the same rejected query Promise', async () => {
    vi.resetModules();
    const failure = new Error('transport export unavailable at call time');
    vi.doMock('./backend-transport', () => ({
      get backendRequest() {
        throw failure;
      },
    }));
    try {
      const { LiveEventsClient } = await import('./live-events-client');
      const client = new LiveEventsClient();
      await expect(client.query('events')).rejects.toBe(failure);
      await expect(client.queryPage('events')).rejects.toBe(failure);
    } finally {
      vi.doUnmock('./backend-transport');
      vi.resetModules();
    }
  });
});

describe('legacy event callee lookup before argument evaluation', () => {
  it.each(['query', 'queryPage'] as const)('preserves lookup order for %s', async (method) => {
    vi.resetModules();
    const trace: string[] = [];
    const firstReply = method === 'query' ? wireEvents : { items: wireEvents, nextToken: 'first' };
    const secondReply = method === 'query' ? [] : { items: [], nextToken: null };
    const first = vi.fn(async () => {
      trace.push('first-call');
      return firstReply;
    });
    const second = vi.fn(async () => {
      trace.push('second-call');
      return secondReply;
    });
    let current: () => Promise<unknown> = first;
    vi.doMock('./backend-transport', () => ({
      get backendRequest() {
        trace.push('lookup');
        return current;
      },
    }));
    try {
      const { LiveEventsClient } = await import('./live-events-client');
      const client = new LiveEventsClient();
      expect(trace).toEqual([]);
      const options = {
        get limit() {
          trace.push('options');
          current = second;
          return 17;
        },
      };
      expect(await client[method]('events', options)).toBe(firstReply);
      expect(trace).toEqual(['lookup', 'options', 'first-call']);
      expect(first).toHaveBeenCalledExactlyOnceWith('event.query', {
        workspaceId: 'events',
        limit: 17,
        ...(method === 'queryPage' ? { paginate: true } : {}),
      });
      expect(second).not.toHaveBeenCalled();
      trace.length = 0;
      expect(await client[method]('later')).toBe(secondReply);
      expect(trace).toEqual(['lookup', 'second-call']);
      expect(second).toHaveBeenCalledExactlyOnceWith('event.query', {
        workspaceId: 'later',
        ...(method === 'queryPage' ? { paginate: true } : {}),
      });
      expect(first).toHaveBeenCalledOnce();
    } finally {
      vi.doUnmock('./backend-transport');
      vi.resetModules();
    }
  });
});
