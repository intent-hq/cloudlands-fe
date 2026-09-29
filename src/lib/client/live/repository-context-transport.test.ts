import { describe, expect, it, vi } from 'vitest';
import fixture from '$shared/types/__fixtures__/repository-context.json';
import type { RepositoryContextUpdate } from '../app-client';
import type { BoundRepositoryRoute } from './backend-transport-types';
import { createRepositoryContextTransport } from './repository-context-transport';

vi.mock('./backend-transport', () => ({ captureBackendRepositoryRoute: vi.fn() }));
const request = { requestId: 'read-1', binding: 'original', workspaceId: 'workspace-1' };
function harness() {
  let retire: () => void = () => {};
  const release = vi.fn(async () => {});
  const read = vi.fn(async () => ({
    operationId: 'own',
    current: true,
    settlement: { status: 'fulfilled', value: fixture },
  }));
  const route = {
    request: read,
    release,
    onRetired: vi.fn((handler: () => void) => {
      retire = handler;
      return vi.fn();
    }),
  } as unknown as BoundRepositoryRoute;
  const capture = vi.fn(async () => route);
  const updates: RepositoryContextUpdate[] = [];
  const observer = createRepositoryContextTransport(capture);
  return { observer, capture, route, read, release, updates, retire: () => retire() };
}

describe('bound repository inventory observation', () => {
  it('reads once through a captured route and holds only the resource until retirement', async () => {
    const h = harness();
    const close = await h.observer.observe(request, (update) => h.updates.push(update));
    await vi.waitFor(() =>
      expect(h.updates).toEqual([{ type: 'received', response: { request, context: fixture } }]),
    );
    expect(h.capture).toHaveBeenCalledExactlyOnceWith({
      workspaceId: request.workspaceId,
      kind: 'primary',
    });
    expect(h.read).toHaveBeenCalledExactlyOnceWith('workspace.repositoryContext', {
      workspaceId: request.workspaceId,
    });
    expect(h.release).not.toHaveBeenCalled();
    h.retire();
    expect(h.updates.at(-1)).toEqual({ type: 'retired', request });
    close();
    expect(h.release).toHaveBeenCalledOnce();
  });

  it('disposes acquisition after cancellation without reading or publishing it', async () => {
    const h = harness();
    let resolve!: (route: BoundRepositoryRoute) => void;
    h.capture.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const close = await h.observer.observe(request, (update) => h.updates.push(update));
    close();
    resolve(h.route);
    await vi.waitFor(() => expect(h.release).toHaveBeenCalledOnce());
    expect(h.read).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
  });

  it('preserves the initiating selection through capture and response awaits', async () => {
    const h = harness();
    let resolve!: (route: BoundRepositoryRoute) => void;
    h.capture.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const mutable = { ...request };
    const close = await h.observer.observe(mutable, (update) => h.updates.push(update));
    mutable.workspaceId = 'replacement';
    mutable.binding = 'new-account';
    resolve(h.route);
    await vi.waitFor(() => expect(h.updates).toHaveLength(1));
    expect(h.updates[0]).toEqual({ type: 'received', response: { request, context: fixture } });
    close();
  });

  it.each(['stale', 'rejected', 'malformed', 'wrong-workspace', 'duplicate-root'])(
    'does not apply %s original settlements as current inventory',
    async (kind) => {
      const h = harness();
      const value = structuredClone(fixture);
      if (kind === 'wrong-workspace') value.roots[0].root.workspaceId = 'elsewhere';
      if (kind === 'duplicate-root') value.roots.push(value.roots[0]);
      h.read.mockResolvedValue({
        operationId: 'original',
        current: kind !== 'stale',
        settlement:
          kind === 'rejected'
            ? { status: 'rejected', error: { code: 'forbidden', message: 'Unavailable' } }
            : { status: 'fulfilled', value: kind === 'malformed' ? {} : value },
      } as never);
      const close = await h.observer.observe(request, (update) => h.updates.push(update));
      await vi.waitFor(() => expect(h.updates).toHaveLength(1));
      expect(h.updates[0].type).toBe(kind === 'stale' ? 'retired' : 'unavailable');
      expect(h.capture).toHaveBeenCalledOnce();
      expect(h.release).toHaveBeenCalledOnce();
      close();
    },
  );

  it('suppresses a read already in flight when its view retires', async () => {
    const h = harness();
    let resolve!: (value: never) => void;
    h.read.mockReturnValue(
      new Promise((done) => {
        resolve = done as typeof resolve;
      }),
    );
    const close = await h.observer.observe(request, (update) => h.updates.push(update));
    await vi.waitFor(() => expect(h.read).toHaveBeenCalledOnce());
    h.retire();
    resolve({
      operationId: 'old',
      current: false,
      settlement: { status: 'fulfilled', value: fixture },
    } as never);
    await Promise.resolve();
    expect(h.updates).toEqual([{ type: 'retired', request }]);
    close();
  });

  it('emits unavailable without an ordinary request fallback if capture is refused', async () => {
    const h = harness();
    h.capture.mockRejectedValue(new Error('Unavailable'));
    await h.observer.observe(request, (update) => h.updates.push(update));
    await vi.waitFor(() => expect(h.updates).toEqual([{ type: 'unavailable', request }]));
    expect(h.read).not.toHaveBeenCalled();
    expect(h.capture).toHaveBeenCalledOnce();
  });
});
