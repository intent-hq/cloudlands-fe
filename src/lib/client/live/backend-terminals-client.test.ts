import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackendTerminalsClient } from './backend-terminals-client';
import { createBackendRuntime, type BackendRuntime } from './backend-transport-runtime';
import type { BackendTransport } from './backend-transport-types';
import * as transportFactory from './backend-transport-factory';

// Control only the declared boundary; mapping and runtime dispatch stay real.
function fixture() {
  const request =
    vi.fn<(...args: Parameters<BackendRuntime['backendRequest']>) => Promise<unknown>>();
  const backendRequest: BackendRuntime['backendRequest'] = <T>(
    ...args: Parameters<BackendRuntime['backendRequest']>
  ) => request(...args) as Promise<T>;
  return { request, backendRequest, client: createBackendTerminalsClient({ backendRequest }) };
}

afterEach(() => vi.restoreAllMocks());

describe('shared terminal list protocol reads', () => {
  it('is inert until list and maps the boot envelope in received order without mutating it', async () => {
    const { client, request } = fixture();
    expect(request).not.toHaveBeenCalled();
    const wire = Object.freeze({
      terminals: Object.freeze([
        Object.freeze({
          id: 'pty-8',
          name: 'Setup Script',
          cwd: '/workspace',
          isExecutingCommand: false,
        }),
        Object.freeze({
          id: 'pty-2',
          name: 'Terminal',
          cwd: '/workspace',
          isExecutingCommand: true,
        }),
      ]),
      daemonBootId: 'c7f64226-9b60-4122-9fe7-80c682df5923',
    });
    request.mockResolvedValue(wire);

    const result = await client.list('ws-terminal');

    expect(request.mock.calls).toEqual([['terminal.list', { workspaceId: 'ws-terminal' }]]);
    expect(result).toEqual({
      terminals: [
        {
          id: 'pty-8',
          name: 'Setup Script',
          workspaceId: 'ws-terminal',
          createdAt: undefined,
          isConnected: true,
          isExecuting: false,
        },
        {
          id: 'pty-2',
          name: 'Terminal',
          workspaceId: 'ws-terminal',
          createdAt: undefined,
          isConnected: true,
          isExecuting: true,
        },
      ],
      daemonBootId: 'c7f64226-9b60-4122-9fe7-80c682df5923',
    });
    expect(result).not.toBe(wire);
    expect(result.terminals).not.toBe(wire.terminals);
    expect(result.terminals[0]).not.toBe(wire.terminals[0]);
    expect(wire.terminals[0].cwd).toBe('/workspace');
  });

  it('passes through the real backend runtime using only a controlled transport', async () => {
    const { request, backendRequest } = fixture();
    request.mockResolvedValue({
      terminals: [],
      daemonBootId: 'c7f64226-9b60-4122-9fe7-80c682df5923',
    });
    const transport: BackendTransport = {
      isAvailable: () => true,
      request: backendRequest,
      subscribe: () => Promise.reject(new Error('Unexpected subscription')),
      unsubscribe: () => Promise.resolve(),
      onNotification: () => () => {},
      onReconnected: () => () => {},
    };
    vi.spyOn(transportFactory, 'resolveBackendTransport').mockReturnValue(transport);
    const loadPlacement = vi.fn(() => {
      throw new Error('Unexpected placement read');
    });
    const client = createBackendTerminalsClient(createBackendRuntime(loadPlacement));

    expect(await client.list('ws-runtime')).toEqual({
      terminals: [],
      daemonBootId: 'c7f64226-9b60-4122-9fe7-80c682df5923',
    });
    expect(request.mock.calls).toEqual([
      ['terminal.list', { workspaceId: 'ws-runtime' }, undefined],
    ]);
    expect(loadPlacement).not.toHaveBeenCalled();
  });

  it('keeps independent pending clients and fresh boot snapshots separate', async () => {
    const first = fixture();
    const second = fixture();
    let resolveFirst!: (value: unknown) => void;
    first.request.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    second.request.mockResolvedValue({
      terminals: [],
      daemonBootId: '4380920a-c826-4a60-952a-4058f35733c1',
    });
    const pending = first.client.list('ws-first');
    expect(await second.client.list('ws-second')).toEqual({
      terminals: [],
      daemonBootId: '4380920a-c826-4a60-952a-4058f35733c1',
    });
    resolveFirst({ terminals: [], daemonBootId: 'c7f64226-9b60-4122-9fe7-80c682df5923' });
    expect(await pending).toEqual({
      terminals: [],
      daemonBootId: 'c7f64226-9b60-4122-9fe7-80c682df5923',
    });
    first.request.mockResolvedValueOnce({
      terminals: [],
      daemonBootId: '9e394d4f-a48b-4bc1-aa41-c0d5b6bbfa78',
    });
    expect(await first.client.list('ws-first')).toEqual({
      terminals: [],
      daemonBootId: '9e394d4f-a48b-4bc1-aa41-c0d5b6bbfa78',
    });
    expect(first.request.mock.calls).toEqual([
      ['terminal.list', { workspaceId: 'ws-first' }],
      ['terminal.list', { workspaceId: 'ws-first' }],
    ]);
    expect(second.request.mock.calls).toEqual([['terminal.list', { workspaceId: 'ws-second' }]]);
  });

  it.each([new Error('offline'), { code: -32602, message: 'Workspace inaccessible' }])(
    'preserves a rejected request value instead of returning empty tabs: %j',
    async (failure) => {
      const { client, request } = fixture();
      request.mockRejectedValueOnce(failure);
      await expect(client.list('ws-failure')).rejects.toBe(failure);
      expect(request.mock.calls).toEqual([['terminal.list', { workspaceId: 'ws-failure' }]]);
    },
  );

  it('preserves async rejection for a synchronously throwing boundary', async () => {
    const { client, request } = fixture();
    const failure = new Error('synchronous transport failure');
    request.mockImplementation(() => {
      throw failure;
    });
    let pending: Promise<unknown> | undefined;
    expect(() => {
      pending = client.list('ws-sync');
    }).not.toThrow();
    await expect(pending).rejects.toBe(failure);
  });
});

