import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga } from 'redux-saga';
import { store } from '$store/renderer/store';
import {
  selectCurrentWorkspaceTabId,
  selectWorkspaceTabOrder,
} from '$store/renderer/slices/tab-state/tab-state-selectors';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import {
  navigateToAppRoute,
  navigateToAppRouteSaga,
  openAndShowWorkspace,
  parseWorkspaceRoute,
  showWorkspaceSaga,
  workspaceRoute,
} from './show-workspace';
import { bumpNavigationEpoch } from './navigation-epoch';
import { goto as ctGoto } from '../../../playwright/app-stubs/navigation';

const mocks = vi.hoisted(() => ({
  route: vi.fn<(route: string, options?: { state?: App.PageState }) => Promise<void>>(),
}));

/** Share the CT router fixture so unit and browser jumps land on the same route. */
async function land(route: string): Promise<void> {
  await ctGoto(route);
}
vi.mock('./navigation.client', () => ({ navigateToRoute: mocks.route }));

describe('workspaceRoute', () => {
  it('encodes the workspace id', () => {
    expect(workspaceRoute('a/b?c')).toBe('/workspace/a%2Fb%3Fc');
  });

  it('appends encoded search params', () => {
    expect(workspaceRoute('ws-1', { note: 'n 1', panel: 'terminal' })).toBe(
      '/workspace/ws-1?note=n+1&panel=terminal',
    );
  });

  it('omits an empty query', () => {
    expect(workspaceRoute('ws-1', {})).toBe('/workspace/ws-1');
  });
});

describe('parseWorkspaceRoute', () => {
  it.each([
    ['/workspace/ws-1', 'ws-1'],
    ['/workspace/ws-1/', 'ws-1'],
    ['/workspace/ws-1?note=n1#top', 'ws-1'],
    ['/workspace/a%2Fb', 'a/b'],
  ])('reads the workspace id from %s', (route, workspaceId) => {
    expect(parseWorkspaceRoute(route)).toBe(workspaceId);
  });

  it.each([
    '/',
    '/settings',
    '/workspace/new',
    '/workspace/',
    '/workspace/ws-1/files',
    '/workspace/%E0',
  ])('is null for %s', (route) => {
    expect(parseWorkspaceRoute(route)).toBeNull();
  });
});

