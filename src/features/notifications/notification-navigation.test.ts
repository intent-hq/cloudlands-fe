import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  selectCurrentWorkspaceTabId,
  selectIsWorkspaceTabOpen,
  selectWorkspaceTabOrder,
} from '$store/renderer/slices/tab-state/tab-state-selectors';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import { handleNotificationNavigate } from './notification-navigation';

const mocks = vi.hoisted(() => ({
  route: vi.fn<(route: string) => Promise<void>>(async () => {}),
}));
vi.mock('$lib/utils/navigation.client', async () => {
  const { landingNavigation } =
    await import('$store/renderer/utils/test-helpers/landing-navigation');
  return { navigateToRoute: landingNavigation(mocks.route) };
});

describe('handleNotificationNavigate', () => {
  let dispose: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/workspace/open-ws');
    dispose = store.init();
    store.dispatch(openWorkspaceTab('open-ws'));
  });

  afterEach(() => {
    dispose();
    window.history.replaceState({}, '', '/');
  });

  it('opens and focuses the tab for a workspace that is not open', async () => {
    expect(selectIsWorkspaceTabOpen.select(store.state, 'closed-ws')).toBe(false);

    await handleNotificationNavigate({ workspaceId: 'closed-ws' });

    expect(mocks.route).toHaveBeenCalledWith('/workspace/closed-ws');
    expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['open-ws', 'closed-ws']);
    expect(selectCurrentWorkspaceTabId.select(store.state)).toBe('closed-ws');
  });

  it('leaves the tab strip untouched when navigation fails', async () => {
    mocks.route.mockRejectedValueOnce(new Error('navigation aborted'));

    await expect(handleNotificationNavigate({ workspaceId: 'closed-ws' })).resolves.toBeUndefined();

    expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['open-ws']);
    expect(selectCurrentWorkspaceTabId.select(store.state)).toBe('open-ws');
  });

  it('encodes the workspace id in the route but opens the tab for the raw id', async () => {
    await handleNotificationNavigate({ workspaceId: 'a/b?c' });

    expect(mocks.route).toHaveBeenCalledWith('/workspace/a%2Fb%3Fc');
    expect(selectCurrentWorkspaceTabId.select(store.state)).toBe('a/b?c');
  });

  it('switches to an already-open workspace without adding a duplicate tab', async () => {
    store.dispatch(openWorkspaceTab('other-ws'));
    expect(selectCurrentWorkspaceTabId.select(store.state)).toBe('other-ws');

    await handleNotificationNavigate({ workspaceId: 'open-ws' });

    expect(mocks.route).toHaveBeenCalledWith('/workspace/open-ws');
    expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['open-ws', 'other-ws']);
    expect(selectCurrentWorkspaceTabId.select(store.state)).toBe('open-ws');
  });

  it.each([
    { label: 'chief flag', payload: { workspaceId: 'some-ws', chief: true } },
    { label: 'chief workspace id', payload: { workspaceId: CHIEF_WORKSPACE_ID as string } },
  ])('opens the Assistant without adding a workspace tab ($label)', async ({ payload }) => {
    await handleNotificationNavigate(payload);

    expect(mocks.route).toHaveBeenCalledWith('/');
    expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['open-ws']);
    expect(selectCurrentWorkspaceTabId.select(store.state)).toBe('open-ws');
  });

  it.each([null, undefined, {}])('ignores a payload without a workspace id (%o)', async (data) => {
    await handleNotificationNavigate(data);

    expect(mocks.route).not.toHaveBeenCalled();
    expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['open-ws']);
  });

  it('does nothing in the HUD window', async () => {
    window.history.replaceState({}, '', '/hud');

    await handleNotificationNavigate({ workspaceId: 'closed-ws' });

    expect(mocks.route).not.toHaveBeenCalled();
    expect(selectIsWorkspaceTabOpen.select(store.state, 'closed-ws')).toBe(false);
  });
});
