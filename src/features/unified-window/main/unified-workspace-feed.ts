/**
 * Cross-machine workspace feed for the Unified window (main process).
 *
 * For every included machine it follows the daemon's global `workspace.subscribe`
 * channel (seq-0 snapshot, paged continuation through `workspace.list`, then
 * deltas) on that machine's pooled client, and keeps the last known list on disk.
 * While a machine is offline (or not yet connected) the cached list is served
 * marked `stale`, so tab titles and palette results still show. Dependencies are
 * injected so the feed is testable without Electron or a daemon.
 */
import { toFeedRow, type UnifiedFeedRow, type UnifiedMachineFeed } from '../unified-feed-types';

export interface UnifiedWorkspaceFeedDeps {
  request(machineId: string, method: string, params: unknown): Promise<unknown>;
  onNotification(handler: (machineId: string, notification: unknown) => void): () => void;
  onStatus(handler: (machineId: string, status: string) => void): () => void;
  cache: {
    load(machineId: string): Promise<UnifiedFeedRow[] | null>;
    save(machineId: string, rows: UnifiedFeedRow[]): Promise<void>;
    delete(machineId: string): Promise<void>;
  };
  publish(feeds: UnifiedMachineFeed[]): void;
}

interface MachineState {
  rows: Map<string, UnifiedFeedRow>;
  stale: boolean;
  subscriptionId: string | null;
  /** Ids removed by a delta since the last snapshot; continuation pages must not revive them. */
  removed: Set<string>;
  /** Bumps on every (re)subscribe so late results of an older attempt are dropped. */
  generation: number;
}

interface PushParams {
  subscriptionId?: unknown;
  kind?: unknown;
  snapshot?: unknown;
  nextToken?: unknown;
  delta?: { added?: unknown; updated?: unknown; removedIds?: unknown };
}

export class UnifiedWorkspaceFeed {
  private readonly machines = new Map<string, MachineState>();
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly deps: UnifiedWorkspaceFeedDeps) {
    this.disposers.push(
      deps.onNotification((machineId, notification) =>
        this.handleNotification(machineId, notification),
      ),
      deps.onStatus((machineId, status) => this.handleStatus(machineId, status)),
    );
  }

  /** Start following `machineIds`; `isConnected` says which can subscribe right away. */
  async track(machineIds: string[], isConnected: (machineId: string) => boolean): Promise<void> {
    for (const machineId of machineIds) {
      if (this.machines.has(machineId)) continue;
      const state: MachineState = {
        rows: new Map(),
        stale: true,
        subscriptionId: null,
        removed: new Set(),
        generation: 0,
      };
      this.machines.set(machineId, state);
      const cached = await this.deps.cache.load(machineId).catch(() => null);
      if (this.machines.get(machineId) !== state) continue;
      if (cached && state.rows.size === 0) {
        for (const row of cached) state.rows.set(row.id, row);
      }
      if (isConnected(machineId)) void this.subscribe(machineId);
    }
    this.publish();
  }

  /** Stop following a forgotten machine (removed connection or guest host) and drop its cache. */
  async forget(machineId: string): Promise<void> {
    this.machines.delete(machineId);
    this.publish();
    await this.deps.cache.delete(machineId).catch(() => {});
  }

  snapshot(): UnifiedMachineFeed[] {
    return [...this.machines].map(([machineId, state]) => ({
      machineId,
      stale: state.stale,
      rows: [...state.rows.values()],
    }));
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    this.machines.clear();
  }

  private publish(): void {
    this.deps.publish(this.snapshot());
  }

  private async subscribe(machineId: string): Promise<void> {
    const state = this.machines.get(machineId);
    if (!state) return;
    const generation = ++state.generation;
    state.subscriptionId = null;
    try {
      const result = (await this.deps.request(machineId, 'workspace.subscribe', {})) as {
        subscriptionId?: unknown;
      } | null;
      if (this.machines.get(machineId) !== state || state.generation !== generation) return;
      if (typeof result?.subscriptionId === 'string') state.subscriptionId = result.subscriptionId;
    } catch {
      // Stays stale with the cached rows; the next `connected` retries.
    }
  }

  private handleStatus(machineId: string, status: string): void {
    const state = this.machines.get(machineId);
    if (!state) return;
    if (status === 'connected' || status === 'reconnected') {
      void this.subscribe(machineId);
      return;
    }
    if (status === 'disconnected' || status === 'error' || status === 'reconnecting') {
      state.subscriptionId = null;
      state.generation += 1;
      if (!state.stale) {
        state.stale = true;
        this.publish();
      }
    }
  }

  private handleNotification(machineId: string, notification: unknown): void {
    const message = notification as { method?: unknown; params?: PushParams } | null;
    if (message?.method !== 'subscription.push') return;
    const state = this.machines.get(machineId);
    const params = message.params;
    if (!state || !params || !state.subscriptionId) return;
    if (params.subscriptionId !== state.subscriptionId) return;

    if (params.kind === 'snapshot') {
      state.rows = new Map();
      state.removed = new Set();
      for (const raw of Array.isArray(params.snapshot) ? params.snapshot : []) {
        const row = toFeedRow(raw);
        if (row) state.rows.set(row.id, row);
      }
      state.stale = false;
      this.commit(machineId, state);
      if (typeof params.nextToken === 'string')
        void this.fetchPages(machineId, state, state.generation, params.nextToken);
      return;
    }

    if (params.kind === 'delta' && params.delta) {
      const { added, updated, removedIds } = params.delta;
      for (const raw of [
        ...(Array.isArray(added) ? added : []),
        ...(Array.isArray(updated) ? updated : []),
      ]) {
        const row = toFeedRow(raw);
        if (row) {
          state.rows.set(row.id, row);
          state.removed.delete(row.id);
        }
      }
      for (const id of Array.isArray(removedIds) ? removedIds : []) {
        if (typeof id !== 'string') continue;
        state.rows.delete(id);
        state.removed.add(id);
      }
      this.commit(machineId, state);
    }
  }

  /** Snapshot continuation: page rows never overwrite a row a delta already delivered. */
  private async fetchPages(
    machineId: string,
    state: MachineState,
    generation: number,
    firstToken: string,
  ): Promise<void> {
    let token: string | null = firstToken;
    while (token) {
      let page: { workspaces?: unknown; nextToken?: unknown } | null;
      try {
        page = (await this.deps.request(machineId, 'workspace.list', {
          includeArchived: true,
          nextToken: token,
        })) as typeof page;
      } catch {
        return;
      }
      if (this.machines.get(machineId) !== state || state.generation !== generation) return;
      for (const raw of Array.isArray(page?.workspaces) ? page.workspaces : []) {
        const row = toFeedRow(raw);
        if (row && !state.rows.has(row.id) && !state.removed.has(row.id))
          state.rows.set(row.id, row);
      }
      this.commit(machineId, state);
      token = typeof page?.nextToken === 'string' ? page.nextToken : null;
    }
  }

  private commit(machineId: string, state: MachineState): void {
    this.publish();
    void this.deps.cache.save(machineId, [...state.rows.values()]).catch(() => {});
  }
}
