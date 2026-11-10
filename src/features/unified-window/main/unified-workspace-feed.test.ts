import { describe, expect, it, vi } from 'vitest';
import type { UnifiedFeedRow, UnifiedMachineFeed } from '../unified-feed-types';
import { UnifiedWorkspaceFeed, type UnifiedWorkspaceFeedDeps } from './unified-workspace-feed';

type Push = { subscriptionId: string; kind: string; seq: number; [key: string]: unknown };

function harness(cached: Record<string, UnifiedFeedRow[]> = {}) {
  const store = new Map(Object.entries(cached));
  const notificationHandlers: Array<(machineId: string, n: unknown) => void> = [];
  const statusHandlers: Array<(machineId: string, status: string) => void> = [];
  const published: UnifiedMachineFeed[][] = [];
  let subscriptionCounter = 0;
  const pages = new Map<string, { workspaces: unknown[]; nextToken: string | null }>();
  const request = vi.fn(async (machineId: string, method: string, params: unknown) => {
    if (method === 'workspace.subscribe') {
      if (machineId === 'broken') throw new Error('connection reset');
      subscriptionCounter += 1;
      return { subscriptionId: `${machineId}-sub-${subscriptionCounter}` };
    }
    if (method === 'workspace.list') {
      const token = (params as { nextToken: string }).nextToken;
      return pages.get(token) ?? { workspaces: [], nextToken: null };
    }
    throw new Error(`unexpected ${method}`);
  });
  const deps: UnifiedWorkspaceFeedDeps = {
    request,
    onNotification: (handler) => {
      notificationHandlers.push(handler);
      return () => {};
    },
    onStatus: (handler) => {
      statusHandlers.push(handler);
      return () => {};
    },
    cache: {
      load: async (id) => store.get(id) ?? null,
      save: async (id, rows) => void store.set(id, rows),
      delete: async (id) => void store.delete(id),
    },
    publish: (feeds) => published.push(feeds),
  };
  const feed = new UnifiedWorkspaceFeed(deps);
  const push = (machineId: string, params: Push) =>
    notificationHandlers.forEach((handler) =>
      handler(machineId, { method: 'subscription.push', params }),
    );
  const status = (machineId: string, value: string) =>
    statusHandlers.forEach((handler) => handler(machineId, value));
  const latest = (machineId: string) =>
    published.at(-1)?.find((machine) => machine.machineId === machineId);
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { feed, push, status, latest, request, store, pages, flush };
}

const row = (id: string, title = id) => ({ id, title, status: 'Active', secret: 'content' });