// The pinned protocol retires bare arrays. These cases retain existing source
// compatibility/malformed-input semantics, not new daemon contract claims.
describe('inherited terminal response characterization', () => {
  it('accepts legacy arrays but ignores any array boot property', async () => {
    const { client, request } = fixture();
    request.mockResolvedValue(
      Object.assign([{ id: 'legacy', name: 'Terminal' }], { daemonBootId: 'ignored' }),
    );
    const result = await client.list('ws-legacy');
    expect(result).toEqual({
      terminals: [
        {
          id: 'legacy',
          name: 'Terminal',
          workspaceId: 'ws-legacy',
          createdAt: undefined,
          isConnected: true,
        },
      ],
    });
    expect(Object.hasOwn(result, 'daemonBootId')).toBe(false);
  });

  it.each([undefined, null, 42])('omits a non-string boot value: %j', async (daemonBootId) => {
    const { client, request } = fixture();
    request.mockResolvedValue({ terminals: [], daemonBootId });
    const result = await client.list('ws-boot');
    expect(result).toEqual({ terminals: [] });
    expect(Object.hasOwn(result, 'daemonBootId')).toBe(false);
  });

  it('retains an empty boot string even when the terminals field is malformed', async () => {
    const { client, request } = fixture();
    request.mockResolvedValue({ terminals: 'invalid', daemonBootId: '' });
    expect(await client.list('ws-empty-boot')).toEqual({ terminals: [], daemonBootId: '' });
  });

  it.each([null, undefined, {}, 'invalid'])(
    'folds a missing list without inventing boot metadata: %j',
    async (wire) => {
      const { client, request } = fixture();
      request.mockResolvedValue(wire);
      expect(await client.list('ws-malformed')).toEqual({ terminals: [] });
    },
  );

  it('retains alias precedence, workspace fields, and only typed optional metadata', async () => {
    const { client, request } = fixture();
    request.mockResolvedValue({
      terminals: [
        {
          terminalId: 'alias',
          id: 'ignored',
          workspaceId: '',
          name: 2,
          createdAt: '2026-10-01T00:00:00Z',
          isExecutingCommand: false,
        },
        {
          terminalId: null,
          id: 'fallback',
          workspaceId: 5,
          name: 'Named',
          createdAt: 3,
          isExecutingCommand: 'true',
        },
        { id: 'owned', workspaceId: 'ws-explicit', name: 'Owned' },
      ],
    });
    expect(await client.list('ws-fallback')).toEqual({
      terminals: [
        {
          id: 'alias',
          name: '',
          workspaceId: '',
          createdAt: '2026-10-01T00:00:00Z',
          isConnected: true,
          isExecuting: false,
        },
        {
          id: 'fallback',
          name: 'Named',
          workspaceId: 'ws-fallback',
          createdAt: undefined,
          isConnected: true,
        },
        {
          id: 'owned',
          name: 'Owned',
          workspaceId: 'ws-explicit',
          createdAt: undefined,
          isConnected: true,
        },
      ],
    });
  });

  it('drops invalid entries and empty chosen IDs while preserving numeric IDs and duplicates', async () => {
    const { client, request } = fixture();
    request.mockResolvedValue({
      terminals: [
        null,
        false,
        'invalid',
        {},
        { terminalId: '', id: 'not-a-fallback' },
        { id: 0 },
        { id: 'same' },
        { id: 'same' },
      ],
    });
    expect((await client.list('ws-id')).terminals.map((tab) => tab.id)).toEqual([
      '0',
      'same',
      'same',
    ]);
  });

  it('preserves a normalization getter failure by identity', async () => {
    const { client, request } = fixture();
    const failure = new Error('terminal getter failed');
    request.mockResolvedValue({
      terminals: [
        {
          get terminalId() {
            throw failure;
          },
        },
      ],
    });
    await expect(client.list('ws-getter')).rejects.toBe(failure);
  });
});
