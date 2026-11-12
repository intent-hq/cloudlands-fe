import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';

const storage = vi.hoisted(() => ({
  saved: new Map<string, string>(),
  failReads: false,
}));
vi.mock('../../../utils/safe-local-storage-saga', () => ({
  getLocalStorageJSON: function* (key: string) {
    if (storage.failReads) throw new Error('storage unavailable');
    const raw = storage.saved.get(key);
    return raw === undefined ? undefined : JSON.parse(raw);
  },
  setLocalStorageJSON: function* (key: string, value: unknown) {
    storage.saved.set(key, JSON.stringify(value));
  },
}));

import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { connectionsListReceived } from '../../connections/connections-slice';
import { getPaletteMruEntries, getPalettePicks } from '../palette-normalization';
import {
  getPalettePickWeights,
  MAX_PALETTE_PICKS,
  PALETTE_PICK_FADE_MS,
} from '../palette-pick-memory';
import {
  initialState,
  paletteReducer,
  recordPaletteFileMru,
  recordPaletteMruItem,
  recordPalettePick,
} from '../palette-slice';
import type { PaletteState } from '../palette-types';
import { PALETTE_MEMORY_STORAGE_KEY, paletteMemorySaga } from './palette-memory-saga';

const NOW = Date.UTC(2026, 10, 8);
const REMOTE_ID = 'remote-1';

type Harness = {
  dispatch: (action: { type: string }) => void;
  palette: () => PaletteState;
  setBackend: (id: string) => void;
  stop: () => Promise<void>;
};

const tasks: Task[] = [];

function startApp(backendId = LOCAL_CONNECTION_ID): Harness {
  let palette = paletteReducer(undefined, { type: '@@INIT' });
  let windowBackendId = backendId;
  const channel = stdChannel();
  const dispatch = (action: { type: string }) => {
    palette = paletteReducer(palette, action);
    channel.put(action);
  };
  const task = runSaga(
    {
      channel,
      dispatch,
      getState: () => ({ palette, connections: { activeId: windowBackendId, windowBackendId } }),
    },
    paletteMemorySaga,
  );
  tasks.push(task);
  return {
    dispatch,
    palette: () => palette,
    setBackend: (id) => {
      windowBackendId = id;
    },
    stop: async () => {
      task.cancel();
      await task.toPromise();
    },
  };
}

