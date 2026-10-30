import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import { setChiefActiveAgentId } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import {
  openWorkspaceFile,
  openWorkspaceNote,
} from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
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
  let dispatchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.route.mockReset().mockResolvedValue(undefined);
    window.history.replaceState({}, '', '/workspace/open-ws');
    dispose = store.init();
    store.dispatch(openWorkspaceTab('open-ws'));
    dispatchSpy = vi.spyOn(store, 'dispatch');
  });

  afterEach(() => {
    dispatchSpy.mockRestore();
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
  it('opens the selected agent after entering its workspace', async () => {
    let finishNavigation!: () => void;
    mocks.route.mockReturnValue(new Promise<void>((resolve) => (finishNavigation = resolve)));
    const work = handleNotificationNavigate({ workspaceId: 'workspace-one', agentId: 'agent-two' });
    expect(dispatchSpy).not.toHaveBeenCalled();
    finishNavigation();
    await work;
    expect(mocks.route).toHaveBeenCalledWith('/workspace/workspace-one');
    expect(dispatchSpy).toHaveBeenCalledWith(
      openAgentTabRequested('workspace-one', { agentId: 'agent-two' }),
    );
  });

  it('selects the exact Assistant thread', async () => {
    await handleNotificationNavigate({ workspaceId: CHIEF_WORKSPACE_ID, agentId: 'chief-thread' });
    expect(dispatchSpy).toHaveBeenCalledWith(setChiefActiveAgentId('chief-thread'));
    expect(mocks.route).toHaveBeenCalledWith('/');
  });

  it('opens an exact transcript file after its workspace navigation finishes', async () => {
    await handleNotificationNavigate({
      workspaceId: 'workspace-one',
      workspaceTarget: {
        type: 'file',
        filePath: 'src/app.ts',
        line: 42,
        gitRootId: 'root-two',
      },
    });
    expect(dispatchSpy).toHaveBeenCalledWith(
      openWorkspaceFile('workspace-one', 'src/app.ts', {
        line: 42,
        gitRootId: 'root-two',
        filePathIsLiteral: true,
      }),
    );
  });

  it('does not open a stale note when a newer conversation overtakes navigation', async () => {
    let finishOlder!: () => void;
    mocks.route.mockReturnValueOnce(new Promise<void>((resolve) => (finishOlder = resolve)));
    const older = handleNotificationNavigate({
      workspaceId: 'workspace-one',
      workspaceTarget: { type: 'note', noteId: 'note-old' },
    });
    await handleNotificationNavigate({
      workspaceId: 'workspace-one',
      workspaceTarget: { type: 'note', noteId: 'note-new' },
    });
    finishOlder();
    await older;
    expect(dispatchSpy).toHaveBeenCalledWith(openWorkspaceNote('workspace-one', 'note-new'));
    expect(dispatchSpy).not.toHaveBeenCalledWith(openWorkspaceNote('workspace-one', 'note-old'));
  });

  it('keeps the latest agent selection when an older navigation finishes late', async () => {
    let finishOlder!: () => void;
    mocks.route.mockReturnValueOnce(new Promise<void>((resolve) => (finishOlder = resolve)));
    const older = handleNotificationNavigate({
      workspaceId: 'workspace-one',
      agentId: 'agent-old',
    });
    await handleNotificationNavigate({ workspaceId: 'workspace-one', agentId: 'agent-new' });
    finishOlder();
    await older;
    expect(dispatchSpy).toHaveBeenCalledWith(
      openAgentTabRequested('workspace-one', { agentId: 'agent-new' }),
    );
    expect(dispatchSpy).not.toHaveBeenCalledWith(
      openAgentTabRequested('workspace-one', { agentId: 'agent-old' }),
    );
  });

  it.each(['/dock', '/hud', '/annotation/toolbar', '/dev-console'])(
    'keeps the auxiliary %s renderer on its own route',
    async (route) => {
      window.history.replaceState({}, '', route);
      await handleNotificationNavigate({ workspaceId: 'workspace-one', agentId: 'agent-two' });
      expect(mocks.route).not.toHaveBeenCalled();
      expect(dispatchSpy).not.toHaveBeenCalled();
    },
  );

  it('does not activate an agent when workspace navigation failed', async () => {
    mocks.route.mockRejectedValue(new Error('Navigation unavailable'));
    await handleNotificationNavigate({ workspaceId: 'workspace-one', agentId: 'agent-two' });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});
