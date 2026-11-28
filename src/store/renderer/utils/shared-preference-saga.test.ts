import type { Action } from '@redux-saga/types';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { select } from 'typed-redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  followSharedPreference,
  isSharedPreferenceHydration,
  sharedPreferenceSaga,
  type SharedPreferenceSagaOptions,
} from './shared-preference-saga';

interface Layout {
  side: 'left' | 'right';
  width: number;
}

interface ViewState {
  layout: Layout;
  hostId: string;
}

type LayoutAction = Action<string> & { layout?: Partial<Layout> };

const KEY = 'test:layout';
const DEFAULT_LAYOUT: Layout = { side: 'left', width: 200 };

const layoutChanged = (layout: Partial<Layout>): LayoutAction => ({
  type: 'layout/changed',
  layout,
});
const layoutLoaded = (layout: Layout): LayoutAction => ({ type: 'layout/loaded', layout });

function parseLayout(stored: unknown): Layout | undefined {
  const layout = stored as Partial<Layout> | null;
  return (layout?.side === 'left' || layout?.side === 'right') && typeof layout.width === 'number'
    ? { side: layout.side, width: layout.width }
    : undefined;
}

const appLayout: SharedPreferenceSagaOptions<Layout> = {
  key: KEY,
  scope: 'app',
  parse: parseLayout,
  hydrate: (layout, source) =>
    layout !== undefined || source === 'storage' ? layoutLoaded(layout ?? DEFAULT_LAYOUT) : null,
  persistOn: ['layout/changed', 'layout/loaded'],
  *select() {
    return (yield* select((state: ViewState) => state.layout)) as Layout;
  },
};

const hostLayout: SharedPreferenceSagaOptions<Layout> = {
  ...appLayout,
  scope: 'host',
  *key() {
    return `${KEY}:${(yield* select((state: ViewState) => state.hostId)) as string}`;
  },
};

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const stored = (key = KEY): unknown => JSON.parse(window.localStorage.getItem(key) ?? 'null');

/** Another view of the app saved `value` under `key` (`null` removes it). */
function otherViewSaves(key: string, value: unknown): void {
  if (value === null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new StorageEvent('storage', { key }));
}

const tasks: Task[] = [];

/** One view of the app: its own store and saga, on the storage every view shares. */
function startView(options: SharedPreferenceSagaOptions<Layout>, hostId = 'local') {
  const state: ViewState = { layout: DEFAULT_LAYOUT, hostId };
  const channel = stdChannel();
  const dispatched: LayoutAction[] = [];
  const dispatch = (action: LayoutAction) => {
    dispatched.push(action);
    if (action.layout) state.layout = { ...state.layout, ...action.layout };
    channel.put(action);
    return action;
  };
  const task = runSaga({ channel, dispatch, getState: () => state }, function* () {
    yield* sharedPreferenceSaga(options);
  });
  tasks.push(task);
  return { dispatch, dispatched, state, task };
}