beforeEach(() => {
  storage.saved.clear();
  storage.failReads = false;
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

afterEach(async () => {
  vi.useRealTimers();
  for (const task of tasks.splice(0)) task.cancel();
});

describe('paletteMemorySaga', () => {
  it('keeps picks, recent items and recent files across an app restart', async () => {
    const first = startApp();
    first.dispatch(recordPalettePick('  AG ', 'agent:agent-avatar', NOW - 1_000));
    first.dispatch(recordPaletteMruItem('command', 'new-workspace', NOW - 500));
    first.dispatch(recordPaletteFileMru('src/app.ts', NOW - 200));
    await first.stop();

    const second = startApp();
    expect(
      getPalettePickWeights(getPalettePicks(second.palette()), 'ag', NOW).exact.get(
        'agent:agent-avatar',
      ),
    ).toBeGreaterThan(0.99);
    expect(getPaletteMruEntries(second.palette())).toEqual([
      { type: 'command', id: 'new-workspace', timestamp: NOW - 500 },
    ]);
    expect(second.palette().fileMru).toEqual({ 'src/app.ts': NOW - 200 });
  });

  it('keeps a separate memory for each daemon connection', async () => {
    const local = startApp(LOCAL_CONNECTION_ID);
    local.dispatch(recordPalettePick('ag', 'agent:local-agent', NOW));
    await local.stop();

    const remote = startApp(REMOTE_ID);
    expect(getPalettePicks(remote.palette())).toEqual([]);
    remote.dispatch(recordPalettePick('ag', 'agent:remote-agent', NOW));
    await remote.stop();

    expect(storage.saved.has(PALETTE_MEMORY_STORAGE_KEY)).toBe(true);
    expect(storage.saved.has(`backend:${REMOTE_ID}:${PALETTE_MEMORY_STORAGE_KEY}`)).toBe(true);

    const localAgain = startApp(LOCAL_CONNECTION_ID);
    expect(getPalettePicks(localAgain.palette()).map((pick) => pick.itemKey)).toEqual([
      'agent:local-agent',
    ]);
  });

  it('swaps in the other daemon memory when the window backend changes', async () => {
    storage.saved.set(
      `backend:${REMOTE_ID}:${PALETTE_MEMORY_STORAGE_KEY}`,
      JSON.stringify({ version: 1, picks: [{ query: 'x', itemKey: 'note:n', timestamp: NOW }] }),
    );
    const app = startApp(LOCAL_CONNECTION_ID);
    app.dispatch(recordPalettePick('ag', 'agent:local-agent', NOW));

    app.setBackend(REMOTE_ID);
    app.dispatch(connectionsListReceived({} as never));

    expect(getPalettePicks(app.palette()).map((pick) => pick.itemKey)).toEqual(['note:n']);
    expect(getPaletteMruEntries(app.palette())).toEqual([]);
  });

  it('merges picks made before stored memory finished loading', async () => {
    storage.saved.set(
      PALETTE_MEMORY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        picks: [{ query: 'old', itemKey: 'note:a', timestamp: NOW - 10 }],
      }),
    );
    const app = startApp();
    app.dispatch(recordPalettePick('new', 'note:b', NOW));
    expect(getPalettePicks(app.palette()).map((pick) => pick.query)).toEqual(['new', 'old']);
  });

  it.each([
    { label: 'non-JSON shape', stored: 'garbage' },
    { label: 'wrong field types', stored: { version: 1, picks: 'x', mru: {}, fileMru: [] } },
    {
      label: 'invalid entries',
      stored: {
        version: 1,
        picks: [{ query: 1, itemKey: 'a', timestamp: NOW }, null, { query: 'q' }],
        mru: [{ type: 'unknown', id: 'x', timestamp: NOW }],
        fileMru: { 'a.ts': 'yesterday' },
      },
    },
    { label: 'a future version', stored: { version: 99, picks: [] } },
  ])('ignores corrupt storage ($label) and keeps saving', async ({ stored }) => {
    storage.saved.set(PALETTE_MEMORY_STORAGE_KEY, JSON.stringify(stored));
    const app = startApp();
    expect(app.palette()).toEqual(initialState);

    app.dispatch(recordPalettePick('ag', 'agent:a1', NOW));
    await app.stop();
    expect(getPalettePicks(startApp().palette())).toHaveLength(1);
  });

  it('survives a storage read failure', async () => {
    storage.failReads = true;
    const app = startApp();
    expect(app.palette()).toEqual(initialState);
    app.dispatch(recordPalettePick('ag', 'agent:a1', NOW));
    storage.failReads = false;
    await app.stop();
    expect(getPalettePicks(startApp().palette())).toHaveLength(1);
  });

  it('drops picks older than the fade window when loading', async () => {
    storage.saved.set(
      PALETTE_MEMORY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        picks: [
          { query: 'fresh', itemKey: 'note:a', timestamp: NOW - 1_000 },
          { query: 'stale', itemKey: 'note:b', timestamp: NOW - PALETTE_PICK_FADE_MS - 1 },
        ],
      }),
    );
    expect(getPalettePicks(startApp().palette()).map((pick) => pick.query)).toEqual(['fresh']);
  });

  it('trims stored picks to the cap, newest first', async () => {
    storage.saved.set(
      PALETTE_MEMORY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        picks: Array.from({ length: MAX_PALETTE_PICKS + 50 }, (_, index) => ({
          query: `q${index}`,
          itemKey: `note:${index}`,
          timestamp: NOW - index,
        })),
      }),
    );
    const picks = getPalettePicks(startApp().palette());
    expect(picks).toHaveLength(MAX_PALETTE_PICKS);
    expect(picks[0].query).toBe('q0');
    expect(picks.at(-1)?.query).toBe(`q${MAX_PALETTE_PICKS - 1}`);
  });
});
