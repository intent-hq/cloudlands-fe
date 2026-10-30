import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga } from 'redux-saga';
import { store } from '$store/renderer/store';
import {
  selectCurrentWorkspaceTabId,
  selectWorkspaceTabOrder,
} from '$store/renderer/slices/tab-state/tab-state-selectors';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import { openAndShowWorkspace, showWorkspaceSaga, workspaceRoute } from './show-workspace';

const mocks = vi.hoisted(() => ({
  route: vi.fn<(route: string, options?: { state?: App.PageState }) => Promise<void>>(),
}));
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

describe('openAndShowWorkspace', () => {
  let dispose: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.route.mockResolvedValue(undefined);
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
    mocks.route.mockImplementationOnce(async () => {
      tabsDuringNavigation = [...selectWorkspaceTabOrder.select(store.state)];
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

describe('showWorkspaceSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.route.mockResolvedValue(undefined);
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  async function run(...args: Parameters<typeof showWorkspaceSaga>) {
    const dispatched: unknown[] = [];
    const result = await runSaga(
      { dispatch: (action) => dispatched.push(action), getState: () => ({}) },
      showWorkspaceSaga,
      ...args,
    ).toPromise();
    return { result, dispatched };
  }

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
