import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackendSkillsClient } from './backend-skills-client';
import { createBackendRuntime, type BackendRuntime } from './backend-transport-runtime';
import type { BackendTransport } from './backend-transport-types';
import * as transportFactory from './backend-transport-factory';

// Only the declared request/transport boundary is controlled. Source subscription
// behavior remains covered by the unchanged LiveSkillsClient suite.
function fixture() {
  const request =
    vi.fn<(...args: Parameters<BackendRuntime['backendRequest']>) => Promise<unknown>>();
  const backendRequest: BackendRuntime['backendRequest'] = <T>(
    ...args: Parameters<BackendRuntime['backendRequest']>
  ) => request(...args) as Promise<T>;
  return { request, backendRequest, client: createBackendSkillsClient({ backendRequest }) };
}

afterEach(() => vi.restoreAllMocks());

describe('shared skill list protocol reads', () => {
  it('is inert until list and normalizes the documented bare array without mutating rows', async () => {
    const { client, request } = fixture();
    expect(request).not.toHaveBeenCalled();
    const wire = Object.freeze([
      Object.freeze({
        name: 'python-expert',
        description: 'Python specialist',
        location: '/user/skills/python/SKILL.md',
        scope: 'user',
      }),
      Object.freeze({
        name: 'typescript-expert',
        description: 'TypeScript specialist',
        location: '/workspace/skills/typescript/SKILL.md',
        scope: 'project',
        resourceDirectory: '/shared/typescript',
        allowedTools: '*',
        compatibility: 'typescript',
      }),
    ] as const);
    request.mockResolvedValue(wire);

    const result = await client.list('ws-skills');

    expect(request.mock.calls).toEqual([['skill.list', { workspaceId: 'ws-skills' }]]);
    expect(result).toEqual([
      {
        name: 'python-expert',
        description: 'Python specialist',
        location: '/user/skills/python/SKILL.md',
        scope: 'user',
      },
      {
        name: 'typescript-expert',
        description: 'TypeScript specialist',
        location: '/workspace/skills/typescript/SKILL.md',
        scope: 'project',
        resourceDirectory: '/shared/typescript',
      },
    ]);
    expect(result).not.toBe(wire);
    expect(result[1]).not.toBe(wire[1]);
    expect(wire[1].allowedTools).toBe('*');
  });

  it('passes through the real backend runtime using only a controlled transport', async () => {
    const { request, backendRequest } = fixture();
    request.mockResolvedValue([
      {
        name: 'agent-skill',
        description: 'Agent tools',
        location: '/skills/agent/SKILL.md',
        scope: 'user',
      },
    ]);
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
    const client = createBackendSkillsClient(createBackendRuntime(loadPlacement));

    expect(await client.list('ws-runtime')).toEqual([
      {
        name: 'agent-skill',
        description: 'Agent tools',
        location: '/skills/agent/SKILL.md',
        scope: 'user',
      },
    ]);
    expect(request.mock.calls).toEqual([['skill.list', { workspaceId: 'ws-runtime' }, undefined]]);
    expect(loadPlacement).not.toHaveBeenCalled();
  });

  it('keeps independent pending clients isolated and reads again instead of caching', async () => {
    const first = fixture();
    const second = fixture();
    let resolveFirst!: (value: unknown) => void;
    first.request.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    second.request.mockResolvedValueOnce([]);
    const pending = first.client.list('ws-first');
    expect(await second.client.list('ws-second')).toEqual([]);
    resolveFirst([{ name: 'a', description: 'A', location: '/a/SKILL.md', scope: 'project' }]);
    expect(await pending).toEqual([
      { name: 'a', description: 'A', location: '/a/SKILL.md', scope: 'project' },
    ]);
    first.request.mockResolvedValueOnce([]);
    expect(await first.client.list('ws-first')).toEqual([]);
    expect(first.request.mock.calls).toEqual([
      ['skill.list', { workspaceId: 'ws-first' }],
      ['skill.list', { workspaceId: 'ws-first' }],
    ]);
    expect(second.request.mock.calls).toEqual([['skill.list', { workspaceId: 'ws-second' }]]);
  });

  it.each([new Error('offline'), { code: -32602, message: 'Workspace inaccessible' }])(
    'preserves a rejected request value instead of returning an empty successful list: %j',
    async (failure) => {
      const { client, request } = fixture();
      request.mockRejectedValueOnce(failure);
      await expect(client.list('ws-failure')).rejects.toBe(failure);
      expect(request.mock.calls).toEqual([['skill.list', { workspaceId: 'ws-failure' }]]);
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

// These inputs are outside the pinned daemon contract. They characterize inherited
// source normalization only; they do not authorize a new wire shape or FE repair.
describe('inherited skill response characterization', () => {
  it.each([null, undefined, { skills: [] }, 'invalid'])(
    'folds a non-array response to empty: %j',
    async (wire) => {
      const { client, request } = fixture();
      request.mockResolvedValue(wire);
      expect(await client.list('ws-malformed')).toEqual([]);
    },
  );

  it('preserves received order and duplicate names without sorting or deduplicating', async () => {
    const { client, request } = fixture();
    request.mockResolvedValue([
      { name: 'z', description: 'First', location: '/z1', scope: 'user' },
      { name: 'a', description: 'Second', location: '/a', scope: 'project' },
      { name: 'z', description: 'Third', location: '/z2', scope: 'project' },
    ]);
    expect((await client.list('ws-order')).map((skill) => skill.location)).toEqual([
      '/z1',
      '/a',
      '/z2',
    ]);
  });

  it('omits an empty resourceDirectory and preserves missing required values', async () => {
    const { client, request } = fixture();
    request.mockResolvedValue([{ name: 'partial', resourceDirectory: '' }]);
    const result = await client.list('ws-partial');
    expect(result).toEqual([
      { name: 'partial', description: undefined, location: undefined, scope: undefined },
    ]);
    expect(Object.hasOwn(result[0]!, 'resourceDirectory')).toBe(false);
  });

  it.each([null, undefined])(
    'rejects a nullish row rather than silently dropping it: %j',
    async (wire) => {
      const { client, request } = fixture();
      request.mockResolvedValue([wire]);
      await expect(client.list('ws-row')).rejects.toBeInstanceOf(TypeError);
    },
  );

  it('preserves a normalization getter failure by identity', async () => {
    const { client, request } = fixture();
    const failure = new Error('name getter failed');
    request.mockResolvedValue([
      {
        get name() {
          throw failure;
        },
      },
    ]);
    await expect(client.list('ws-getter')).rejects.toBe(failure);
  });
});
