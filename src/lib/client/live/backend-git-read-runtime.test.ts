import { describe, expect, it } from 'vitest';
import { createBackendGitReadRuntime } from './backend-git-read-runtime';

function reply<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function observe<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (error) => ({ status: 'rejected' as const, error: error as unknown }),
  );
}
function controlled(isCurrent?: () => boolean) {
  const requests: Array<{
    method: string;
    params: Record<string, unknown>;
    reply: ReturnType<typeof reply<unknown>>;
  }> = [];
  const runtime = createBackendGitReadRuntime({
    isCurrent,
    request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      const pending = reply<unknown>();
      requests.push({ method, params, reply: pending });
      return pending.promise as Promise<T>; // Typed transport boundary, deliberately controlled raw payload.
    },
  });
  return { runtime, requests };
}
const rawStatus = {
  branch: 'main',
  ahead: 2,
  behind: 0,
  diverged: false,
  files: [{ path: 'a.ts', status: 'M', staged: false }],
  hasUncommittedChanges: true,
  hasUntrackedFiles: false,
};

describe('canonical Git read algorithms with controlled request ports', () => {
  it('keeps one default flight and prevents old forced-flight cleanup from deleting its successor', async () => {
    const { runtime, requests } = controlled();
    const first = runtime.status('w');
    expect(runtime.status('w')).toBe(first);
    const forced = runtime.status('w', { forceRefresh: true });
    expect(requests.map((x) => [x.method, x.params])).toEqual([
      ['git.status', { workspaceId: 'w' }],
      ['git.status', { workspaceId: 'w', forceRefresh: true }],
    ]);
    requests[0].reply.resolve(rawStatus);
    await first;
    expect(runtime.status('w')).toBe(forced);
    requests[1].reply.resolve(rawStatus);
    expect(await forced).toEqual(rawStatus);
    const fresh = runtime.status('w');
    expect(requests).toHaveLength(3);
    requests[2].reply.resolve(null);
    expect(await fresh).toBeNull();
  });
  it('refuses retired A before any pending cache reuse and never joins A through B', async () => {
    let current = true;
    const a = controlled(() => current);
    const b = controlled(() => true);
    const pendingA = observe(a.runtime.status('w'));
    current = false;
    expect(() => a.runtime.status('w')).toThrow(
      expect.objectContaining({ code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE' }),
    );
    const pendingB = b.runtime.status('w');
    expect(b.requests).toHaveLength(1);
    a.requests[0].reply.resolve(rawStatus);
    const aResult = await pendingA;
    expect(aResult.status).toBe('rejected');
    if (aResult.status !== 'rejected') throw new Error('Expected retired A');
    expect(aResult.error).toMatchObject({ code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE' });
    b.requests[0].reply.resolve({ ...rawStatus, branch: 'other' });
    expect((await pendingB)?.branch).toBe('other');
  });
  it('maps tracked changes and commit provenance from exact original wire methods', async () => {
    const { runtime, requests } = controlled();
    const changes = runtime.trackedChanges('w');
    const commits = runtime.commitsWithBoundary('w', true);
    expect(requests.map((x) => [x.method, x.params])).toEqual([
      ['file-tracking.getChanges', { workspaceId: 'w' }],
      ['file-tracking.loadCommits', { workspaceId: 'w', includeOlder: true }],
    ]);
    requests[0].reply.resolve({
      changes: [
        {
          id: 'c',
          file: 'a',
          relativePath: 'a',
          stage: 'unstaged',
          status: 'modified',
          stats: { additions: 2, deletions: 1 },
          attribution: { manual: true, timestamp: 4 },
        },
      ],
      truncated: false,
      totalCount: 1,
    });
    requests[1].reply.resolve({
      commits: [
        {
          hash: 'abc',
          message: 'm',
          author: 'a',
          date: '2026-01-01T00:00:00Z',
          isPushed: true,
          agentId: 'agent',
          linkedNoteId: 'note',
        },
      ],
      boundarySha: 'boundary',
      nextToken: 'page',
    });
    expect(await changes).toEqual([
      {
        id: 'c',
        file: 'a',
        relativePath: 'a',
        stage: 'unstaged',
        status: 'modified',
        stats: { additions: 2, deletions: 1 },
        attribution: { manual: true, timestamp: 4 },
      },
    ]);
    expect(await commits).toEqual({
      commits: [
        {
          hash: 'abc',
          message: 'm',
          author: 'a',
          timestamp: 1767225600000,
          stage: 'pushed',
          isPushed: true,
          date: '2026-01-01T00:00:00Z',
          agentId: 'agent',
          linkedNoteId: 'note',
        },
      ],
      boundarySha: 'boundary',
      nextToken: 'page',
    });
  });
  it('preserves default error folds and the closed PR outcome set', async () => {
    const { runtime, requests } = controlled();
    const tracked = runtime.trackedChanges('w');
    const commits = runtime.commitsWithBoundary('w');
    const pr = runtime.prRefresh('w', { automatic: false });
    const error = new Error('denied');
    requests[0].reply.reject(error);
    requests[1].reply.reject(error);
    requests[2].reply.resolve({ outcome: 'unknown' });
    expect(await tracked).toBeNull();
    expect(await commits).toEqual({ commits: [], boundarySha: null, nextToken: null });
    expect(await pr).toBeNull();
    const skipped = runtime.prRefresh('w', { automatic: true });
    expect(requests[3].params).toEqual({ workspaceId: 'w', automatic: true });
    requests[3].reply.resolve({ outcome: 'skipped', pullRequests: [] });
    expect(await skipped).toMatchObject({ outcome: 'skipped', pullRequests: [] });
  });
  it('retains the original scoped failure when raw cleanup has already retired the parent', async () => {
    let current = true;
    const { runtime, requests } = controlled(() => current);
    const pending = observe(runtime.prRefresh('w', { automatic: true }));
    const error = new Error('original daemon failure');
    current = false;
    requests[0].reply.reject(error);
    expect(await pending).toEqual({ status: 'rejected', error });
  });
  it('resolves the source request callee before evaluating PR option getters inside its async body', async () => {
    const events: string[] = [];
    const result = { outcome: 'skipped', pullRequests: [] };
    const runtime = createBackendGitReadRuntime({
      get request() {
        events.push('callee');
        return <T>() => Promise.resolve(result as T);
      },
    });
    const options = {
      get automatic() {
        events.push('options');
        return true;
      },
    };
    expect(await runtime.prRefresh('w', options)).toMatchObject(result);
    expect(events).toEqual(['callee', 'options']);
    const error = new Error('options getter');
    const bad = {
      get automatic(): boolean {
        throw error;
      },
    };
    expect(() => runtime.prRefresh('w', bad)).not.toThrow();
    expect(await runtime.prRefresh('w', bad)).toBeNull();
  });
});

it('preserves an ordinary scoped PR rejection for its still-current publication owner while source keeps null folding', async () => {
  const original = new Error('original current PR rejection');
  const scoped = controlled(() => true);
  const source = controlled();
  const scopedPending = observe(scoped.runtime.prRefresh('w', { automatic: true }));
  const sourcePending = observe(source.runtime.prRefresh('w', { automatic: true }));
  scoped.requests[0].reply.reject(original);
  source.requests[0].reply.reject(original);
  expect(await scopedPending).toEqual({ status: 'rejected', error: original });
  expect(await sourcePending).toEqual({ status: 'fulfilled', value: null });
});
