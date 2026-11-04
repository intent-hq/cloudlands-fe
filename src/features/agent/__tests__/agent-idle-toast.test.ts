/**
 * Agent-idle toast tests — the in-app replacement for the OS banner the main
 * process skips while the app is frontmost. Locks in: only Assistant chats
 * toast (workspace completions show on their tab instead), suppression only
 * when this focused window already shows that chat on the home page, stable
 * per-chat ids with latest-wins ordering, and Switch To routing like a
 * notification click.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  custom: vi.fn(),
  dismiss: vi.fn(),
  dispatch: vi.fn(),
  notificationNavigate: vi.fn(() => Promise.resolve()),
  state: {
    value: {
      tabState: { currentTabId: null as string | null },
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
import { agentIdleToastId, showAgentIdleToast } from '../agent-attention-toast-service';

const chiefPayload = (agentId: string) => ({
  title: 'Assistant: Planning',
  body: 'Finished',
  timestamp: '2026-10-23T00:00:00Z',
  navigateTarget: { workspaceId: CHIEF_WORKSPACE_ID, chief: true, agentId },
});

function lastToast() {
  const [component, options] = mocks.custom.mock.calls.at(-1)!;
  return { component, options };
}

describe('showAgentIdleToast', () => {
  let hasFocus: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.value = {
      tabState: { currentTabId: null },
      sidebarNav: { panelItem: null, chiefActiveAgentId: null },
    };
    hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    hasFocus.mockRestore();
    window.history.replaceState(null, '', '/');
  });

  it('shows the Assistant title and body with a stable per-chat id', async () => {
    await showAgentIdleToast(chiefPayload('chat-1'));
    const { component, options } = lastToast();
    expect(component).toBe('AgentIdleToast');
    expect(options.id).toBe(`agent-idle:${CHIEF_WORKSPACE_ID}:chat-1`);
    expect(options.componentProps).toMatchObject({
      title: 'Assistant: Planning',
      description: 'Finished',
      timestamp: '2026-10-23T00:00:00Z',
      keySlot: null,
    });
  });

  it('never toasts a workspace completion', async () => {
    await showAgentIdleToast({
      title: 'My Space - Implementor: Fix toast',
      body: 'Task completed',
      structured: { specialistDisplayName: 'Implementor', agentId: 'agent-1' },
      navigateTarget: { workspaceId: 'ws-1' },
    });
    expect(mocks.custom).not.toHaveBeenCalled();
  });

  it('does nothing without a navigate target (sound-only delivery)', async () => {
    await showAgentIdleToast({ title: 'x', body: 'y' });
    await showAgentIdleToast({ title: 'x', navigateTarget: {} });
    expect(mocks.custom).not.toHaveBeenCalled();
  });

  describe('Assistant chat already open', () => {
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

  it('lets only the latest of overlapping shows for a chat render', async () => {
    const first = showAgentIdleToast({ ...chiefPayload('chat-1'), title: 'Older' });
    const second = showAgentIdleToast(chiefPayload('chat-1'));
    await Promise.all([first, second]);
    expect(mocks.custom).toHaveBeenCalledTimes(1);
    expect(lastToast().options.componentProps.title).toBe('Assistant: Planning');
  });

  it('Switch To routes through the notification-click navigation', async () => {
    const payload = chiefPayload('chat-1');
    await showAgentIdleToast(payload);
    lastToast().options.componentProps.onSwitchTo();
    await vi.waitFor(() =>
      expect(mocks.notificationNavigate).toHaveBeenCalledWith(payload.navigateTarget),
    );
    expect(mocks.dismiss).toHaveBeenCalledWith(`agent-idle:${CHIEF_WORKSPACE_ID}:chat-1`);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('close dismisses the toast', async () => {
    await showAgentIdleToast(chiefPayload('chat-1'));
    lastToast().options.componentProps.onClose();
    expect(mocks.dismiss).toHaveBeenCalledWith(`agent-idle:${CHIEF_WORKSPACE_ID}:chat-1`);
  });

  it('agentIdleToastId is per Assistant chat', () => {
    expect(agentIdleToastId({ workspaceId: CHIEF_WORKSPACE_ID, chief: true, agentId: 'a' })).toBe(
      `agent-idle:${CHIEF_WORKSPACE_ID}:a`,
    );
  });
});
