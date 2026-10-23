/**
 * Agent-idle toast service tests — the in-app replacement for the OS banner
 * the main process skips while the app is frontmost. Locks in: content from
 * structured parts (who + where), the plain fallback, suppression only when
 * this focused window already has the workspace selected, chief exemption,
 * stable per-workspace ids, and Switch To routing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  custom: vi.fn(),
  dismiss: vi.fn(),
  keySlot: vi.fn((_workspaceId: string | undefined): number | null => null),
  navigate: vi.fn(() => Promise.resolve()),
  switchToAgent: vi.fn(() => Promise.resolve()),
  state: { value: { tabState: { currentTabId: null as string | null } } },
}));

vi.mock('$lib/components/patterns/notify', () => ({
  notify: { custom: mocks.custom, dismiss: mocks.dismiss },
}));
vi.mock('$lib/components/ui/toast', () => ({ AgentIdleToast: 'AgentIdleToast' }));
vi.mock('$features/hardware-console/assignment/connected-key-slot', () => ({
  resolveConnectedWorkspaceKeySlot: mocks.keySlot,
}));
vi.mock('./notification-navigation', () => ({ handleNotificationNavigate: mocks.navigate }));
vi.mock('$features/agent/agent-attention-toast-service', () => ({
  switchToAttentionAgent: mocks.switchToAgent,
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ dispatch: vi.fn(), state: () => mocks.state.value });
});

import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { agentIdleToastId, showAgentIdleToast } from './agent-idle-toast-service';

const structuredPayload = {
  title: 'My Space - Implementor: Fix toast',
  body: 'Task completed',
  timestamp: '2026-10-23T00:00:00Z',
  structured: {
    workspaceTitle: 'My Space',
    specialist: 'implementor',
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
    mocks.state.value = { tabState: { currentTabId: null } };
    hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });
  afterEach(() => hasFocus.mockRestore());

  it('names who finished and where, with a stable per-workspace id', async () => {
    mocks.keySlot.mockReturnValue(2);
    await showAgentIdleToast(structuredPayload);
    const { component, options } = lastToast();
    expect(component).toBe('AgentIdleToast');
    expect(options.id).toBe('agent-idle:ws-1');
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

  it('uses the plain title/body for Assistant payloads and never suppresses them', async () => {
    mocks.state.value = { tabState: { currentTabId: CHIEF_WORKSPACE_ID } };
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
    expect(mocks.keySlot).not.toHaveBeenCalled();
  });

  it('does nothing without a navigate target (sound-only delivery)', async () => {
    await showAgentIdleToast({ title: 'x', body: 'y' });
    await showAgentIdleToast({ title: 'x', navigateTarget: {} });
    expect(mocks.custom).not.toHaveBeenCalled();
  });

  it('is suppressed only when this focused window has the workspace selected', async () => {
    mocks.state.value = { tabState: { currentTabId: 'ws-1' } };
    await showAgentIdleToast(structuredPayload);
    expect(mocks.custom).not.toHaveBeenCalled();

    hasFocus.mockReturnValue(false);
    await showAgentIdleToast(structuredPayload);
    expect(mocks.custom).toHaveBeenCalledTimes(1);

    hasFocus.mockReturnValue(true);
    mocks.state.value = { tabState: { currentTabId: 'ws-2' } };
    await showAgentIdleToast(structuredPayload);
    expect(mocks.custom).toHaveBeenCalledTimes(2);
  });

  it('Switch To dismisses and opens the agent conversation in its workspace', async () => {
    await showAgentIdleToast(structuredPayload);
    lastToast().options.componentProps.onSwitchTo();
    await vi.waitFor(() => expect(mocks.switchToAgent).toHaveBeenCalledWith('ws-1', 'agent-1'));
    expect(mocks.dismiss).toHaveBeenCalledWith('agent-idle:ws-1');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('Switch To routes Assistant payloads through the notification-click navigation', async () => {
    const navigateTarget = { workspaceId: CHIEF_WORKSPACE_ID, chief: true, agentId: 'chat-1' };
    await showAgentIdleToast({ title: 'Assistant', navigateTarget });
    lastToast().options.componentProps.onSwitchTo();
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(navigateTarget));
    expect(mocks.switchToAgent).not.toHaveBeenCalled();
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
