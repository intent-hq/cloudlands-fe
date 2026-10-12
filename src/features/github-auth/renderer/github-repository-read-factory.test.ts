// Required transport/invoke delivery only; malformed cases characterize the source route.
import { describe, expect, it, vi } from 'vitest';
import type { BackendRuntime } from '../../../lib/client/live/backend-transport-runtime';
import {
  createGithubRepositoryClient,
  createGithubRepositoryReadHandler,
} from './github-repository-read-factory';

type Envelope = { success: boolean; data?: import('../types').GithubRepo[]; error?: string };
function readFixture(
  implementation: (...args: Parameters<BackendRuntime['backendRequest']>) => Promise<unknown>,
) {
  const request = vi.fn(implementation);
  const read = createGithubRepositoryReadHandler({
    backendRequest: <T>(...args: Parameters<BackendRuntime['backendRequest']>) =>
      request(...args) as Promise<T>,
  });
  return { request, read };
}
function clientFixture(response: unknown) {
  const invoke = vi.fn((_channel: string, _params: unknown) => Promise.resolve(response));
  // The test controls delivery, including intentionally malformed envelopes.
  const client = createGithubRepositoryClient({
    invoke: (channel, params) => invoke(channel, params) as Promise<Envelope>,
  });
  return { client, invoke };
}

describe('canonical GitHub repository list route', () => {
  it('is inert at construction and omits the backend argument when no workspace is provided', async () => {
    const f = readFixture(async () => ({ repos: [] }));
    expect(f.request).not.toHaveBeenCalled();
    expect(await f.read(undefined)).toEqual({ success: true, data: [] });
    expect(f.request.mock.calls).toEqual([['github.repos.list']]);
  });

  it.each(['workspace-a', ''] as const)(
    'forwards the exact provided workspace %j and ignores legacy page',
    async (workspaceId) => {
      const f = readFixture(async () => ({ repos: [] }));
      await f.read({ workspaceId, page: 12 });
      expect(f.request.mock.calls).toEqual([['github.repos.list', { workspaceId }]]);
    },
  );

  it.each([null, 0, 'workspace', {}, { workspaceId: null }, { workspaceId: 7 }] as const)(
    'retains argument omission for invalid or absent workspace in %j',
    async (arg) => {
      const f = readFixture(async () => ({ repos: [] }));
      await f.read(arg);
      expect(f.request.mock.calls).toEqual([['github.repos.list']]);
    },
  );

  it('reads a present workspace getter twice before invoking and uses the second value', async () => {
    const order: string[] = [];
    let count = 0;
    const f = readFixture(async (...args) => {
      order.push('request');
      return { repos: [], args };
    });
    await f.read({
      get workspaceId() {
        order.push('workspace');
        return ++count === 1 ? 'first' : 'second';
      },
    });
    expect(order).toEqual(['workspace', 'workspace', 'request']);
    expect(f.request.mock.calls).toEqual([['github.repos.list', { workspaceId: 'second' }]]);
  });

  it('retains an explicit empty params object when the second workspace read becomes invalid', async () => {
    let count = 0;
    const f = readFixture(async () => ({ repos: [] }));
    await f.read({
      get workspaceId() {
        return ++count === 1 ? 'first' : undefined;
      },
    });
    expect(count).toBe(2);
    expect(f.request.mock.calls).toEqual([['github.repos.list', {}]]);
  });

  it('short-circuits after one undefined workspace getter and never reads page', async () => {
    let count = 0;
    const f = readFixture(async () => ({ repos: [] }));
    await f.read({
      get workspaceId() {
        count++;
        return undefined;
      },
      get page() {
        throw new Error('page must be ignored');
      },
    });
    expect(count).toBe(1);
    expect(f.request.mock.calls).toEqual([['github.repos.list']]);
  });

  it.each([1, 2])(
    'folds an error from workspace getter read %i before any request',
    async (failAt) => {
      let count = 0;
      const f = readFixture(async () => ({ repos: [] }));
      const result = await f.read({
        get workspaceId() {
          if (++count === failAt) throw new Error('workspace getter failed');
          return 'workspace';
        },
      });
      expect(result).toEqual({ success: false, error: 'workspace getter failed' });
      expect(count).toBe(failAt);
      expect(f.request).not.toHaveBeenCalled();
    },
  );

  it('maps six legacy fields in response order, without forwarding unknown wire fields', async () => {
    const f = readFixture(async () => ({
      repos: [
        {
          owner: 'alpha',
          name: 'one',
          htmlUrl: 'https://example.test/one',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          defaultBranch: 'trunk',
          ignored: true,
        },
        { owner: 'beta', name: 'two' },
      ],
      nextToken: 'not-a-legacy-page',
    }));
    expect(await f.read({ page: 9 })).toEqual({
      success: true,
      data: [
        {
          owner: 'alpha',
          name: 'one',
          html_url: 'https://example.test/one',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
          default_branch: 'trunk',
        },
        {
          owner: 'beta',
          name: 'two',
          html_url: undefined,
          created_at: undefined,
          updated_at: undefined,
          default_branch: undefined,
        },
      ],
    });
  });

  it('preserves mapper getter chronology and folds the first thrown property error', async () => {
    const order: string[] = [];
    const row = {
      get owner() {
        order.push('owner');
        return 'owner';
      },
      get name() {
        order.push('name');
        return 'repo';
      },
      get htmlUrl() {
        order.push('htmlUrl');
        throw new Error('row property failed');
      },
      get createdAt() {
        order.push('createdAt');
        return 'never';
      },
    };
    const f = readFixture(async () => ({ repos: [row] }));
    expect(await f.read(undefined)).toEqual({ success: false, error: 'row property failed' });
    expect(order).toEqual(['owner', 'name', 'htmlUrl']);
  });

  it.each([undefined, null, {}, { repos: null }] as const)(
    'uses the existing nullish fallback for %j',
    async (wire) => {
      const f = readFixture(async () => wire);
      expect(await f.read(undefined)).toEqual({ success: true, data: [] });
    },
  );

  it.each([{ repos: false }, { repos: {} }, { repos: [null] }] as const)(
    'folds malformed map/row failure for %j instead of silently normalizing',
    async (wire) => {
      const f = readFixture(async () => wire);
      const result = await f.read(undefined);
      expect(result.success).toBe(false);
      expect(result.error).toEqual(expect.any(String));
      expect(result).not.toHaveProperty('data');
    },
  );

  it.each(['throw', 'reject'] as const)(
    'folds an ordinary backend %s into an unsuccessful envelope',
    async (mode) => {
      const f = readFixture(() => {
        if (mode === 'throw') throw new Error('backend failed');
        return Promise.reject(new Error('backend failed'));
      });
      expect(await f.read(undefined)).toEqual({ success: false, error: 'backend failed' });
    },
  );

  it('retains String folding for a non-Error rejection', async () => {
    const f = readFixture(() => Promise.reject('backend string failure'));
    expect(await f.read(undefined)).toEqual({ success: false, error: 'backend string failure' });
  });

  it('propagates an error thrown by the existing error string conversion', async () => {
    const conversionError = new Error('string conversion failed');
    const f = readFixture(() =>
      Promise.reject({
        toString() {
          throw conversionError;
        },
      }),
    );
    await expect(f.read(undefined)).rejects.toBe(conversionError);
  });

  it('isolates factory dependencies and issues a fresh request for each legacy page', async () => {
    const a = readFixture(async () => ({ repos: [{ owner: 'a', name: 'one' }] }));
    const b = readFixture(async () => ({ repos: [{ owner: 'b', name: 'two' }] }));
    expect((await a.read({ page: 1 })).data?.[0].owner).toBe('a');
    expect((await b.read({ page: 2 })).data?.[0].owner).toBe('b');
    expect((await a.read({ page: 3 })).data?.[0].owner).toBe('a');
    expect(a.request.mock.calls).toEqual([['github.repos.list'], ['github.repos.list']]);
    expect(b.request.mock.calls).toEqual([['github.repos.list']]);
  });
});

