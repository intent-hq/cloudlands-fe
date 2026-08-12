import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RETENTION_FINGERPRINT_FIRST_SAMPLE_MS,
  RETENTION_FINGERPRINT_INTERVAL_MS,
  RETENTION_FINGERPRINT_PREFIX,
  collectRetentionFingerprint,
  formatRetentionFingerprint,
  startRetentionFingerprint,
} from './retention-fingerprint';

const inspectDiffCaches = vi.hoisted(() => vi.fn());
const inspectDiffWorkerPoolLifecycle = vi.hoisted(() => vi.fn());

vi.mock('$lib/utils/diff-highlighter-preloader', () => ({
  inspectDiffCaches,
  inspectDiffWorkerPoolLifecycle,
}));

function collection(ids: string[]) {
  return {
    idField: 'id',
    ids,
    map: Object.fromEntries(ids.map((id) => [id, { id }])),
    refsCount: {},
  };
}

function fields(state: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(collectRetentionFingerprint(state, { sample: 1, uptimeMs: 0 }));
}

const NO_POOL = {
  generation: 0,
  created: 0,
  terminated: 0,
  live: 0,
  activeLeases: 0,
  alive: false,
  poolSize: 0,
};

beforeEach(() => {
  inspectDiffCaches.mockReturnValue(null);
  inspectDiffWorkerPoolLifecycle.mockReturnValue(NO_POOL);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('collectRetentionFingerprint', () => {
  it('counts workspace-scoped entities and the scopes retaining them', () => {
    const counts = fields({
      workspace: { workspaces: collection(['w1', 'w2', 'w3']) },
      workspaceTasks: {
        byWorkspaceId: {
          w1: { tasks: collection(['t1', 't2']) },
          w2: { tasks: collection(['t3']) },
        },
      },
      workspaceNotes: {
        byWorkspaceId: { w1: { notes: collection(['n1', 'n2', 'n3', 'n4']) } },
      },
      workspaceEvents: {
        byWorkspaceId: { w1: { events: [1, 2] }, w2: { events: [3] } },
      },
      workspaceAgents: { byWorkspaceId: { w1: {}, w2: {}, w3: {} } },
    });

    expect(counts.workspaces).toBe(3);
    expect(counts.taskScopes).toBe(2);
    expect(counts.tasks).toBe(3);
    expect(counts.noteScopes).toBe(1);
    expect(counts.notes).toBe(4);
    expect(counts.eventScopes).toBe(2);
    expect(counts.events).toBe(3);
    expect(counts.agentScopes).toBe(3);
  });

  it('counts agent transcripts without touching message contents', () => {
    const counts = fields({
      agentSessions: {
        byAgentId: {
          a1: { messages: [{}, {}, {}] },
          a2: { messages: [{}] },
        },
      },
      chatState: {
        byAgentId: { a1: { statusEvents: [{}, {}] }, a2: { statusEvents: [] } },
      },
      comments: {
        commentsById: collection(['c1', 'c2']),
        threadsById: collection(['th1']),
      },
    });

    expect(counts.agentSessions).toBe(2);
    expect(counts.agentMessages).toBe(4);
    expect(counts.chatAgents).toBe(2);
    expect(counts.chatStatusEvents).toBe(2);
    expect(counts.comments).toBe(2);
    expect(counts.commentThreads).toBe(1);
  });

  it('reads sizes only — never the entities themselves', () => {
    // Every element access throws, so any traversal of the retained graph fails
    // the test. This is the "counts only, no jank" guarantee expressed without a
    // wall-clock bound: cost stays proportional to the number of collections,
    // not to the bytes they hold.
    const boobyTrapped = (length: number) =>
      new Proxy(new Array(length).fill(null), {
        get(target, prop, receiver) {
          if (prop === 'length') return target.length;
          if (typeof prop === 'string' && /^\d+$/.test(prop)) {
            throw new Error(`fingerprint walked the graph at index ${prop}`);
          }
          return Reflect.get(target, prop, receiver);
        },
      });

    const counts = fields({
      workspace: { workspaces: { idField: 'id', ids: boobyTrapped(126), map: {}, refsCount: {} } },
      agentSessions: { byAgentId: { a1: { messages: boobyTrapped(50_000) } } },
      workspaceEvents: { byWorkspaceId: { w1: { events: boobyTrapped(100) } } },
    });

    expect(counts.workspaces).toBe(126);
    expect(counts.agentMessages).toBe(50_000);
    expect(counts.events).toBe(100);
  });

  it('reports zero rather than throwing when a slice is missing or reshaped', () => {
    const counts = fields({ workspace: { workspaces: 'not-a-collection' } });

    expect(counts.workspaces).toBe(0);
    expect(counts.tasks).toBe(0);
    expect(counts.agentMessages).toBe(0);
  });

  it('reports diff cache and pool lifecycle counters', () => {
    inspectDiffCaches.mockReturnValue({ fileCacheSize: 12, diffCacheSize: 34 });
    inspectDiffWorkerPoolLifecycle.mockReturnValue({
      generation: 3,
      created: 3,
      terminated: 2,
      live: 1,
      activeLeases: 2,
      alive: true,
      poolSize: 8,
    });

    const counts = fields({});

    expect(counts.diffFileCache).toBe(12);
    expect(counts.diffAstCache).toBe(34);
    expect(counts.diffPoolsCreated).toBe(3);
    expect(counts.diffPoolsTerminated).toBe(2);
    expect(counts.diffPoolsLive).toBe(1);
    expect(counts.diffPoolLeases).toBe(2);
    expect(counts.diffPoolSize).toBe(8);
  });

  it('distinguishes "no pool" from "pool with empty caches"', () => {
    inspectDiffCaches.mockReturnValue(null);
    expect(fields({}).diffFileCache).toBe(-1);

    inspectDiffCaches.mockReturnValue({ fileCacheSize: 0, diffCacheSize: 0 });
    expect(fields({}).diffFileCache).toBe(0);
  });

  it('breaks out backend:* listeners from the preload registry', () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      getIpcListenerCounts: () => ({
        'backend:notification': 11,
        'backend:status': 4,
        'workspace:updated': 2,
      }),
    };

    const counts = fields({});

    expect(counts.ipcChannels).toBe(3);
    expect(counts.ipcListeners).toBe(17);
    expect(counts.ipcBackendListeners).toBe(15);
  });

  it('reports -1 for listener counts when the preload bridge cannot answer', () => {
    const counts = fields({});

    expect(counts.ipcChannels).toBe(-1);
    expect(counts.ipcListeners).toBe(-1);
    expect(counts.ipcBackendListeners).toBe(-1);
  });

  it('survives an inspector that throws', () => {
    inspectDiffWorkerPoolLifecycle.mockImplementation(() => {
      throw new Error('pool exploded');
    });
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      getIpcListenerCounts: () => {
        throw new Error('bridge gone');
      },
    };

    const counts = fields({});

    expect(counts.diffPoolsCreated).toBe(-1);
    expect(counts.ipcListeners).toBe(-1);
  });
});

