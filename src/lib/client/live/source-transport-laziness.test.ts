import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendRuntime } from './backend-transport-runtime';

type Transport = Pick<
  BackendRuntime,
  | 'backendRequest'
  | 'captureBackendRepositoryCheckout'
  | 'captureBackendRepositoryResource'
  | 'onBackendNotification'
  | 'onBackendReconnected'
>;
type Request = (...args: Parameters<Transport['backendRequest']>) => Promise<unknown>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function transportFixture() {
  const capabilities: Partial<Transport> = {};
  const reads: (keyof Transport)[] = [];
  const unavailable = new Error('Capability used before installation');
  function read<K extends keyof Transport>(key: K): Transport[K] {
    reads.push(key);
    const capability = capabilities[key];
    if (capability === undefined) throw unavailable;
    return capability;
  }
  vi.doMock('./backend-transport', () => ({
    get backendRequest() {
      return read('backendRequest');
    },
    get captureBackendRepositoryCheckout() {
      return read('captureBackendRepositoryCheckout');
    },
    get captureBackendRepositoryResource() {
      return read('captureBackendRepositoryResource');
    },
    get onBackendNotification() {
      return read('onBackendNotification');
    },
    get onBackendReconnected() {
      return read('onBackendReconnected');
    },
  }));
  function request(implementation: Request) {
    // The only fixture cast adapts scripted wire data to the declared generic boundary.
    capabilities.backendRequest = function <T>(
      this: unknown,
      ...args: Parameters<Transport['backendRequest']>
    ) {
      return Reflect.apply(implementation, this, args) as Promise<T>;
    };
  }
  return { capabilities, reads, request, unavailable };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.doUnmock('./backend-transport'));

