import { describe, expect, it, vi } from 'vitest';
import type { BackendRuntime } from './backend-transport-runtime';
import { createBackendEventsClient } from './backend-events-client';

// Exercise the canonical factory at its declared request boundary. The unchanged
// LiveEventsClient suite covers source list reversal and initial subscriptions.
function fixture() {
  const backendRequest = vi.fn<BackendRuntime['backendRequest']>();
  const request: BackendRuntime['backendRequest'] = <T>(
    ...args: Parameters<BackendRuntime['backendRequest']>
  ): Promise<T> => backendRequest(...args) as Promise<T>;
  return { client: createBackendEventsClient({ backendRequest: request }), backendRequest };
}

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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

describe('shared historical event reads', () => {
  it('preserves the wire array and newest-first order without changing rows', async () => {
    const { client, backendRequest } = fixture();
    backendRequest.mockResolvedValue(wireEvents);
    const result = await client.query('ws-events');
    expect(backendRequest.mock.calls).toEqual([['event.query', { workspaceId: 'ws-events' }]]);
    expect(result).toBe(wireEvents);
    expect(result.map((event) => event.id)).toEqual(['evt-new', 'evt-old']);
    expect(result[0]).toBe(wireEvents[0]);
  });

  it('passes all filters including explicit zero and empty values', async () => {
    const { client, backendRequest } = fixture();
    backendRequest.mockResolvedValue([]);
    const options = {
      eventType: 'file:changed',
      actorType: 'agent',
      actorId: '',
      path: 'src/日本語.ts',
      minutesAgo: 0,
      limit: 0,
    };
    await client.query('ws-events', options);
    expect(backendRequest.mock.calls).toEqual([
      [
        'event.query',
        {
          workspaceId: 'ws-events',
          eventType: 'file:changed',
          actorType: 'agent',
          actorId: '',
          path: 'src/日本語.ts',
          minutesAgo: 0,
          limit: 0,
        },
      ],
    ]);
    expect(options).toEqual({
      eventType: 'file:changed',
      actorType: 'agent',
      actorId: '',
      path: 'src/日本語.ts',
      minutesAgo: 0,
      limit: 0,
    });
  });

  it.each([undefined, null, {}, { items: wireEvents, nextToken: null }])(
    'retains the inherited non-array query fallback for %j',
    async (response) => {
      const { client, backendRequest } = fixture();
      backendRequest.mockResolvedValue(response);
      expect(await client.query('ws-events')).toEqual([]);
      expect(backendRequest.mock.calls).toEqual([['event.query', { workspaceId: 'ws-events' }]]);
    },
  );

  it('opts into pagination by default and returns the same complete envelope', async () => {
    const { client, backendRequest } = fixture();
    const response = { items: wireEvents, nextToken: 'older-page' };
    backendRequest.mockResolvedValue(response);
    expect(await client.queryPage('ws-events')).toBe(response);
    expect(backendRequest.mock.calls).toEqual([
      [
        'event.query',
        {
          workspaceId: 'ws-events',
          paginate: true,
        },
      ],
    ]);
    expect(response.items.map((event) => event.id)).toEqual(['evt-new', 'evt-old']);
  });

  it.each(['older-token', ''])(
    'preserves cursor %j and the terminal null cursor',
    async (nextToken) => {
      const { client, backendRequest } = fixture();
      const response = { items: [], nextToken: null };
      backendRequest.mockResolvedValue(response);
      expect(await client.queryPage('ws-events', { nextToken, limit: 100 })).toBe(response);
      expect(backendRequest.mock.calls).toEqual([
        [
          'event.query',
          {
            workspaceId: 'ws-events',
            nextToken,
            limit: 100,
            paginate: true,
          },
        ],
      ]);
    },
  );

  it('keeps paginate true after an untyped extra option without mutating it', async () => {
    const { client, backendRequest } = fixture();
    const options = { limit: 20, paginate: false };
    backendRequest.mockResolvedValue({ items: [], nextToken: null });
    await client.queryPage('ws-events', options);
    expect(backendRequest.mock.calls).toEqual([
      [
        'event.query',
        {
          workspaceId: 'ws-events',
          limit: 20,
          paginate: true,
        },
      ],
    ]);
    expect(options.paginate).toBe(false);
  });

  it.each(['query', 'queryPage'] as const)(
    'preserves rejection identity for %s',
    async (method) => {
      const { client, backendRequest } = fixture();
      const error = new Error('Historical read refused');
      backendRequest.mockRejectedValue(error);
      await expect(client[method]('ws-events')).rejects.toBe(error);
      expect(backendRequest.mock.calls).toEqual([
        [
          'event.query',
          method === 'query'
            ? { workspaceId: 'ws-events' }
            : { workspaceId: 'ws-events', paginate: true },
        ],
      ]);
    },
  );

  it('keeps independently pending reads on their supplied backend until each reply', async () => {
    const left = fixture();
    const right = fixture();
    const leftReply = deferred();
    const rightReply = deferred();
    left.backendRequest.mockReturnValue(leftReply.promise);
    right.backendRequest.mockReturnValue(rightReply.promise);
    let leftSettled = false;
    const leftRead = left.client.queryPage('ws-left').then((value) => {
      leftSettled = true;
      return value;
    });
    const rightRead = right.client.queryPage('ws-right', { nextToken: 'right-older' });
    const rightPage = { items: [], nextToken: null };
    rightReply.resolve(rightPage);
    expect(await rightRead).toBe(rightPage);
    expect(leftSettled).toBe(false);
    const leftPage = { items: wireEvents, nextToken: 'left-older' };
    leftReply.resolve(leftPage);
    expect(await leftRead).toBe(leftPage);
    expect(left.backendRequest.mock.calls).toEqual([
      [
        'event.query',
        {
          workspaceId: 'ws-left',
          paginate: true,
        },
      ],
    ]);
    expect(right.backendRequest.mock.calls).toEqual([
      [
        'event.query',
        {
          workspaceId: 'ws-right',
          nextToken: 'right-older',
          paginate: true,
        },
      ],
    ]);
  });
});
