/**
 * Agent-attention toast service tests.
 *
 * The toast seam is faked via `vi.mock('svelte-sonner')` (existing pattern);
 * these tests lock in the stickiness contract (duration: Infinity, stable
 * per-agent id, only close/Switch To dismiss) and the "Switch To" wiring
 * (cross-workspace goto + openAgentTabRequested dispatch).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  toastCustomMock,
  toastDismissMock,
  navigateToRouteMock,
  dispatchMock,
  microStatusMock,
  resolvedKeySlotSelectMock,
} = vi.hoisted(() => ({
  toastCustomMock: vi.fn(),
  toastDismissMock: vi.fn(),
  navigateToRouteMock: vi.fn(() => Promise.resolve()),
  dispatchMock: vi.fn(),
  microStatusMock: { value: 'disconnected' },
  resolvedKeySlotSelectMock: vi.fn((_state: unknown, _workspaceId: string): number | null => null),
}));

vi.mock('svelte-sonner', () => ({
  toast: {
    custom: toastCustomMock,
    dismiss: toastDismissMock,
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('$lib/components/ui/toast/AgentAttentionToast.svelte', () => ({
  default: 'AgentAttentionToast',
}));

vi.mock('$lib/utils/navigation.client', () => ({
  navigateToRoute: navigateToRouteMock,
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({ dispatch: dispatchMock });
});

// Seams of the connected key-slot resolver (badge gating): manager status +
// the resolved-slot selector, so the real gate logic in
// resolveConnectedWorkspaceKeySlot is exercised.
vi.mock('$features/hardware-console/instance', () => ({
  getHardwareConsoleManager: () => ({ status: microStatusMock.value }),
}));

vi.mock('$store/renderer/slices/hardware-console/hardware-console-selectors', () => ({
  selectWorkspaceResolvedKeySlot: { select: resolvedKeySlotSelectMock },
}));

import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import {
  agentAttentionToastId,
  dismissAgentAttentionToast,
  showAgentAttentionToast,
  switchToAttentionAgent,
} from '../agent-attention-toast-service';

const WS = 'ws-attn-1';
const AGENT = 'agent-attn-1';

function lastCustomCall(): {
  id: string;
  componentProps: Record<string, any>;
  duration: number;
  class?: string;
} {
  const call = toastCustomMock.mock.calls[toastCustomMock.mock.calls.length - 1];
  expect(call).toBeDefined();
  return call![1];
}

describe('agent-attention-toast-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    microStatusMock.value = 'disconnected';
    resolvedKeySlotSelectMock.mockImplementation(() => null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows a STICKY toast (duration: Infinity) with a stable per-agent id', async () => {
    await showAgentAttentionToast({
      workspaceId: WS,
      agentId: AGENT,
      agentName: 'Implementor',
      kind: 'discussion',
      reason: 'Need a decision on the API shape',
    });

    const call = lastCustomCall();
    expect(call.id).toBe(agentAttentionToastId(AGENT));
    // Stickiness contract: never auto-dismisses.
    expect(call.duration).toBe(Number.POSITIVE_INFINITY);
    expect(call.componentProps.title).toBe('Implementor requests a discussion');
    expect(call.componentProps.reason).toBe('Need a decision on the API shape');
    expect(call.componentProps.kind).toBe('discussion');
    expect(call.class).toBe('!border-primary/50');
  });

  it('flavors blocker toasts with the destructive tint and blocker title', async () => {
    await showAgentAttentionToast({
      workspaceId: WS,
      agentId: AGENT,
      agentName: 'Verifier',
      kind: 'blocker',
      reason: 'CI is red on main',
    });

    const call = lastCustomCall();
    expect(call.componentProps.title).toBe('Verifier reports a blocker');
    expect(call.componentProps.kind).toBe('blocker');
    expect(call.class).toBe('!border-destructive/50');
  });

  describe('micro key-slot badge', () => {
    const request = {
      workspaceId: WS,
      agentId: AGENT,
      agentName: 'Implementor',
      kind: 'discussion' as const,
      reason: 'Need a decision',
    };

    it('carries the resolved key slot when the micro is connected and the workspace holds a slot', async () => {
      microStatusMock.value = 'connected';
      resolvedKeySlotSelectMock.mockImplementation(() => 2);

      await showAgentAttentionToast(request);

      expect(resolvedKeySlotSelectMock).toHaveBeenCalledWith(expect.anything(), WS);
      expect(lastCustomCall().componentProps.keySlot).toBe(2);
    });

    it('carries no key slot when the micro is disconnected, even if the workspace holds one', async () => {
      microStatusMock.value = 'disconnected';
      resolvedKeySlotSelectMock.mockImplementation(() => 2);

      await showAgentAttentionToast(request);

      expect(resolvedKeySlotSelectMock).not.toHaveBeenCalled();
      expect(lastCustomCall().componentProps.keySlot).toBeNull();
    });

    it('carries no key slot when connected but the workspace holds no slot', async () => {
      microStatusMock.value = 'connected';
      resolvedKeySlotSelectMock.mockImplementation(() => null);

      await showAgentAttentionToast(request);

      expect(lastCustomCall().componentProps.keySlot).toBeNull();
    });

    it('still shows the toast (badge-less) when slot resolution throws', async () => {
      microStatusMock.value = 'connected';
      resolvedKeySlotSelectMock.mockImplementation(() => {
        throw new Error('resolver boom');
      });

      await showAgentAttentionToast(request);

      const call = lastCustomCall();
      expect(call.componentProps.title).toBe('Implementor requests a discussion');
      expect(call.componentProps.keySlot).toBeNull();
    });
  });

  it('re-raised requests update the same toast in place (stable id, no stacking)', async () => {
    await showAgentAttentionToast({
      workspaceId: WS,
      agentId: AGENT,
      agentName: 'Implementor',
      kind: 'discussion',
      reason: 'First ask',
    });
    await showAgentAttentionToast({
      workspaceId: WS,
      agentId: AGENT,
      agentName: 'Implementor',
      kind: 'blocker',
      reason: 'Escalated to a blocker',
    });

    expect(toastCustomMock).toHaveBeenCalledTimes(2);
    const ids = toastCustomMock.mock.calls.map(([, data]) => data.id);
    expect(new Set(ids).size).toBe(1);
    expect(lastCustomCall().componentProps.reason).toBe('Escalated to a blocker');
  });

  it('Switch To dismisses the toast, navigates to the reporting workspace, and opens the agent tab', async () => {
    await switchToAttentionAgent(WS, AGENT);

    expect(toastDismissMock).toHaveBeenCalledWith(agentAttentionToastId(AGENT));
    expect(navigateToRouteMock).toHaveBeenCalledWith(`/workspace/${WS}`);
    expect(dispatchMock).toHaveBeenCalledWith(openAgentTabRequested(WS, { agentId: AGENT }));
  });

  it('Switch To still opens the agent tab when navigation rejects', async () => {
    navigateToRouteMock.mockRejectedValueOnce(new Error('nav failed'));

    await switchToAttentionAgent(WS, AGENT);

    expect(dispatchMock).toHaveBeenCalledWith(openAgentTabRequested(WS, { agentId: AGENT }));
  });

  it('explicit dismissal removes the toast by its stable id', async () => {
    await dismissAgentAttentionToast(AGENT);

    expect(toastDismissMock).toHaveBeenCalledWith(agentAttentionToastId(AGENT));
  });

  it('is gate-agnostic: renders whatever it receives — parentAgentId gating lives in the bridge', async () => {
    // The daemon-events bridge drops `agent:attention-requested` events whose
    // PROTOCOL payload carries a non-empty parentAgentId BEFORE calling this
    // service (daemon-events-bridge.client.test.ts covers the gated path).
    // This pins the boundary: the service itself never inspects the field, so
    // moving the gate here must be a deliberate, test-breaking decision.
    await showAgentAttentionToast({
      workspaceId: WS,
      agentId: AGENT,
      agentName: 'Implementor',
      kind: 'discussion',
      reason: 'Need a decision',
      ...({ parentAgentId: 'agent-parent-1' } as Record<string, unknown>),
    });

    expect(toastCustomMock).toHaveBeenCalledTimes(1);
    expect(lastCustomCall().id).toBe(agentAttentionToastId(AGENT));
  });

  it('wires onSwitchTo / onClose component props to the Switch To and dismissal flows', async () => {
    await showAgentAttentionToast({
      workspaceId: WS,
      agentId: AGENT,
      agentName: 'Implementor',
      kind: 'discussion',
      reason: 'Need a decision',
    });
    const props = lastCustomCall().componentProps;

    props.onSwitchTo();
    await vi.waitFor(() => {
      expect(navigateToRouteMock).toHaveBeenCalledWith(`/workspace/${WS}`);
      expect(dispatchMock).toHaveBeenCalledWith(openAgentTabRequested(WS, { agentId: AGENT }));
    });
    expect(toastDismissMock).toHaveBeenCalledWith(agentAttentionToastId(AGENT));

    toastDismissMock.mockClear();
    props.onClose();
    await vi.waitFor(() => {
      expect(toastDismissMock).toHaveBeenCalledWith(agentAttentionToastId(AGENT));
    });
  });
});