describe('UnifiedWorkspaceFeed', () => {
  it('serves the last known list, marked stale, before the machine connects', async () => {
    const h = harness({ studio: [{ id: 'w1', title: 'Cached' }] });
    await h.feed.track(['studio'], () => false);
    expect(h.latest('studio')).toEqual({
      machineId: 'studio',
      stale: true,
      rows: [{ id: 'w1', title: 'Cached' }],
    });
    expect(h.request).not.toHaveBeenCalled();
  });

  it('subscribes on connect, replaces the cache with the snapshot and keeps only lite fields', async () => {
    const h = harness({ studio: [{ id: 'gone', title: 'Old' }] });
    await h.feed.track(['studio'], () => true);
    await h.flush();
    expect(h.request).toHaveBeenCalledWith('studio', 'workspace.subscribe', {});
    h.push('studio', { subscriptionId: 'studio-sub-1', kind: 'snapshot', seq: 0, snapshot: [row('w1')] });
    await h.flush();
    expect(h.latest('studio')).toEqual({
      machineId: 'studio',
      stale: false,
      rows: [{ id: 'w1', title: 'w1', status: 'Active' }],
    });
    expect(h.store.get('studio')).toEqual([{ id: 'w1', title: 'w1', status: 'Active' }]);
  });

  it('fetches the remaining snapshot pages with workspace.list', async () => {
    const h = harness();
    h.pages.set('p2', { workspaces: [row('w2')], nextToken: 'p3' });
    h.pages.set('p3', { workspaces: [row('w3')], nextToken: null });
    await h.feed.track(['studio'], () => true);
    await h.flush();
    h.push('studio', {
      subscriptionId: 'studio-sub-1',
      kind: 'snapshot',
      seq: 0,
      snapshot: [row('w1')],
      nextToken: 'p2',
    });
    await h.flush();
    await h.flush();
    expect(h.request).toHaveBeenCalledWith('studio', 'workspace.list', {
      includeArchived: true,
      nextToken: 'p2',
    });
    expect(h.latest('studio')?.rows.map((r) => r.id)).toEqual(['w1', 'w2', 'w3']);
  });

  it('applies added, updated and removed deltas', async () => {
    const h = harness();
    await h.feed.track(['studio'], () => true);
    await h.flush();
    h.push('studio', { subscriptionId: 'studio-sub-1', kind: 'snapshot', seq: 0, snapshot: [row('w1'), row('w2')] });
    h.push('studio', {
      subscriptionId: 'studio-sub-1',
      kind: 'delta',
      seq: 1,
      delta: { added: [row('w3')], updated: [row('w1', 'Renamed')], removedIds: ['w2'] },
    });
    await h.flush();
    expect(h.latest('studio')?.rows.map((r) => [r.id, r.title])).toEqual([
      ['w1', 'Renamed'],
      ['w3', 'w3'],
    ]);
  });

  it('ignores pushes for another subscription or another machine', async () => {
    const h = harness();
    await h.feed.track(['studio', 'local'], () => true);
    await h.flush();
    h.push('studio', { subscriptionId: 'renderer-sub', kind: 'snapshot', seq: 0, snapshot: [row('x')] });
    h.push('local', { subscriptionId: 'studio-sub-1', kind: 'snapshot', seq: 0, snapshot: [row('y')] });
    await h.flush();
    expect(h.latest('studio')?.rows).toEqual([]);
    expect(h.latest('local')?.rows).toEqual([]);
  });

  it('keeps rows but marks them stale when the machine disconnects, and resubscribes on reconnect', async () => {
    const h = harness();
    await h.feed.track(['studio'], () => true);
    await h.flush();
    h.push('studio', { subscriptionId: 'studio-sub-1', kind: 'snapshot', seq: 0, snapshot: [row('w1')] });
    await h.flush();
    h.status('studio', 'disconnected');
    expect(h.latest('studio')).toMatchObject({ stale: true, rows: [{ id: 'w1' }] });

    h.status('studio', 'connected');
    await h.flush();
    // The old subscription died with the connection: its pushes no longer count.
    h.push('studio', { subscriptionId: 'studio-sub-1', kind: 'delta', seq: 1, delta: { added: [row('ghost')] } });
    h.push('studio', { subscriptionId: 'studio-sub-2', kind: 'snapshot', seq: 0, snapshot: [row('w9')] });
    await h.flush();
    expect(h.latest('studio')).toMatchObject({ stale: false, rows: [{ id: 'w9' }] });
  });

  it('stays stale when subscribing fails, without throwing', async () => {
    const h = harness({ broken: [{ id: 'w1', title: 'Cached' }] });
    await h.feed.track(['broken'], () => true);
    await h.flush();
    expect(h.latest('broken')).toMatchObject({ stale: true, rows: [{ id: 'w1' }] });
  });

  it('forgetting a machine deletes its cache and stops following it', async () => {
    const h = harness({ studio: [{ id: 'w1', title: 'Cached' }] });
    await h.feed.track(['studio'], () => true);
    await h.flush();
    await h.feed.forget('studio');
    expect(h.store.has('studio')).toBe(false);
    h.push('studio', { subscriptionId: 'studio-sub-1', kind: 'snapshot', seq: 0, snapshot: [row('w1')] });
    await h.flush();
    expect(h.latest('studio')).toBeUndefined();
    expect(h.store.has('studio')).toBe(false);
  });

  it('never follows a machine it was not asked to track', async () => {
    const h = harness();
    await h.feed.track(['local'], () => true);
    h.status('node-1', 'connected');
    await h.flush();
    expect(h.request).not.toHaveBeenCalledWith('node-1', expect.anything(), expect.anything());
  });
});