describe('canonical public repository client', () => {
  it.each([
    { page: undefined, workspaceId: undefined, params: { page: undefined } },
    { page: 3, workspaceId: undefined, params: { page: 3 } },
    { page: 4, workspaceId: 'workspace', params: { page: 4, workspaceId: 'workspace' } },
    { page: 0, workspaceId: '', params: { page: 0, workspaceId: '' } },
  ])(
    'retains exact legacy payload $params and returned data identity',
    async ({ page, workspaceId, params }) => {
      const data = [{ owner: 'owner', name: 'repo' }];
      const f = clientFixture({ success: true, data });
      expect(f.invoke).not.toHaveBeenCalled();
      expect(await f.client.listRepos(page, workspaceId)).toBe(data);
      expect(f.invoke.mock.calls).toEqual([['github-auth:list-repos', params]]);
    },
  );

  it('keeps the original public async Promise adoption', async () => {
    const response = Promise.resolve({ success: true, data: [{ owner: 'owner', name: 'repo' }] });
    const client = createGithubRepositoryClient({ invoke: () => response });
    const pending = client.listRepos();
    const outcome = await pending;
    expect(pending).not.toBe(response);
    expect(outcome).toBe((await response).data);
  });

  it.each([{ success: true }, { success: true, data: null }] as const)(
    'retains data nullish fallback for %j',
    async (response) => {
      expect(await clientFixture(response).client.listRepos()).toEqual([]);
    },
  );

  it.each([
    { response: { success: false, error: 'denied' }, message: 'denied' },
    { response: { success: false, error: '' }, message: 'Repository discovery failed' },
    { response: {}, message: 'Repository discovery failed' },
  ])('rejects an unsuccessful envelope with $message', async ({ response, message }) => {
    await expect(clientFixture(response).client.listRepos()).rejects.toEqual(new Error(message));
  });

  it.each([undefined, null])('preserves malformed %j envelope access failure', async (response) => {
    await expect(clientFixture(response).client.listRepos()).rejects.toBeInstanceOf(TypeError);
  });

  it('does not add validation to non-nullish data from the legacy envelope', async () => {
    expect(await clientFixture({ success: true, data: false }).client.listRepos()).toBe(false);
  });

  it('preserves a direct invoke rejection identity', async () => {
    const error = new Error('invoke failed');
    const client = createGithubRepositoryClient({ invoke: () => Promise.reject(error) });
    await expect(client.listRepos()).rejects.toBe(error);
  });
});
