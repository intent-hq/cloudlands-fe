/**
 * Agent-attention toast service tests.
 *
 * The toast seam is faked via `vi.mock('svelte-sonner')` (existing pattern);
 * these tests lock in the stickiness contract (duration: Infinity, stable
 * per-agent id, only close/Switch To dismiss) and the "Switch To" wiring
 * (workspace activation + cross-workspace goto + agent-tab dispatch).
 */
import { m } from '$shared/paraglide/messages.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  toastCustomMock,
  toastInfoMock,
  toastDismissMock,
  navigateToRouteMock,
  dispatchMock,
  microStatusMock,
  resolvedKeySlotSelectMock,
  workspaceByIdSelectMock,
  storeStateMock,
} = vi.hoisted(() => ({
  toastCustomMock: vi.fn(),
  toastInfoMock: vi.fn(),
  toastDismissMock: vi.fn(),
  navigateToRouteMock: vi.fn(() => Promise.resolve()),
  dispatchMock: vi.fn(),
  microStatusMock: { value: 'disconnected' },
  resolvedKeySlotSelectMock: vi.fn((_state: unknown, _workspaceId: string): number | null => null),
  workspaceByIdSelectMock: vi.fn(
    (_state: unknown, _workspaceId: string): { title?: string } | undefined => undefined,
  ),
  storeStateMock: { value: {} as Record<string, unknown> },
}));

