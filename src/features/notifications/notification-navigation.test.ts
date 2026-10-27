import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleNotificationNavigate } from './notification-navigation';
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { setChiefActiveAgentId } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import {
  openWorkspaceFile,
  openWorkspaceNote,
} from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), dispatch: vi.fn() }));
vi.mock('$lib/utils/navigation.client', () => ({ navigateToRoute: mocks.navigate }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});

describe('exact conversation navigation', () => {
  beforeEach(() => {
    mocks.navigate.mockReset().mockResolvedValue(undefined);
    mocks.dispatch.mockClear();
    window.history.replaceState({}, '', '/');
  });

  it('opens the selected agent after entering its workspace', async () => {
    let finishNavigation!: () => void;
    mocks.navigate.mockReturnValue(new Promise<void>((resolve) => (finishNavigation = resolve)));
    const work = handleNotificationNavigate({ workspaceId: 'workspace-one', agentId: 'agent-two' });
    expect(mocks.dispatch).not.toHaveBeenCalled();
    finishNavigation();
    await work;
    expect(mocks.navigate).toHaveBeenCalledWith('/workspace/workspace-one');
    expect(mocks.dispatch).toHaveBeenCalledWith(
      openAgentTabRequested('workspace-one', { agentId: 'agent-two' }),
    );
  });

  it('selects the exact Assistant thread', async () => {
    await handleNotificationNavigate({ workspaceId: CHIEF_WORKSPACE_ID, agentId: 'chief-thread' });
    expect(mocks.dispatch).toHaveBeenCalledWith(setChiefActiveAgentId('chief-thread'));
    expect(mocks.navigate).toHaveBeenCalledWith('/');
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
    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith(
      openWorkspaceFile('workspace-one', 'src/app.ts', {
        line: 42,
        gitRootId: 'root-two',
        filePathIsLiteral: true,
      }),
    );
  });

  it('does not open a stale note when a newer conversation overtakes navigation', async () => {
    let finishOlder!: () => void;
    mocks.navigate.mockReturnValueOnce(new Promise<void>((resolve) => (finishOlder = resolve)));
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
    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith(
      openWorkspaceNote('workspace-one', 'note-new'),
    );
  });

  it('keeps the latest agent selection when an older navigation finishes late', async () => {
    let finishOlder!: () => void;
    mocks.navigate.mockReturnValueOnce(new Promise<void>((resolve) => (finishOlder = resolve)));
    const older = handleNotificationNavigate({
      workspaceId: 'workspace-one',
      agentId: 'agent-old',
    });
    await handleNotificationNavigate({ workspaceId: 'workspace-one', agentId: 'agent-new' });
    finishOlder();
    await older;
    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith(
      openAgentTabRequested('workspace-one', { agentId: 'agent-new' }),
    );
  });

  it.each(['/dock', '/hud', '/annotation/toolbar', '/dev-console'])(
    'keeps the auxiliary %s renderer on its own route',
    async (route) => {
      window.history.replaceState({}, '', route);
      await handleNotificationNavigate({ workspaceId: 'workspace-one', agentId: 'agent-two' });
      expect(mocks.navigate).not.toHaveBeenCalled();
      expect(mocks.dispatch).not.toHaveBeenCalled();
    },
  );

  it('does not activate an agent when workspace navigation failed', async () => {
    mocks.navigate.mockRejectedValue(new Error('Navigation unavailable'));
    await handleNotificationNavigate({ workspaceId: 'workspace-one', agentId: 'agent-two' });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