describe('formatRetentionFingerprint', () => {
  it('emits one greppable line of key=value fields', () => {
    const line = formatRetentionFingerprint([
      ['sample', 2],
      ['workspaces', 126],
    ]);

    expect(line).toBe(`${RETENTION_FINGERPRINT_PREFIX} sample=2 workspaces=126`);
  });

  it('keeps a stable field order across samples', () => {
    const keysOf = (state: Record<string, unknown>) =>
      collectRetentionFingerprint(state, { sample: 1, uptimeMs: 0 }).map(([key]) => key);

    expect(keysOf({})).toEqual(keysOf({ workspace: { workspaces: collection(['w1']) } }));
  });
});

describe('startRetentionFingerprint', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function spyOnInfo() {
    return vi.spyOn(console, 'info').mockImplementation(() => {});
  }

  function linesFrom(info: ReturnType<typeof spyOnInfo>): string[] {
    return info.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes(RETENTION_FINGERPRINT_PREFIX));
  }

  it('samples inside the boot window, before the steady-state interval', () => {
    const info = spyOnInfo();
    const stop = startRetentionFingerprint({ getState: () => ({}) });

    vi.advanceTimersByTime(RETENTION_FINGERPRINT_FIRST_SAMPLE_MS - 1);
    expect(linesFrom(info)).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(linesFrom(info)).toHaveLength(1);
    expect(RETENTION_FINGERPRINT_FIRST_SAMPLE_MS).toBeLessThan(RETENTION_FINGERPRINT_INTERVAL_MS);

    stop();
  });

  it('keeps sampling on the interval and numbers each sample', () => {
    const info = spyOnInfo();
    const stop = startRetentionFingerprint({ getState: () => ({}) });

    vi.advanceTimersByTime(RETENTION_FINGERPRINT_FIRST_SAMPLE_MS);
    vi.advanceTimersByTime(RETENTION_FINGERPRINT_INTERVAL_MS * 2);

    const lines = linesFrom(info);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('sample=1');
    expect(lines[2]).toContain('sample=3');

    stop();
  });

  it('stops both the boot timer and the interval', () => {
    const info = spyOnInfo();

    const stopBeforeFirst = startRetentionFingerprint({ getState: () => ({}) });
    stopBeforeFirst();
    vi.advanceTimersByTime(RETENTION_FINGERPRINT_INTERVAL_MS * 3);
    expect(linesFrom(info)).toHaveLength(0);

    const stopAfterFirst = startRetentionFingerprint({ getState: () => ({}) });
    vi.advanceTimersByTime(RETENTION_FINGERPRINT_FIRST_SAMPLE_MS);
    expect(linesFrom(info)).toHaveLength(1);
    stopAfterFirst();
    vi.advanceTimersByTime(RETENTION_FINGERPRINT_INTERVAL_MS * 3);
    expect(linesFrom(info)).toHaveLength(1);
  });

  it('does not throw when the store cannot report state', () => {
    const info = spyOnInfo();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const stop = startRetentionFingerprint({} as unknown as { getState: () => unknown });
    vi.advanceTimersByTime(RETENTION_FINGERPRINT_INTERVAL_MS * 2);
    expect(linesFrom(info)).toHaveLength(0);
    stop();

    const throwing = startRetentionFingerprint({
      getState: () => {
        throw new Error('store disposed');
      },
    });
    expect(() => vi.advanceTimersByTime(RETENTION_FINGERPRINT_FIRST_SAMPLE_MS)).not.toThrow();
    expect(linesFrom(info)).toHaveLength(0);
    throwing();
  });
});