describe('openAndShowWorkspace', () => {
  let dispose: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.route.mockImplementation(land);
    window.history.replaceState({}, '', '/workspace/open-ws');
    dispose = store.init();
    store.dispatch(openWorkspaceTab('open-ws'));
  });

  afterEach(() => {
    dispose();
    window.history.replaceState({}, '', '/');
  });

  it('navigates, then opens and focuses the tab of a workspace that is not open', async () => {
    let tabsDuringNavigation: string[] = [];
    mocks.route.mockImplementationOnce(async (route) => {
      tabsDuringNavigation = [...selectWorkspaceTabOrder.select(store.state)];
      await land(route);
    });

    await expect(openAndShowWorkspace('closed-ws')).resolves.toBe(true);

    expect(mocks.route).toHaveBeenCalledWith('/workspace/closed-ws');
    expect(tabsDuringNavigation).toEqual(['open-ws']);
    expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['open-ws', 'closed-ws']);
    expect(selectCurrentWorkspaceTabId.select(store.state)).toBe('closed-ws');
  });

  it('encodes the route but opens the tab for the raw id', async () => {
    await expect(openAndShowWorkspace('a/b?c')).resolves.toBe(true);

    expect(mocks.route).toHaveBeenCalledWith('/workspace/a%2Fb%3Fc');
    expect(selectCurrentWorkspaceTabId.select(store.state)).toBe('a/b?c');
  });

  it('forwards the query to the route', async () => {
    await openAndShowWorkspace('closed-ws', { query: { panel: 'terminal' } });

    expect(mocks.route).toHaveBeenCalledWith('/workspace/closed-ws?panel=terminal');
    expect(selectCurrentWorkspaceTabId.select(store.state)).toBe('closed-ws');
  });

  it('switches to an already-open workspace without a duplicate tab', async () => {
    store.dispatch(openWorkspaceTab('other-ws'));

    await openAndShowWorkspace('open-ws');

    expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['open-ws', 'other-ws']);
    expect(selectCurrentWorkspaceTabId.select(store.state)).toBe('open-ws');
  });

  it('rethrows a failed navigation and leaves the tab strip untouched', async () => {
    mocks.route.mockRejectedValueOnce(new Error('navigation aborted'));

    await expect(openAndShowWorkspace('closed-ws')).rejects.toThrow('navigation aborted');

    expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['open-ws']);
    expect(selectCurrentWorkspaceTabId.select(store.state)).toBe('open-ws');
  });

  it('does nothing in the HUD window, which never navigates', async () => {
    window.history.replaceState({}, '', '/hud');

    await expect(openAndShowWorkspace('closed-ws')).resolves.toBe(false);

    expect(mocks.route).not.toHaveBeenCalled();
    expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['open-ws']);
    expect(selectCurrentWorkspaceTabId.select(store.state)).toBe('open-ws');
  });

  it('does nothing for an empty id', async () => {
    await expect(openAndShowWorkspace('')).resolves.toBe(false);

    expect(mocks.route).not.toHaveBeenCalled();
  });

  it('forwards page state and tags the tab with its presence follow request id', async () => {
    const dispatch = vi.spyOn(store, 'dispatch');

    await openAndShowWorkspace('closed-ws', { state: { presenceFollowRequestId: 'req-1' } });

    expect(mocks.route).toHaveBeenCalledWith('/workspace/closed-ws', {
      state: { presenceFollowRequestId: 'req-1' },
    });
    expect(dispatch).toHaveBeenCalledWith(openWorkspaceTab('closed-ws', 'req-1'));
    dispatch.mockRestore();
    expect(selectCurrentWorkspaceTabId.select(store.state)).toBe('closed-ws');
  });
});

describe('superseded jumps and string routes', () => {
  let dispose: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.route.mockImplementation(land);
    window.history.replaceState({}, '', '/');
    dispose = store.init();
  });

  afterEach(() => {
    dispose();
  });

  it('opens only the tab of the latest jump when an earlier navigation resolves late', async () => {
    let finishFirst: () => void = () => {};
    mocks.route.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );

    const first = openAndShowWorkspace('skipped-ws');
    await expect(openAndShowWorkspace('landed-ws')).resolves.toBe(true);
    finishFirst();

    await expect(first).resolves.toBe(false);
    expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['landed-ws']);
    expect(selectCurrentWorkspaceTabId.select(store.state)).toBe('landed-ws');
  });

  it('opens no tab when another navigation left the window elsewhere', async () => {
    // SvelteKit resolves a goto that a later navigation abandoned.
    mocks.route.mockImplementationOnce(async () => land('/settings'));

    await expect(openAndShowWorkspace('skipped-ws')).resolves.toBe(false);

    expect(selectWorkspaceTabOrder.select(store.state)).toEqual([]);
  });

  it('opens no tab when another workspace tab was picked during navigation', async () => {
    store.dispatch(openWorkspaceTab('open-ws'));
    mocks.route.mockImplementationOnce(async () => {
      // A tab-strip click selects its tab before navigating.
      store.dispatch(openWorkspaceTab('picked-ws'));
    });

    await expect(openAndShowWorkspace('skipped-ws')).resolves.toBe(false);

    expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['open-ws', 'picked-ws']);
    expect(selectCurrentWorkspaceTabId.select(store.state)).toBe('picked-ws');
  });

  it('opens no tab when a later navigateToRoute started while the jump was pending', async () => {
    // An encoder click to Home while still on Home: same route, but the real
    // navigateToRoute marks the newer navigation.
    mocks.route.mockImplementationOnce(async () => {
      await Promise.resolve();
      bumpNavigationEpoch();
    });

    await expect(openAndShowWorkspace('skipped-ws')).resolves.toBe(false);

    expect(selectWorkspaceTabOrder.select(store.state)).toEqual([]);
  });

  it('opens no tab when a raw goto back to the start route replaced the jump', async () => {
    // Start a slow jump from Home, then click the sidebar Home button: its
    // raw goto('/') replaces the jump without touching the navigation epoch.
    mocks.route.mockImplementationOnce(async () => land('/'));

    await expect(openAndShowWorkspace('skipped-ws')).resolves.toBe(false);

    expect(selectWorkspaceTabOrder.select(store.state)).toEqual([]);
  });

  it('navigates a workspace route unchanged and opens its tab', async () => {
    await navigateToAppRoute('/workspace/a%2Fb?panel=terminal');

    expect(mocks.route).toHaveBeenCalledWith('/workspace/a%2Fb?panel=terminal');
    expect(selectCurrentWorkspaceTabId.select(store.state)).toBe('a/b');
  });

  it.each(['/settings', '/workspace/new'])('navigates %s without opening a tab', async (route) => {
    await navigateToAppRoute(route);

    expect(mocks.route).toHaveBeenCalledWith(route);
    expect(selectWorkspaceTabOrder.select(store.state)).toEqual([]);
  });
});

