/**
 * Agent-idle toast tests — the in-app replacement for the OS banner the main
 * process skips while the app is frontmost. Locks in: content from
 * structured parts (who + where), the plain fallback, suppression only when
 * this focused window already shows the target (the selected workspace, or
 * the open Assistant chat on the home page) whatever the sound preference
 * says, stable per-workspace ids with latest-wins ordering, and Switch To
 * routing that leaves any pending attention toast alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  custom: vi.fn(),
  dismiss: vi.fn(),
  dispatch: vi.fn(),
  keySlot: vi.fn((_workspaceId: string | undefined): number | null => null),
  navigateToRoute: vi.fn(() => Promise.resolve()),
  notificationNavigate: vi.fn(() => Promise.resolve()),
  state: {
    value: {
      tabState: { currentTabId: null as string | null },
      userPreferences: { soundOnlyWhenUnfocused: true as boolean | undefined },
      sidebarNav: {
        panelItem: null as 'chief' | null,
        chiefActiveAgentId: null as string | null,
      },
    },
  },
}));

vi.mock('$lib/components/patterns/notify', () => ({
  notify: { custom: mocks.custom, dismiss: mocks.dismiss, info: vi.fn() },
}));
vi.mock('$lib/components/ui/toast', () => ({
  AgentAttentionToast: 'AgentAttentionToast',
  AgentIdleToast: 'AgentIdleToast',
}));
vi.mock('$features/hardware-console/assignment/connected-key-slot', () => ({
  resolveConnectedWorkspaceKeySlot: mocks.keySlot,
}));
// A resolved navigation lands on its route, as SvelteKit's goto does, so the
// shared workspace helper sees the workspace showing and opens its tab.
vi.mock('$lib/utils/navigation.client', () => ({
  navigateToRoute: async (route: string) => {
    await mocks.navigateToRoute(route);
    window.history.replaceState(null, '', route);
  },
  isHudWindowRenderer: () => false,
}));
vi.mock('$features/notifications/notification-navigation', () => ({
  handleNotificationNavigate: mocks.notificationNavigate,
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ dispatch: mocks.dispatch, state: () => mocks.state.value });
});

import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import { agentIdleToastId, showAgentIdleToast } from '../agent-attention-toast-service';

const structuredPayload = {
  title: 'My Space - Implementor: Fix toast',
  body: 'Task completed',
  timestamp: '2026-10-23T00:00:00Z',
  structured: {
    workspaceTitle: 'My Space',
    specialistDisplayName: 'Implementor',
    taskTitle: 'Fix toast',
    agentId: 'agent-1',
    agentName: 'Builder',
  },
  navigateTarget: { workspaceId: 'ws-1' },
};

function lastToast() {
  const [component, options] = mocks.custom.mock.calls.at(-1)!;
  return { component, options };
}

describe('showAgentIdleToast', () => {
  let hasFocus: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.keySlot.mockReturnValue(null);
    mocks.state.value = {
      tabState: { currentTabId: null },
      userPreferences: { soundOnlyWhenUnfocused: true },
      sidebarNav: { panelItem: null, chiefActiveAgentId: null },
    };
    hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
    hasFocus.mockRestore();
    window.history.replaceState(null, '', '/');
  });

  it('names who finished and where, with a stable per-workspace id', async () => {
    mocks.keySlot.mockReturnValue(2);
    await showAgentIdleToast(structuredPayload);
    const { component, options } = lastToast();
    expect(component).toBe('AgentIdleToast');
    expect(options.id).toBe('agent-idle:ws-1');
    expect(options.duration).toBeUndefined();
    expect(options.componentProps).toMatchObject({
      title: 'Builder finished',
      workspaceTitle: 'My Space',
      description: 'Fix toast',
      timestamp: '2026-10-23T00:00:00Z',
      keySlot: 2,
    });
    expect(mocks.keySlot).toHaveBeenCalledWith('ws-1');
  });

  it('falls back to the specialist name and the generic body', async () => {
    await showAgentIdleToast({
      ...structuredPayload,
      body: 'Finished',
      structured: { specialistDisplayName: 'Agent', workspaceTitle: 'My Space' },
    });
    expect(lastToast().options.componentProps).toMatchObject({
      title: 'Agent finished',
      workspaceTitle: 'My Space',
      description: 'Finished',
    });
  });

  it('uses the plain title/body for Assistant payloads', async () => {
    mocks.state.value.tabState.currentTabId = CHIEF_WORKSPACE_ID;
    await showAgentIdleToast({
      title: 'Assistant: Planning',
      body: 'Finished',
      navigateTarget: { workspaceId: CHIEF_WORKSPACE_ID, chief: true, agentId: 'chat-1' },
    });
    const { options } = lastToast();
    expect(options.id).toBe(`agent-idle:${CHIEF_WORKSPACE_ID}:chat-1`);
    expect(options.componentProps).toMatchObject({
      title: 'Assistant: Planning',
      workspaceTitle: undefined,
      description: 'Finished',
      keySlot: null,
    });
  });

  it('does nothing without a navigate target (sound-only delivery)', async () => {
    await showAgentIdleToast({ title: 'x', body: 'y' });
    await showAgentIdleToast({ title: 'x', navigateTarget: {} });
    expect(mocks.custom).not.toHaveBeenCalled();
  });

  it('is suppressed only when this focused window has the workspace selected', async () => {
    mocks.state.value.tabState.currentTabId = 'ws-1';
    window.history.replaceState(null, '', '/workspace/ws-1');
    await showAgentIdleToast(structuredPayload);
    expect(mocks.custom).not.toHaveBeenCalled();

    hasFocus.mockReturnValue(false);
    await showAgentIdleToast(structuredPayload);
    expect(mocks.custom).toHaveBeenCalledTimes(1);

    hasFocus.mockReturnValue(true);
    mocks.state.value.tabState.currentTabId = 'ws-2';
    await showAgentIdleToast(structuredPayload);
    expect(mocks.custom).toHaveBeenCalledTimes(2);
  });

  it('is suppressed on the selected workspace even with "only when unfocused" off', async () => {
    mocks.state.value.tabState.currentTabId = 'ws-1';
    window.history.replaceState(null, '', '/workspace/ws-1');
    mocks.state.value.userPreferences.soundOnlyWhenUnfocused = false;
    await showAgentIdleToast(structuredPayload);
    expect(mocks.custom).not.toHaveBeenCalled();
  });

  it('still shows when the window left the selected workspace for the home page', async () => {
    // Going home keeps the workspace tab selected, but it is not on screen.
    mocks.state.value.tabState.currentTabId = 'ws-1';
    await showAgentIdleToast(structuredPayload);
    expect(mocks.custom).toHaveBeenCalledTimes(1);
  });

  describe('Assistant chat already open', () => {
    const chiefPayload = (agentId: string) => ({
      title: 'Assistant: Planning',
      body: 'Finished',
      navigateTarget: { workspaceId: CHIEF_WORKSPACE_ID, chief: true, agentId },
    });
    beforeEach(() => {
      mocks.state.value.sidebarNav = { panelItem: 'chief', chiefActiveAgentId: 'chat-1' };
    });

    it('is suppressed when this focused window shows that chat on the home page', async () => {
      await showAgentIdleToast(chiefPayload('chat-1'));
      expect(mocks.custom).not.toHaveBeenCalled();
    });

    it('still shows for a different Assistant chat', async () => {
      await showAgentIdleToast(chiefPayload('chat-2'));
      expect(mocks.custom).toHaveBeenCalledTimes(1);
    });

    it('still shows when the Assistant panel is closed', async () => {
      mocks.state.value.sidebarNav.panelItem = null;
      await showAgentIdleToast(chiefPayload('chat-1'));
      expect(mocks.custom).toHaveBeenCalledTimes(1);
    });

    it('still shows when this window is not focused', async () => {
      hasFocus.mockReturnValue(false);
      await showAgentIdleToast(chiefPayload('chat-1'));
      expect(mocks.custom).toHaveBeenCalledTimes(1);
    });

    it('still shows when this window is not on the home page', async () => {
      window.history.replaceState(null, '', '/workspace/ws-1');
      await showAgentIdleToast(chiefPayload('chat-1'));
      expect(mocks.custom).toHaveBeenCalledTimes(1);
    });
  });

  it('lets only the latest of overlapping shows for a workspace render', async () => {
    const first = showAgentIdleToast({
      ...structuredPayload,
      structured: { ...structuredPayload.structured, agentName: 'Older' },
    });
    const second = showAgentIdleToast(structuredPayload);
    await Promise.all([first, second]);
    expect(mocks.custom).toHaveBeenCalledTimes(1);
    expect(lastToast().options.componentProps.title).toBe('Builder finished');
  });

  it('Switch To opens the agent conversation without dismissing its attention toast', async () => {
    await showAgentIdleToast(structuredPayload);
    lastToast().options.componentProps.onSwitchTo();
    await vi.waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        openAgentTabRequested('ws-1', { agentId: 'agent-1' }),
      ),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(openWorkspaceTab('ws-1'));
    expect(mocks.navigateToRoute).toHaveBeenCalledWith('/workspace/ws-1');
    expect(mocks.dismiss.mock.calls).toEqual([['agent-idle:ws-1']]);
    expect(mocks.notificationNavigate).not.toHaveBeenCalled();
  });

  it('Switch To routes Assistant payloads through the notification-click navigation', async () => {
    const navigateTarget = { workspaceId: CHIEF_WORKSPACE_ID, chief: true, agentId: 'chat-1' };
    await showAgentIdleToast({ title: 'Assistant', navigateTarget });
    lastToast().options.componentProps.onSwitchTo();
    await vi.waitFor(() => expect(mocks.notificationNavigate).toHaveBeenCalledWith(navigateTarget));
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('close dismisses the toast', async () => {
    await showAgentIdleToast(structuredPayload);
    lastToast().options.componentProps.onClose();
    expect(mocks.dismiss).toHaveBeenCalledWith('agent-idle:ws-1');
  });

  it('renders without a badge when key-slot resolution throws', async () => {
    mocks.keySlot.mockImplementation(() => {
      throw new Error('no device');
    });
    await showAgentIdleToast(structuredPayload);
    expect(lastToast().options.componentProps.keySlot).toBeNull();
  });

  it('agentIdleToastId is per workspace, and per chat for the Assistant', () => {
    expect(agentIdleToastId({ workspaceId: 'ws-1', agentId: 'a' })).toBe('agent-idle:ws-1');
    expect(agentIdleToastId({ workspaceId: CHIEF_WORKSPACE_ID, chief: true, agentId: 'a' })).toBe(
      `agent-idle:${CHIEF_WORKSPACE_ID}:a`,
    );
  });
});