describe('sharedPreferenceSaga', () => {
  afterEach(() => {
    for (const task of tasks.splice(0)) task.cancel();
  });

  it('loads the saved value at boot and saves a change', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ side: 'right', width: 320 }));
    const view = startView(appLayout);
    await settle();
    expect(view.state.layout).toEqual({ side: 'right', width: 320 });

    view.dispatch(layoutChanged({ width: 400 }));
    await settle();
    expect(stored()).toEqual({ side: 'right', width: 400 });
  });

  it('keeps the default when nothing valid is saved', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ side: 'top' }));
    const view = startView(appLayout);
    await settle();
    expect(view.dispatched).toEqual([]);
    expect(view.state.layout).toEqual(DEFAULT_LAYOUT);
  });

  it("applies another view's change", async () => {
    const view = startView(appLayout);
    await settle();
    otherViewSaves(KEY, { side: 'right', width: 250 });
    await settle();
    expect(view.state.layout).toEqual({ side: 'right', width: 250 });
  });

  it('ignores a change to an unrelated key', async () => {
    const view = startView(appLayout);
    await settle();
    otherViewSaves('test:unrelated', { side: 'right', width: 250 });
    await settle();
    expect(view.dispatched).toEqual([]);
    expect(view.state.layout).toEqual(DEFAULT_LAYOUT);
  });

  it('loads again when storage is cleared', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ side: 'right', width: 320 }));
    const view = startView(appLayout);
    await settle();
    window.localStorage.removeItem(KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    await settle();
    expect(view.state.layout).toEqual(DEFAULT_LAYOUT);
  });

  it('cannot save a stale value over a newer one from another view', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ side: 'left', width: 200 }));
    const view = startView(appLayout);
    await settle();

    otherViewSaves(KEY, { side: 'right', width: 200 });
    await settle();
    view.dispatch(layoutChanged({ width: 480 }));
    await settle();

    expect(stored()).toEqual({ side: 'right', width: 480 });
  });

  it('does not save a loaded value back', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ side: 'right', width: 320 }));
    const view = startView(appLayout);
    await settle();
    const write = vi.mocked(window.localStorage.setItem);
    write.mockClear();
    otherViewSaves(KEY, { side: 'left', width: 111 });
    await settle();

    expect(view.dispatched.map(isSharedPreferenceHydration)).toEqual([true, true]);
    // Only the other view's own save.
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('follows only the key of its own host', async () => {
    const view = startView(hostLayout, 'remote-1');
    await settle();
    otherViewSaves(`${KEY}:local`, { side: 'right', width: 250 });
    await settle();
    expect(view.state.layout).toEqual(DEFAULT_LAYOUT);

    otherViewSaves(`${KEY}:remote-1`, { side: 'right', width: 300 });
    await settle();
    expect(view.state.layout).toEqual({ side: 'right', width: 300 });

    view.dispatch(layoutChanged({ width: 310 }));
    await settle();
    expect(stored(`${KEY}:remote-1`)).toEqual({ side: 'right', width: 310 });
    expect(stored(`${KEY}:local`)).toEqual({ side: 'right', width: 250 });
  });

  it('keeps watching after a storage failure', async () => {
    const view = startView(appLayout);
    await settle();
    vi.mocked(window.localStorage.setItem).mockImplementationOnce(() => {
      throw new Error('quota');
    });
    view.dispatch(layoutChanged({ width: 300 }));
    view.dispatch(layoutChanged({ width: 301 }));
    await settle();
    expect(stored()).toEqual({ side: 'left', width: 301 });
  });

  it('stops saving and following when cancelled', async () => {
    const view = startView(appLayout);
    await settle();
    view.task.cancel();
    await view.task.toPromise();

    view.dispatch(layoutChanged({ width: 999 }));
    otherViewSaves(KEY, { side: 'right', width: 250 });
    await settle();
    expect(view.state.layout).toEqual({ side: 'left', width: 999 });
    expect(view.dispatched).toHaveLength(1);
  });
});

describe('followSharedPreference', () => {
  it('dispatches each value a non-saga preference reports', async () => {
    let report: (value: string) => void = () => {};
    let stopped = false;
    const dispatched: Action[] = [];
    const task = runSaga(
      { dispatch: (action: Action) => dispatched.push(action), getState: () => ({}) },
      function* () {
        yield* followSharedPreference<string>(
          (listener) => {
            report = listener;
            return () => {
              stopped = true;
            };
          },
          (value) => ({ type: 'engine/loaded', value }) as Action,
        );
      },
    );
    report('os');
    await settle();
    expect(dispatched).toEqual([{ type: 'engine/loaded', value: 'os' }]);
    expect(isSharedPreferenceHydration(dispatched[0])).toBe(true);

    task.cancel();
    await task.toPromise();
    expect(stopped).toBe(true);
  });
});