describe('showWorkspaceSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.route.mockImplementation(land);
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  let sagaState: { tabState: { currentTabId: string | null } };

  async function run(...args: Parameters<typeof showWorkspaceSaga>) {
    const dispatched: unknown[] = [];
    const result = await runSaga(
      { dispatch: (action) => dispatched.push(action), getState: () => sagaState },
      showWorkspaceSaga,
      ...args,
    ).toPromise();
    return { result, dispatched };
  }

  beforeEach(() => {
    sagaState = { tabState: { currentTabId: 'open-ws' } };
  });

  it('puts nothing when another workspace tab was picked during navigation', async () => {
    mocks.route.mockImplementationOnce(async () => {
      sagaState = { tabState: { currentTabId: 'picked-ws' } };
    });

    const { result, dispatched } = await run('ws-1');

    expect(result).toBe(false);
    expect(dispatched).toEqual([]);
  });

  it('puts nothing when a raw goto back to the start route replaced the jump', async () => {
    mocks.route.mockImplementationOnce(async () => land('/'));

    const { result, dispatched } = await run('ws-1');

    expect(result).toBe(false);
    expect(dispatched).toEqual([]);
  });

  it('puts nothing when another navigation left the window elsewhere', async () => {
    mocks.route.mockImplementationOnce(async () => land('/settings'));

    const { result, dispatched } = await run('ws-1');

    expect(result).toBe(false);
    expect(dispatched).toEqual([]);
  });

  it('puts nothing when a later navigateToRoute started while the jump was pending', async () => {
    mocks.route.mockImplementationOnce(async () => {
      await Promise.resolve();
      bumpNavigationEpoch();
    });

    const { result, dispatched } = await run('ws-1');

    expect(result).toBe(false);
    expect(dispatched).toEqual([]);
  });

  it('keeps the route of navigateToAppRouteSaga unchanged and puts the tab', async () => {
    const dispatched: unknown[] = [];
    await runSaga(
      { dispatch: (action) => dispatched.push(action), getState: () => sagaState },
      navigateToAppRouteSaga,
      '/workspace/ws-1?panel=terminal#log',
    ).toPromise();

    expect(mocks.route).toHaveBeenCalledWith('/workspace/ws-1?panel=terminal#log');
    expect(dispatched).toEqual([openWorkspaceTab('ws-1')]);
  });

  it('navigates, then puts openWorkspaceTab', async () => {
    const { result, dispatched } = await run('ws-1', { query: { note: 'n1' } });

    expect(result).toBe(true);
    expect(mocks.route).toHaveBeenCalledWith('/workspace/ws-1?note=n1');
    expect(dispatched).toEqual([openWorkspaceTab('ws-1')]);
  });

  it('puts nothing in the HUD window', async () => {
    window.history.replaceState({}, '', '/hud');

    const { result, dispatched } = await run('ws-1');

    expect(result).toBe(false);
    expect(mocks.route).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);
  });

  it('propagates a failed navigation without putting', async () => {
    mocks.route.mockRejectedValueOnce(new Error('boom'));

    await expect(run('ws-1')).rejects.toThrow('boom');
  });
});
