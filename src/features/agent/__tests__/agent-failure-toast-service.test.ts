/**
 * Agent-failure toast service tests.
 *
 * The toast seam is faked via `vi.mock('svelte-sonner')` (existing pattern);
 * the Retry wire contract runs through the REAL `appClient` chain
 * (LiveAgentsClient → electron-ipc transport) against the ipc-mock-router,
 * asserting the exact `agent.retry` + `{ agentId, workspaceId }` params per
 * PROTOCOL and that `ok:true` removes / `ok:false` keeps registry entries.
 * The navigation seam (`navigateToRoute`) and the sidebar-nav slice actions
 * are mocked to assert Retry's and Switch To's navigate-to-agent behavior.
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
  navigateToRouteMock: vi.fn(async () => {}),
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

vi.mock('$lib/components/ui/toast/AgentFailureToast.svelte', () => ({
  default: 'AgentFailureToast',
}));

vi.mock('$lib/utils/navigation.client', () => ({
  navigateToRoute: navigateToRouteMock,
}));

vi.mock('$store/renderer/slices/sidebar-nav/sidebar-nav-slice', () => ({
  openPanel: (panel: string) => ({ type: 'sidebarNav/openPanel', args: [panel] }),
  setChiefActiveAgentId: (agentId: string) => ({
    type: 'sidebarNav/setChiefActiveAgentId',
    args: [agentId],
  }),
}));

vi.mock('$store/renderer/slices/app-layout/app-layout-slice', () => ({
  openAgentTabRequested: (wsId: string, detail: unknown) => ({
    type: 'appLayout/openAgentTabRequested',
    args: [wsId, detail],
  }),
}));

// Seams of the connected key-slot resolver (badge gating): manager status +
// the resolved-slot selector, so the real gate logic in
// resolveConnectedWorkspaceKeySlot is exercised.
vi.mock('$features/hardware-console/instance', () => ({
  getHardwareConsoleManager: () => ({ status: microStatusMock.value }),
}));

vi.mock('$store/renderer/slices/hardware-console/hardware-console-selectors', () => ({
  selectWorkspaceResolvedKeySlot: { select: resolvedKeySlotSelectMock },
}));

let mockState: Record<string, unknown> = {};

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({
    state: () => mockState,
    dispatch: (...args: unknown[]) => dispatchMock(...args),
  });
});

import { IPC_CHANNELS } from '$shared/ipc-registry';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  mockInvoke,
  registerMockIpcHandler,
  resetMockIpcRouter,
} from '$shared/ipc-mock-router';
import {
  clearAgentFailureRegistry,
  listAgentFailureEntries,
  recordAgentFailure,
} from '../agent-failure-registry';
import {
  __resetAgentFailureToastsForTests,
  agentFailureToastId,
  installAgentFailureToasts,
} from '../agent-failure-toast-service';

const BACKEND = IPC_CHANNELS.BACKEND;

/** Flush the lazy-import + render microtask/timer chain. */
async function flush(): Promise<void> {
  await vi.dynamicImportSettled();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Latest `toast.custom` call for a given stable toast id. */
function lastCustomCallFor(
  id: string,
): { componentProps: Record<string, any>; class?: string } | undefined {
  const calls = toastCustomMock.mock.calls.filter(([, data]) => data?.id === id);
  const last = calls[calls.length - 1];
  return last?.[1];
}

describe('agent-failure-toast-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    microStatusMock.value = 'disconnected';
    resolvedKeySlotSelectMock.mockImplementation(() => null);
    resetMockIpcRouter();
    clearAgentFailureRegistry();
    __resetAgentFailureToastsForTests();
    mockState = {
      agentSessions: {
        byAgentId: {
          'agent-1': { id: 'agent-1', name: 'Implementor' },
          'agent-2': { id: 'agent-2', name: 'Verifier' },
        },
      },
      workspace: {
        workspaces: {
          map: {
            'ws-1': { id: 'ws-1', title: 'Fix login' },
            'ws-2': { id: 'ws-2', title: 'Add dark mode' },
          },
        },
      },
    };
    (window as any).electronAPI = {
      invoke: vi.fn((channel: string, ...args: unknown[]) => mockInvoke(channel, ...args)),
      on: vi.fn(() => 'listener-1'),
      offById: vi.fn(),
    };
    installAgentFailureToasts();
  });

  afterEach(() => {
    __resetAgentFailureToastsForTests();
    clearAgentFailureRegistry();
    resetMockIpcRouter();
  });

  it('shows one toast per failed agent with a stable per-agent id', async () => {
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'spawn failed: EPERM' });
    await flush();

    const call = lastCustomCallFor(agentFailureToastId('agent-1'));
    expect(call).toBeDefined();
    expect(call!.componentProps.title).toBe('Implementor failed');
    expect(call!.componentProps.retryLabel).toBe('Retry Implementor');
    expect(call!.componentProps.errorSummary).toBe('spawn failed: EPERM');
    expect(call!.componentProps.contextLine).toBe('Implementor — Fix login');
    // Content-only component — the destructive tint rides the wrapper class.
    expect(call!.class).toBe('!border-destructive/50');
  });

  it('shows SEPARATE toasts for agents that fail with the same error — never grouped', async () => {
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'spawn failed: EPERM' });
    recordAgentFailure({ agentId: 'agent-2', workspaceId: 'ws-2', error: 'spawn failed: EPERM' });
    await flush();

    const first = lastCustomCallFor(agentFailureToastId('agent-1'))!.componentProps;
    const second = lastCustomCallFor(agentFailureToastId('agent-2'))!.componentProps;
    expect(first.title).toBe('Implementor failed');
    expect(first.contextLine).toBe('Implementor — Fix login');
    expect(second.title).toBe('Verifier failed');
    expect(second.contextLine).toBe('Verifier — Add dark mode');
  });

  it('falls back to generic strings when names are unresolvable', async () => {
    mockState = {};
    recordAgentFailure({ agentId: 'agent-x', workspaceId: 'ws-x', error: 'boom' });
    await flush();

    const props = lastCustomCallFor(agentFailureToastId('agent-x'))!.componentProps;
    expect(props.title).toBe('Agent failed');
    expect(props.retryLabel).toBe('Retry');
    expect(props.contextLine).toBeUndefined();
  });

  describe('micro key-slot badge', () => {
    it('carries the resolved key slot when the micro is connected and the workspace holds a slot', async () => {
      microStatusMock.value = 'connected';
      resolvedKeySlotSelectMock.mockImplementation(() => 4);

      recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
      await flush();

      expect(resolvedKeySlotSelectMock).toHaveBeenCalledWith(expect.anything(), 'ws-1');
      expect(lastCustomCallFor(agentFailureToastId('agent-1'))!.componentProps.keySlot).toBe(4);
    });

    it('carries no key slot when the micro is disconnected, even if the workspace holds one', async () => {
      microStatusMock.value = 'disconnected';
      resolvedKeySlotSelectMock.mockImplementation(() => 4);

      recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
      await flush();

      expect(resolvedKeySlotSelectMock).not.toHaveBeenCalled();
      expect(lastCustomCallFor(agentFailureToastId('agent-1'))!.componentProps.keySlot).toBeNull();
    });

    it('carries no key slot when connected but the workspace holds no slot', async () => {
      microStatusMock.value = 'connected';
      resolvedKeySlotSelectMock.mockImplementation(() => null);

      recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
      await flush();

      expect(lastCustomCallFor(agentFailureToastId('agent-1'))!.componentProps.keySlot).toBeNull();
    });

    it('still shows the toast (badge-less) when slot resolution throws', async () => {
      microStatusMock.value = 'connected';
      resolvedKeySlotSelectMock.mockImplementation(() => {
        throw new Error('resolver boom');
      });

      recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
      await flush();

      const call = lastCustomCallFor(agentFailureToastId('agent-1'));
      expect(call).toBeDefined();
      expect(call!.componentProps.title).toBe('Implementor failed');
      expect(call!.componentProps.keySlot).toBeNull();
    });
  });

  it('toasts only registry entries — delegated failures (parentAgentId on the wire) never enter the registry', async () => {
    // The daemon-events bridge skips `recordAgentFailure` for `agent:failed`
    // events carrying a non-empty parentAgentId (PROTOCOL §6.5), so a
    // delegated agent's failure never reaches this toast layer
    // (daemon-events-bridge.client.test.ts covers the gate). This pins the
    // boundary: no registry entry → no toast; a recorded entry always toasts.
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
    await flush();

    expect(lastCustomCallFor(agentFailureToastId('agent-1'))).toBeDefined();
    // agent-2 failed with a parent upstream — the bridge never recorded it.
    expect(lastCustomCallFor(agentFailureToastId('agent-2'))).toBeUndefined();
    expect(listAgentFailureEntries().map((entry) => entry.agentId)).toEqual(['agent-1']);
  });

  it('auto-dismisses the toast when the agent leaves the registry', async () => {
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
    await flush();

    const { removeAgentFailure } = await import('../agent-failure-registry');
    removeAgentFailure('agent-1');
    await flush();

    expect(toastDismissMock).toHaveBeenCalledWith(agentFailureToastId('agent-1'));
  });

  it('manual close hides the toast, keeps the registry, and re-shows only on a NEWER failure', async () => {
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom', at: 1000 });
    await flush();
    const id = agentFailureToastId('agent-1');

    lastCustomCallFor(id)!.componentProps.onClose();
    await flush();
    expect(toastDismissMock).toHaveBeenCalledWith(id);
    expect(listAgentFailureEntries()).toHaveLength(1);

    toastCustomMock.mockClear();
    // Same-or-older failure timestamp → stays hidden.
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom', at: 1000 });
    await flush();
    expect(lastCustomCallFor(id)).toBeUndefined();

    // Newer failure for the SAME agent → re-shows.
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom', at: 2000 });
    await flush();
    expect(lastCustomCallFor(id)).toBeDefined();
  });

  describe('Retry wire contract (via ipc-mock-router)', () => {
    it('issues agent.retry with exact params for ONLY the clicked agent; ok:true removes, ok:false keeps', async () => {
      const requests: Array<{ method?: string; params?: unknown }> = [];
      registerMockIpcHandler(BACKEND.REQUEST, async (payload) => {
        const request = payload as { method?: string; params?: { agentId?: string } };
        requests.push(request);
        return { ok: true, result: { ok: true, redriven: true } };
      });

      recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
      recordAgentFailure({ agentId: 'agent-2', workspaceId: 'ws-2', error: 'boom' });
      await flush();

      lastCustomCallFor(agentFailureToastId('agent-1'))!.componentProps.onRetry();
      await flush();

      // Only the clicked agent is retried — never a mass retry.
      expect(requests).toEqual([
        { method: 'agent.retry', params: { agentId: 'agent-1', workspaceId: 'ws-1' } },
      ]);

      // ok:true removed agent-1; agent-2 untouched.
      expect(listAgentFailureEntries().map((entry) => entry.agentId)).toEqual(['agent-2']);
      expect(toastDismissMock).toHaveBeenCalledWith(agentFailureToastId('agent-1'));
    });

    it('ok:false keeps the entry and surfaces the retry-failure note', async () => {
      registerMockIpcHandler(BACKEND.REQUEST, async () => ({
        ok: true,
        result: { ok: false },
      }));

      recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
      await flush();

      const id = agentFailureToastId('agent-1');
      lastCustomCallFor(id)!.componentProps.onRetry();
      await flush();

      expect(listAgentFailureEntries().map((entry) => entry.agentId)).toEqual(['agent-1']);
      const props = lastCustomCallFor(id)!.componentProps;
      expect(props.retryNote).toBe('Retry failed');
      expect(props.retrying).toBe(false);
    });

    it('disables the button while the retry is in flight', async () => {
      let releaseRetry: (value: unknown) => void = () => {};
      registerMockIpcHandler(BACKEND.REQUEST, async () => {
        await new Promise((resolve) => {
          releaseRetry = resolve;
        });
        return { ok: true, result: { ok: true } };
      });

      recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
      await flush();

      const id = agentFailureToastId('agent-1');
      lastCustomCallFor(id)!.componentProps.onRetry();
      await flush();

      expect(lastCustomCallFor(id)!.componentProps.retrying).toBe(true);

      releaseRetry(undefined);
      await flush();

      // ok:true removes the entry → toast dismissed.
      expect(toastDismissMock).toHaveBeenCalledWith(id);
      expect(listAgentFailureEntries()).toHaveLength(0);
    });

    it('does not remove a failure re-recorded while its retry was in flight', async () => {
      let releaseRetry: (value: unknown) => void = () => {};
      registerMockIpcHandler(BACKEND.REQUEST, async () => {
        await new Promise((resolve) => {
          releaseRetry = resolve;
        });
        return { ok: true, result: { ok: true, redriven: true } };
      });

      recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom', at: 1000 });
      await flush();

      const id = agentFailureToastId('agent-1');
      lastCustomCallFor(id)!.componentProps.onRetry();
      await flush();

      // The agent fails AGAIN while its retry is still in flight — the
      // registry now holds a fresh entry that must survive the stale ok:true.
      recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom', at: 2000 });

      releaseRetry(undefined);
      await flush();

      const entries = listAgentFailureEntries();
      expect(entries.map((entry) => entry.agentId)).toEqual(['agent-1']);
      expect(entries[0].at).toBe(2000);
    });

    it('transport errors keep the entry and surface the failure note', async () => {
      registerMockIpcHandler(BACKEND.REQUEST, async () => {
        throw new Error('socket closed');
      });

      recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
      await flush();

      const id = agentFailureToastId('agent-1');
      lastCustomCallFor(id)!.componentProps.onRetry();
      await flush();

      expect(listAgentFailureEntries().map((entry) => entry.agentId)).toEqual(['agent-1']);
      expect(lastCustomCallFor(id)!.componentProps.retryNote).toBe('Retry failed');
    });
  });

  describe('Retry navigation', () => {
    it('routes to the workspace and opens the agent tab on retry', async () => {
      registerMockIpcHandler(BACKEND.REQUEST, async () => ({
        ok: true,
        result: { ok: true, redriven: true },
      }));

      recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
      await flush();

      lastCustomCallFor(agentFailureToastId('agent-1'))!.componentProps.onRetry();
      await flush();

      expect(navigateToRouteMock).toHaveBeenCalledTimes(1);
      expect(navigateToRouteMock).toHaveBeenCalledWith('/workspace/ws-1');
      expect(dispatchMock).toHaveBeenCalledWith({
        type: 'appLayout/openAgentTabRequested',
        args: ['ws-1', { agentId: 'agent-1' }],
      });
    });

    it('navigates even when the retry RPC returns ok:false', async () => {
      registerMockIpcHandler(BACKEND.REQUEST, async () => ({
        ok: true,
        result: { ok: false },
      }));

      recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
      await flush();

      const id = agentFailureToastId('agent-1');
      lastCustomCallFor(id)!.componentProps.onRetry();
      await flush();

      expect(navigateToRouteMock).toHaveBeenCalledWith('/workspace/ws-1');
      expect(dispatchMock).toHaveBeenCalledWith({
        type: 'appLayout/openAgentTabRequested',
        args: ['ws-1', { agentId: 'agent-1' }],
      });
      // The entry is kept and the failure note still surfaces.
      expect(listAgentFailureEntries().map((entry) => entry.agentId)).toEqual(['agent-1']);
      expect(lastCustomCallFor(id)!.componentProps.retryNote).toBe('Retry failed');
    });

    it('opens the sidebar Assistant panel for chief-workspace failures instead of navigating', async () => {
      registerMockIpcHandler(BACKEND.REQUEST, async () => ({
        ok: true,
        result: { ok: true, redriven: true },
      }));

      recordAgentFailure({
        agentId: 'chief-agent-1',
        workspaceId: CHIEF_WORKSPACE_ID,
        error: 'boom',
      });
      await flush();

      lastCustomCallFor(agentFailureToastId('chief-agent-1'))!.componentProps.onRetry();
      await flush();

      expect(navigateToRouteMock).not.toHaveBeenCalled();
      expect(dispatchMock).toHaveBeenCalledWith({
        type: 'sidebarNav/setChiefActiveAgentId',
        args: ['chief-agent-1'],
      });
      expect(dispatchMock).toHaveBeenCalledWith({
        type: 'sidebarNav/openPanel',
        args: ['chief'],
      });
    });
  });

  describe('Switch To', () => {
    it('navigates WITHOUT calling agent.retry and keeps the entry + toast', async () => {
      const requests: unknown[] = [];
      registerMockIpcHandler(BACKEND.REQUEST, async (payload) => {
        requests.push(payload);
        return { ok: true, result: { ok: true } };
      });

      recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
      await flush();

      const id = agentFailureToastId('agent-1');
      lastCustomCallFor(id)!.componentProps.onSwitchTo();
      await flush();

      expect(navigateToRouteMock).toHaveBeenCalledWith('/workspace/ws-1');
      expect(dispatchMock).toHaveBeenCalledWith({
        type: 'appLayout/openAgentTabRequested',
        args: ['ws-1', { agentId: 'agent-1' }],
      });
      expect(requests).toEqual([]);
      expect(listAgentFailureEntries().map((entry) => entry.agentId)).toEqual(['agent-1']);
      expect(toastDismissMock).not.toHaveBeenCalled();
    });

    it('uses the chief branch for chief-workspace failures without retrying', async () => {
      const requests: unknown[] = [];
      registerMockIpcHandler(BACKEND.REQUEST, async (payload) => {
        requests.push(payload);
        return { ok: true, result: { ok: true } };
      });

      recordAgentFailure({
        agentId: 'chief-agent-1',
        workspaceId: CHIEF_WORKSPACE_ID,
        error: 'boom',
      });
      await flush();

      lastCustomCallFor(agentFailureToastId('chief-agent-1'))!.componentProps.onSwitchTo();
      await flush();

      expect(navigateToRouteMock).not.toHaveBeenCalled();
      expect(requests).toEqual([]);
      expect(dispatchMock).toHaveBeenCalledWith({
        type: 'sidebarNav/setChiefActiveAgentId',
        args: ['chief-agent-1'],
      });
      expect(dispatchMock).toHaveBeenCalledWith({
        type: 'sidebarNav/openPanel',
        args: ['chief'],
      });
    });
  });
});