vi.mock('svelte-sonner', () => ({
  toast: {
    custom: toastCustomMock,
    info: toastInfoMock,
    dismiss: toastDismissMock,
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Fake the lazily imported workspace selector so the auto-unarchive toast's
// title resolution is observable without the real workspace slice.
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: { select: workspaceByIdSelectMock },
}));

vi.mock('$lib/components/ui/toast/AgentAttentionToast.svelte', () => ({
  default: 'AgentAttentionToast',
}));

vi.mock('$lib/utils/navigation.client', () => ({
  navigateToRoute: navigateToRouteMock,
  isHudWindowRenderer: () => false,
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ dispatch: dispatchMock, state: () => storeStateMock.value });
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
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import {
  agentAttentionToastId,
  dismissAgentAttentionToast,
  showAgentAttentionToast,
  showWorkspaceAutoUnarchiveToast,
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
    workspaceByIdSelectMock.mockImplementation(() => undefined);
    storeStateMock.value = {};
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
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
    expect(call.class).toBe('!border-danger/50');
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

  describe('already-viewing suppression', () => {
    const request = {
      workspaceId: WS,
      agentId: AGENT,
      agentName: 'Implementor',
      kind: 'discussion' as const,
      reason: 'Need a decision',
    };

    /** A panel whose tabs/activeTabId mimic the panelLayout slice shape. */
    function panel(
      id: string,
      tabs: { id: string; type: string; agentId?: string }[],
      activeTabId: string | null,
    ) {
      return { id, tabs, activeTabId };
    }

    /**
     * Seed the store so WS is the current workspace tab with the given
     * panelLayout panels (tab visibility source of truth — tab clicks update
     * `panel.activeTabId`, never `workspaceAgents.activeAgentId`).
     */
    function seedViewingState(
      panels: ReturnType<typeof panel>[],
      opts: { currentTabId?: string; expandedPanelId?: string | null } = {},
    ): void {
      storeStateMock.value = {
        tabState: { currentTabId: opts.currentTabId ?? WS },
        panelLayout: {
          byWorkspaceId: {
            [WS]: {
              panels: Object.fromEntries(panels.map((p) => [p.id, p])),
              expandedPanelId: opts.expandedPanelId ?? null,
            },
          },
        },
      };
    }

    const agentTab = { id: 'tab-agent', type: 'agent', agentId: AGENT };
    const otherAgentTab = { id: 'tab-other-agent', type: 'agent', agentId: 'agent-other' };
    const fileTab = { id: 'tab-file', type: 'file' };

    function setWindowFocused(focused: boolean): void {
      vi.spyOn(document, 'hasFocus').mockReturnValue(focused);
    }

    it("suppresses the toast when focused + current workspace tab + the agent's tab active in a panel", async () => {
      setWindowFocused(true);
      seedViewingState([panel('p1', [agentTab, fileTab], agentTab.id)]);

      await showAgentAttentionToast(request);

      expect(toastCustomMock).not.toHaveBeenCalled();
      // Suppression only skips the toast — it never dismisses an existing one.
      expect(toastDismissMock).not.toHaveBeenCalled();
    });

    it('suppresses when the agent tab is active in a non-focused visible panel (any visible panel counts)', async () => {
      setWindowFocused(true);
      seedViewingState([panel('p1', [fileTab], fileTab.id), panel('p2', [agentTab], agentTab.id)]);

      await showAgentAttentionToast(request);

      expect(toastCustomMock).not.toHaveBeenCalled();
    });

    it('shows the toast when the window is unfocused, even while viewing the agent', async () => {
      setWindowFocused(false);
      seedViewingState([panel('p1', [agentTab], agentTab.id)]);

      await showAgentAttentionToast(request);

      expect(toastCustomMock).toHaveBeenCalledTimes(1);
      expect(lastCustomCall().id).toBe(agentAttentionToastId(AGENT));
    });

    it('shows the toast when a different workspace tab is current', async () => {
      setWindowFocused(true);
      seedViewingState([panel('p1', [agentTab], agentTab.id)], { currentTabId: 'ws-other' });

      await showAgentAttentionToast(request);

      expect(toastCustomMock).toHaveBeenCalledTimes(1);
    });

    it("shows the toast when another agent's tab is active in the event's workspace", async () => {
      setWindowFocused(true);
      seedViewingState([panel('p1', [agentTab, otherAgentTab], otherAgentTab.id)]);

      await showAgentAttentionToast(request);

      expect(toastCustomMock).toHaveBeenCalledTimes(1);
    });

    it('shows the toast when a non-agent tab (file) is active, even with the agent tab open', async () => {
      setWindowFocused(true);
      seedViewingState([panel('p1', [agentTab, fileTab], fileTab.id)]);

      await showAgentAttentionToast(request);

      expect(toastCustomMock).toHaveBeenCalledTimes(1);
    });

    it('shows the toast when a panel is expanded and the agent tab is only active in a hidden panel', async () => {
      setWindowFocused(true);
      seedViewingState([panel('p1', [fileTab], fileTab.id), panel('p2', [agentTab], agentTab.id)], {
        expandedPanelId: 'p1',
      });

      await showAgentAttentionToast(request);

      expect(toastCustomMock).toHaveBeenCalledTimes(1);
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

  it('Switch To activates the workspace before navigating and opening the agent tab', async () => {
    await switchToAttentionAgent(WS, AGENT);

    expect(toastDismissMock).toHaveBeenCalledWith(agentAttentionToastId(AGENT));
    expect(navigateToRouteMock).toHaveBeenCalledWith(`/workspace/${WS}`);
    expect(dispatchMock.mock.calls.map(([action]) => action)).toEqual([
      openWorkspaceTab(WS),
      openAgentTabRequested(WS, { agentId: AGENT }),
    ]);
  });

  it('Switch To still activates the workspace and opens the agent tab when navigation rejects', async () => {
    navigateToRouteMock.mockRejectedValueOnce(new Error('nav failed'));

    await switchToAttentionAgent(WS, AGENT);

    expect(dispatchMock.mock.calls.map(([action]) => action)).toEqual([
      openWorkspaceTab(WS),
      openAgentTabRequested(WS, { agentId: AGENT }),
    ]);
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

  describe('showWorkspaceAutoUnarchiveToast', () => {
    const notice = { workspaceId: WS, agentId: AGENT, agentName: 'Builder' };

    function lastInfoCall(): [string, { id: string; action: { label: string; onClick(): void } }] {
      const call = toastInfoMock.mock.calls[toastInfoMock.mock.calls.length - 1];
      expect(call).toBeDefined();
      return call as [string, { id: string; action: { label: string; onClick(): void } }];
    }

    it('shows a transient info toast with the resolved workspace title and agent name', async () => {
      workspaceByIdSelectMock.mockImplementation(() => ({ title: 'My Project' }));

      await showWorkspaceAutoUnarchiveToast(notice);

      expect(workspaceByIdSelectMock).toHaveBeenCalledWith(expect.anything(), WS);
      const [message, options] = lastInfoCall();
      expect(message).toBe('My Project was unarchived — Builder became active');
      // Stable per-workspace id so bursts update in place; transient — no
      // duration override (sonner default), unlike the sticky attention toast.
      expect(options.id).toBe(`workspace-auto-unarchive:${WS}`);
      expect(options).not.toHaveProperty('duration');
      expect(options.action.label).toBe('Switch To');
    });

    it('falls back to the generic workspace label when the workspace title is unknown', async () => {
      workspaceByIdSelectMock.mockImplementation(() => undefined);

      await showWorkspaceAutoUnarchiveToast(notice);

      expect(lastInfoCall()[0]).toBe(
        m.workspace_autoUnarchive_toast({ title: m.workspace_page_space_title(), name: 'Builder' }),
      );
    });

    it('still shows the toast (with the fallback title) when title resolution throws', async () => {
      workspaceByIdSelectMock.mockImplementation(() => {
        throw new Error('selector boom');
      });

      await showWorkspaceAutoUnarchiveToast(notice);

      expect(lastInfoCall()[0]).toBe(
        m.workspace_autoUnarchive_toast({ title: m.workspace_page_space_title(), name: 'Builder' }),
      );
    });

    it('Switch To routes to the workspace and opens the agent tab', async () => {
      await showWorkspaceAutoUnarchiveToast(notice);

      lastInfoCall()[1].action.onClick();
      await vi.waitFor(() => {
        expect(navigateToRouteMock).toHaveBeenCalledWith(`/workspace/${WS}`);
        expect(dispatchMock.mock.calls.map(([action]) => action)).toEqual([
          openWorkspaceTab(WS),
          openAgentTabRequested(WS, { agentId: AGENT }),
        ]);
      });
    });
  });
});
