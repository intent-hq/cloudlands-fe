// Actual React client/backend/Store with only the declared preload delivery controlled.
// No source seeder import, native invocation, app root, auth or network operation.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { store } from '../../store';
import { githubRepositoryClient } from './github-repository-client';

type Outcome<T> = { kind: 'fulfilled'; value: T } | { kind: 'rejected'; error: unknown };
const cleanups: Array<() => Promise<void>> = [];
function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  let settled = false;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    get settled() {
      return settled;
    },
    resolve(value: T) {
      settled = true;
      resolvePromise(value);
    },
    reject(error: unknown) {
      settled = true;
      rejectPromise(error);
    },
  };
}
function value<T>(outcome: Outcome<T>): T {
  if (outcome.kind !== 'fulfilled') throw new Error('Expected fulfilled repository read');
  return outcome.value;
}
function failure<T>(outcome: Outcome<T>): unknown {
  if (outcome.kind !== 'rejected') throw new Error('Expected rejected repository read');
  return outcome.error;
}

afterEach(async () => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    vi.unstubAllGlobals();
  } catch (error) {
    errors.push(error);
  }
  try {
    vi.restoreAllMocks();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length) throw new AggregateError(errors, 'Repository fixture cleanup failed');
});

function fixture() {
  const requests: Array<ReturnType<typeof deferred<unknown>>> = [];
  const invocations: Array<{ bridge: string; channel: string; args: unknown[] }> = [];
  const observations: Array<Promise<Outcome<unknown>>> = [];
  const expectedErrors = new Set<unknown>();
  const runtimeErrors: unknown[] = [];
  const unexpectedCalls: unknown[] = [];
  let closing = false;
  let errorObservation: { unsubscribe(): void } | undefined;
  let restoreGlobal: (() => void) | undefined;
  let storeAcquisitionAttempted = false;
  // Register before the first observer, global, or Store acquisition.
  cleanups.push(cleanup);

  function observe<T>(promise: Promise<T>): Promise<Outcome<T>> {
    const observed = promise.then(
      (result): Outcome<T> => ({ kind: 'fulfilled', value: result }),
      (error): Outcome<T> => ({ kind: 'rejected', error }),
    );
    observations.push(observed);
    return observed;
  }
  function retain<T>(promise: Promise<T>): Promise<T> {
    observe(promise);
    return promise;
  }
  function unexpected(detail: unknown): never {
    unexpectedCalls.push(detail);
    throw new Error('Unexpected GitHub repository preload operation');
  }
  function useBridge(bridge: string) {
    const api: Window['electronAPI'] & {
      platform: string;
      arch: string;
      versions: { node: string; chrome: string; electron: string };
    } = {
      invoke: (channel: string, ...args: unknown[]) => {
        invocations.push({ bridge, channel, args });
        const payload = args[0];
        if (
          channel !== IPC_CHANNELS.BACKEND.REQUEST ||
          args.length !== 1 ||
          !payload ||
          typeof payload !== 'object' ||
          !('method' in payload) ||
          payload.method !== 'github.repos.list'
        )
          return unexpected({ channel, args });
        const reply = deferred<unknown>();
        requests.push(reply);
        const raw = retain(reply.promise);
        if (closing) reply.resolve({ ok: true, result: { repos: [] } });
        // Observe raw and exposed API promises; return the exact same Promise.
        return retain(raw);
      },
      send: (...args: unknown[]) => unexpected({ send: args }),
      on: (...args: unknown[]) => unexpected({ on: args }),
      off: (...args: unknown[]) => unexpected({ off: args }),
      offById: (...args: unknown[]) => unexpected({ offById: args }),
      removeAllListeners: (...args: unknown[]) => unexpected({ removeAllListeners: args }),
      platform: 'linux',
      arch: 'x64',
      versions: { node: '24.21.0', chrome: '153.0.8010.12', electron: '43.0.0' },
      devInstance: null,
      devPort: null,
    };
    restoreGlobal = () => vi.unstubAllGlobals();
    vi.stubGlobal('window', { electronAPI: api });
  }
  errorObservation = store.traceStreams.runtimeError.observe((event: unknown) =>
    runtimeErrors.push(event),
  );
  useBridge('first');
  storeAcquisitionAttempted = true;
  // This route has no admission policy; use the actual default Store unchanged.
  store.init();

  async function cleanup() {
    const errors: unknown[] = [];
    closing = true;
    let observed = 0;
    try {
      do {
        for (const reply of requests) {
          try {
            if (!reply.settled) reply.resolve({ ok: true, result: { repos: [] } });
          } catch (error) {
            errors.push(error);
          }
        }
        const batch = observations.slice(observed);
        observed = observations.length;
        const drains = await Promise.allSettled(
          batch.map(async (observation) => {
            try {
              const outcome = await observation;
              if (outcome.kind === 'rejected' && !expectedErrors.has(outcome.error))
                errors.push(outcome.error);
            } catch (error) {
              errors.push(error);
            }
          }),
        );
        for (const drain of drains) if (drain.status === 'rejected') errors.push(drain.reason);
      } while (observed < observations.length);
    } catch (error) {
      errors.push(error);
    } finally {
      if (storeAcquisitionAttempted) {
        try {
          store.dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      errors.push(...runtimeErrors, ...unexpectedCalls);
      try {
        errorObservation?.unsubscribe();
      } catch (error) {
        errors.push(error);
      }
      try {
        restoreGlobal?.();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Unaccounted repository read errors');
  }
  return {
    requests,
    invocations,
    useBridge,
    read(page?: number, workspaceId?: string) {
      return observe(githubRepositoryClient.listRepos(page, workspaceId));
    },
    expectError(error: unknown) {
      expectedErrors.add(error);
    },
    async nextRequest(index = 0) {
      await vi.waitFor(() => expect(requests.length).toBeGreaterThan(index));
      return requests[index];
    },
  };
}

describe('actual React GitHub repository read binding', () => {
  it('routes the default public call to the daemon and maps all six legacy fields', async () => {
    const f = fixture();
    expect(f.invocations).toEqual([]);
    const pending = f.read();
    (await f.nextRequest()).resolve({
      ok: true,
      result: {
        repos: [
          {
            owner: 'alpha',
            name: 'one',
            htmlUrl: 'https://example.test/one',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            defaultBranch: 'trunk',
          },
        ],
        nextToken: 'unused',
      },
    });
    expect(value(await pending)).toEqual([
      {
        owner: 'alpha',
        name: 'one',
        html_url: 'https://example.test/one',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
        default_branch: 'trunk',
      },
    ]);
    expect(f.invocations).toEqual([
      {
        bridge: 'first',
        channel: 'backend:request',
        args: [{ method: 'github.repos.list', params: undefined }],
      },
    ]);
  });

  it.each(['workspace-a', ''] as const)(
    'retains workspace %j through the actual serializer and ignores page',
    async (workspaceId) => {
      const f = fixture();
      const pending = f.read(17, workspaceId);
      (await f.nextRequest()).resolve({ ok: true, result: { repos: [] } });
      expect(value(await pending)).toEqual([]);
      expect(f.invocations).toEqual([
        {
          bridge: 'first',
          channel: 'backend:request',
          args: [{ method: 'github.repos.list', params: { workspaceId } }],
        },
      ]);
    },
  );

  it('selects the current preload bridge per call while retaining each held response', async () => {
    const f = fixture();
    const first = f.read(1, 'first-workspace');
    const firstReply = await f.nextRequest();
    f.useBridge('second');
    const second = f.read(2, 'second-workspace');
    const secondReply = await f.nextRequest(1);
    secondReply.resolve({ ok: true, result: { repos: [{ owner: 'b', name: 'second' }] } });
    firstReply.resolve({ ok: true, result: { repos: [{ owner: 'a', name: 'first' }] } });
    const [a, b] = await Promise.all([first, second]);
    expect(value(a)[0]).toMatchObject({ owner: 'a', name: 'first' });
    expect(value(b)[0]).toMatchObject({ owner: 'b', name: 'second' });
    expect(f.invocations).toEqual([
      {
        bridge: 'first',
        channel: 'backend:request',
        args: [{ method: 'github.repos.list', params: { workspaceId: 'first-workspace' } }],
      },
      {
        bridge: 'second',
        channel: 'backend:request',
        args: [{ method: 'github.repos.list', params: { workspaceId: 'second-workspace' } }],
      },
    ]);
  });

  it('preserves the declared daemon error through the unsuccessful route envelope and public rejection', async () => {
    const f = fixture();
    const pending = f.read();
    (await f.nextRequest()).resolve({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Repository list denied' },
    });
    const error = failure(await pending);
    f.expectError(error);
    expect(error).toEqual(new Error('Repository list denied'));
  });

  it('keeps a held transport failure after bridge replacement and allows the next read to succeed', async () => {
    const f = fixture();
    const first = f.read();
    const firstReply = await f.nextRequest();
    f.useBridge('second');
    const second = f.read();
    const secondReply = await f.nextRequest(1);
    const rawError = new Error('Held request failed');
    f.expectError(rawError);
    firstReply.reject(rawError);
    secondReply.resolve({ ok: true, result: { repos: [] } });
    const [oldOutcome, newOutcome] = await Promise.all([first, second]);
    const error = failure(oldOutcome);
    f.expectError(error);
    expect(error).toEqual(new Error('Held request failed'));
    expect(error).not.toBe(rawError);
    expect(value(newOutcome)).toEqual([]);
    expect(f.invocations.map((call) => call.bridge)).toEqual(['first', 'second']);
  });

  it('preserves the nullish catalog fallback through the real transport', async () => {
    const f = fixture();
    const pending = f.read();
    (await f.nextRequest()).resolve({ ok: true, result: { repos: null } });
    expect(value(await pending)).toEqual([]);
  });

  it.each([{ repos: {} }, { repos: [null] }] as const)(
    'preserves malformed map/row errors through the public client for %j',
    async (result) => {
      const f = fixture();
      const pending = f.read();
      (await f.nextRequest()).resolve({ ok: true, result });
      const error = failure(await pending);
      f.expectError(error);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toEqual(new Error('Repository discovery failed'));
    },
  );

  it('makes fresh daemon reads for different legacy pages without introducing caching', async () => {
    const f = fixture();
    const first = f.read(1, 'workspace');
    (await f.nextRequest()).resolve({ ok: true, result: { repos: [{ owner: 'a', name: 'one' }] } });
    const firstResult = value(await first);
    const second = f.read(8, 'workspace');
    (await f.nextRequest(1)).resolve({
      ok: true,
      result: { repos: [{ owner: 'b', name: 'two' }] },
    });
    expect(firstResult[0]).toMatchObject({ owner: 'a', name: 'one' });
    expect(value(await second)[0]).toMatchObject({ owner: 'b', name: 'two' });
    expect(f.invocations).toEqual([
      {
        bridge: 'first',
        channel: 'backend:request',
        args: [{ method: 'github.repos.list', params: { workspaceId: 'workspace' } }],
      },
      {
        bridge: 'first',
        channel: 'backend:request',
        args: [{ method: 'github.repos.list', params: { workspaceId: 'workspace' } }],
      },
    ]);
  });
});