describe('legacy source transport lookup', () => {
  it('imports and constructs clients before any transport capability is installed', async () => {
    const transport = transportFixture();
    const { LiveIntegrationsClient } = await import('./live-integrations-client');
    const { LiveAgentsClient } = await import('./live-agents-client');
    await import('./live-support');
    new LiveIntegrationsClient();
    new LiveIntegrationsClient();
    new LiveAgentsClient();
    new LiveAgentsClient();
    expect(transport.reads).toEqual([]);
  });

  it('looks up requests for each operation while concurrent clients retain their own replies', async () => {
    const transport = transportFixture();
    const { LiveIntegrationsClient } = await import('./live-integrations-client');
    const { LiveAgentsClient } = await import('./live-agents-client');
    const integrations = new LiveIntegrationsClient();
    const agents = new LiveAgentsClient();
    const first = deferred<unknown>();
    const requestA = vi.fn<Request>(() => first.promise);
    const requestB = vi.fn<Request>(() => Promise.resolve({ agent: null }));
    transport.request(requestA);
    const pendingUser = integrations.githubUser();
    transport.request(requestB);
    expect(await agents.get('agent-a', 'workspace-a')).toBeNull();
    first.resolve({ user: { login: 'octocat', avatarUrl: 'https://example.test/avatar' } });
    expect(await pendingUser).toEqual({
      login: 'octocat',
      name: null,
      email: null,
      avatar_url: 'https://example.test/avatar',
    });
    expect(await integrations.githubUser('workspace-b')).toBeNull();
    expect(requestA.mock.calls).toEqual([['github.getUser']]);
    expect(requestB.mock.calls).toEqual([
      ['agent.get', { agentId: 'agent-a', workspaceId: 'workspace-a' }],
      ['github.getUser', { workspaceId: 'workspace-b' }],
    ]);
    expect(requestA.mock.contexts).toEqual([undefined]);
    expect(requestB.mock.contexts).toEqual([undefined, undefined]);
    expect(transport.reads).toEqual(['backendRequest', 'backendRequest', 'backendRequest']);
  });

  it.each(['checkout', 'resource'] as const)(
    'forwards the original %s Promise and synchronous error without adding an async boundary',
    async (kind) => {
      const transport = transportFixture();
      const { LiveIntegrationsClient } = await import('./live-integrations-client');
      const client = new LiveIntegrationsClient();
      const pending = deferred<never>();
      const failure = new Error('capture failed');
      const query = { provider: 'gitlab' as const };
      const capture = vi.fn(() => pending.promise);
      const invoke =
        kind === 'checkout'
          ? () => client.captureRepositoryCheckout(query)
          : () => client.captureRepositoryResource('workspace-a');
      if (kind === 'checkout') transport.capabilities.captureBackendRepositoryCheckout = capture;
      else transport.capabilities.captureBackendRepositoryResource = capture;
      const result = invoke();
      expect(result).toBe(pending.promise);
      expect(capture.mock.calls).toEqual([kind === 'checkout' ? [query] : ['workspace-a']]);
      expect(capture.mock.contexts).toEqual([undefined]);
      const rejected = expect(result).rejects.toBe(failure);
      pending.reject(failure);
      await rejected;
      capture.mockImplementation(() => {
        throw failure;
      });
      expect(invoke).toThrow(failure);
      expect(transport.reads).toEqual([
        kind === 'checkout'
          ? 'captureBackendRepositoryCheckout'
          : 'captureBackendRepositoryResource',
        kind === 'checkout'
          ? 'captureBackendRepositoryCheckout'
          : 'captureBackendRepositoryResource',
      ]);
    },
  );

  it('keeps operation-specific error handling when a required export is unavailable', async () => {
    const transport = transportFixture();
    const { LiveIntegrationsClient } = await import('./live-integrations-client');
    const { LiveAgentsClient } = await import('./live-agents-client');
    const client = new LiveIntegrationsClient();
    expect(await client.githubUser()).toBeNull();
    await expect(client.githubBranches('owner', 'repo', 'prefix')).rejects.toBe(
      transport.unavailable,
    );
    await expect(new LiveAgentsClient().get('agent-a')).rejects.toBe(transport.unavailable);
    expect(transport.reads).toEqual(['backendRequest', 'backendRequest', 'backendRequest']);
  });

  it('keeps the canonical mutation options, result, and catch behavior with late request lookup', async () => {
    const transport = transportFixture();
    const { runMutation } = await import('./live-support');
    expect(transport.reads).toEqual([]);
    const requestA = vi.fn<Request>(() => Promise.resolve({ noteRev: 12 }));
    transport.request(requestA);
    expect(await runMutation('comment.add', { noteId: 'note-a' })).toEqual({
      success: true,
      noteRev: 12,
    });
    const requestB = vi.fn<Request>(() => Promise.resolve({}));
    transport.request(requestB);
    const options = { timeoutMs: 90000 };
    expect(await runMutation('workspace.delete', { workspaceId: 'workspace-a' }, options)).toEqual({
      success: true,
    });
    expect(requestA.mock.calls).toEqual([['comment.add', { noteId: 'note-a' }]]);
    expect(requestB.mock.calls).toEqual([
      ['workspace.delete', { workspaceId: 'workspace-a' }, options],
    ]);
    expect(requestB.mock.calls[0]?.[2]).toBe(options);
    expect(requestA.mock.contexts).toEqual([undefined]);
    expect(requestB.mock.contexts).toEqual([undefined]);
    requestB.mockImplementation(() => {
      throw new Error('synchronous request failure');
    });
    expect(await runMutation('comment.add', {})).toEqual({
      success: false,
      error: 'synchronous request failure',
    });
    requestB.mockRejectedValue(new Error('asynchronous request failure'));
    expect(await runMutation('comment.add', {})).toEqual({
      success: false,
      error: 'asynchronous request failure',
    });
    expect(transport.reads).toEqual(Array(4).fill('backendRequest'));
  });

  it.each(['success', 'throwing getter'] as const)(
    'resolves agent list dependencies after original option reads: %s',
    async (mode) => {
      const transport = transportFixture();
      const { LiveAgentsClient } = await import('./live-agents-client');
      const order: string[] = [];
      const failure = new Error('option read failed');
      const request = vi.fn<Request>(() => {
        order.push('request');
        return Promise.resolve({ agents: [], retiredCount: 0 });
      });
      const options = {
        get retiredOnly() {
          order.push('retiredOnly');
          if (mode === 'throwing getter') throw failure;
          transport.request(request);
          return false;
        },
        get scope() {
          order.push('scope');
          return 'topLevel' as const;
        },
        get parentAgentId() {
          order.push('parentAgentId');
          return undefined;
        },
        get orphanedOnly() {
          order.push('orphanedOnly');
          return false;
        },
      };
      const pending = new LiveAgentsClient().listWithMeta('workspace-a', options);
      if (mode === 'throwing getter') {
        await expect(pending).rejects.toBe(failure);
        expect(order).toEqual(['retiredOnly']);
        expect(transport.reads).toEqual([]);
        expect(request).not.toHaveBeenCalled();
      } else {
        expect(await pending).toEqual({ agents: [], retiredCount: 0 });
        expect(order).toEqual([
          'retiredOnly',
          'scope',
          'scope',
          'scope',
          'parentAgentId',
          'orphanedOnly',
          'request',
        ]);
        expect(transport.reads).toEqual(['backendRequest']);
        expect(request.mock.calls).toEqual([
          ['agent.list', { workspaceId: 'workspace-a', scope: 'topLevel' }],
        ]);
      }
    },
  );

  it('looks up the integration request again after the auth probe resolves', async () => {
    const transport = transportFixture();
    const { LiveIntegrationsClient } = await import('./live-integrations-client');
    const auth = deferred<unknown>();
    const requestA = vi.fn<Request>(() => auth.promise);
    const issues: never[] = [];
    const requestB = vi.fn<Request>(() => Promise.resolve({ issues }));
    transport.request(requestA);
    const pending = new LiveIntegrationsClient().linearIssues('workspace-a');
    transport.request(requestB);
    auth.resolve({ authenticated: true });
    expect(await pending).toBe(issues);
    expect(requestA.mock.calls).toEqual([['linear.authStatus', { workspaceId: 'workspace-a' }]]);
    expect(requestB.mock.calls).toEqual([['linear.listIssues', { workspaceId: 'workspace-a' }]]);
    expect(requestA.mock.contexts).toEqual([undefined]);
    expect(requestB.mock.contexts).toEqual([undefined]);
    expect(transport.reads).toEqual(['backendRequest', 'backendRequest']);
  });

  it('shares the existing workspace seed across source subscribers and releases each listener owner', async () => {
    const transport = transportFixture();
    const { LiveAgentsClient } = await import('./live-agents-client');
    const pending = deferred<unknown>();
    const request = vi.fn<Request>(() => pending.promise);
    const notifications = new Set<Parameters<Transport['onBackendNotification']>[0]>();
    const reconnects = new Set<Parameters<Transport['onBackendReconnected']>[0]>();
    const off = vi.fn<(callback: unknown) => void>();
    transport.request(request);
    transport.capabilities.onBackendNotification = vi.fn((handler) => {
      notifications.add(handler);
      return () => {
        notifications.delete(handler);
        off(handler);
      };
    });
    transport.capabilities.onBackendReconnected = vi.fn((handler) => {
      reconnects.add(handler);
      return () => {
        reconnects.delete(handler);
        off(handler);
      };
    });
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    let stopA: (() => void) | undefined;
    let stopB: (() => void) | undefined;
    try {
      stopA = new LiveAgentsClient().subscribe(handlerA);
      stopB = new LiveAgentsClient().subscribe(handlerB);
      expect(request.mock.calls).toEqual([['workspace.list']]);
      // Two channel owners and the one shared workspace-id owner.
      expect(notifications.size).toBe(3);
      expect(reconnects.size).toBe(3);
      stopA();
      stopA = undefined;
      expect(notifications.size).toBe(2);
      expect(reconnects.size).toBe(2);
      expect(off).toHaveBeenCalledTimes(2);
      stopB();
      stopB = undefined;
      expect(notifications.size).toBe(0);
      expect(reconnects.size).toBe(0);
      expect(off).toHaveBeenCalledTimes(6);
      expect(new Set(off.mock.calls.map(([callback]) => callback)).size).toBe(6);
      expect(handlerA).not.toHaveBeenCalled();
      expect(handlerB).not.toHaveBeenCalled();
      expect(transport.reads).not.toContain('captureBackendRepositoryCheckout');
      expect(transport.reads).not.toContain('captureBackendRepositoryResource');
    } finally {
      stopA?.();
      stopB?.();
      pending.resolve({ workspaces: [] });
      await pending.promise;
    }
  });
});
