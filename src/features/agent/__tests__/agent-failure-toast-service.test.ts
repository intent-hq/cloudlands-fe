/**
 * Agent-failure toast service tests.
 *
 * The toast seam is faked via `vi.mock('svelte-sonner')` (existing pattern);
 * the Retry All wire contract runs through the REAL `appClient` chain
 * (LiveAgentsClient → electron-ipc transport) against the ipc-mock-router,
 * asserting the exact `agent.retry` + `{ agentId, workspaceId }` params per
 * PROTOCOL and that `ok:true` removes / `ok:false` keeps registry entries.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { toastCustomMock, toastDismissMock } = vi.hoisted(() => ({
  toastCustomMock: vi.fn(),
  toastDismissMock: vi.fn(),
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

let mockState: Record<string, unknown> = {};

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({ state: () => mockState });
});

import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  mockInvoke,
  registerMockIpcHandler,
  resetMockIpcRouter,
} from '$shared/ipc-mock-router';
import {
  clearAgentFailureRegistry,
  listAgentFailureGroups,
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

  it('shows one toast per failure group with a stable per-group id', async () => {
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'spawn failed: EPERM' });
    await flush();

    const groupKey = listAgentFailureGroups()[0].groupKey;
    const call = lastCustomCallFor(agentFailureToastId(groupKey));
    expect(call).toBeDefined();
    expect(call!.componentProps.title).toBe('Implementor failed');
    expect(call!.componentProps.retryLabel).toBe('Retry Implementor');
    expect(call!.componentProps.errorSummary).toBe('spawn failed: EPERM');
    expect(call!.componentProps.detailLines).toEqual([
      { key: 'agent-1', label: 'Implementor — Fix login' },
    ]);
    // Content-only component — the destructive tint rides the wrapper class.
    expect(call!.class).toBe('!border-destructive/50');
  });

  it('updates the same toast in place when another agent joins the group', async () => {
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'spawn failed: EPERM' });
    await flush();
    recordAgentFailure({ agentId: 'agent-2', workspaceId: 'ws-2', error: 'spawn failed: EPERM' });
    await flush();

    const groupKey = listAgentFailureGroups()[0].groupKey;
    const id = agentFailureToastId(groupKey);
    const idCalls = toastCustomMock.mock.calls.filter(([, data]) => data?.id === id);
    expect(idCalls.length).toBeGreaterThanOrEqual(2);
    const props = lastCustomCallFor(id)!.componentProps;
    expect(props.title).toBe('2 agents failed');
    expect(props.retryLabel).toBe('Retry All 2 Agents');
    expect(props.detailLines).toEqual([
      { key: 'agent-1', label: 'Implementor — Fix login' },
      { key: 'agent-2', label: 'Verifier — Add dark mode' },
    ]);
  });

  it('keys detail lines by agentId so identically-named agents in one workspace stay distinct', async () => {
    mockState = {
      agentSessions: {
        byAgentId: {
          'agent-1': { id: 'agent-1', name: 'Implementor' },
          'agent-2': { id: 'agent-2', name: 'Implementor' },
        },
      },
      workspace: {
        workspaces: { map: { 'ws-1': { id: 'ws-1', title: 'Fix login' } } },
      },
    };
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
    recordAgentFailure({ agentId: 'agent-2', workspaceId: 'ws-1', error: 'boom' });
    await flush();

    const groupKey = listAgentFailureGroups()[0].groupKey;
    const props = lastCustomCallFor(agentFailureToastId(groupKey))!.componentProps;
    expect(props.detailLines).toEqual([
      { key: 'agent-1', label: 'Implementor — Fix login' },
      { key: 'agent-2', label: 'Implementor — Fix login' },
    ]);
    const keys = props.detailLines.map((line: { key: string }) => line.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('counts skipped unresolvable entries in the "+N more" line', async () => {
    // 7 entries, but only agent-1/agent-2 resolve to names — the other 5 are
    // unlisted, so the summary line must say "+5 more", not "+2 more".
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
    recordAgentFailure({ agentId: 'agent-2', workspaceId: 'ws-2', error: 'boom' });
    for (let i = 3; i <= 7; i++) {
      recordAgentFailure({ agentId: `agent-${i}`, workspaceId: 'ws-1', error: 'boom' });
    }
    await flush();

    const groupKey = listAgentFailureGroups()[0].groupKey;
    const props = lastCustomCallFor(agentFailureToastId(groupKey))!.componentProps;
    expect(props.detailLines).toEqual([
      { key: 'agent-1', label: 'Implementor — Fix login' },
      { key: 'agent-2', label: 'Verifier — Add dark mode' },
      { key: '__more__', label: '+5 more' },
    ]);
  });

  it('falls back to counts when names are unresolvable', async () => {
    mockState = {};
    recordAgentFailure({ agentId: 'agent-x', workspaceId: 'ws-x', error: 'boom' });
    await flush();

    const groupKey = listAgentFailureGroups()[0].groupKey;
    const props = lastCustomCallFor(agentFailureToastId(groupKey))!.componentProps;
    expect(props.title).toBe('1 agent failed');
    expect(props.retryLabel).toBe('Retry');
    expect(props.detailLines).toEqual([]);
  });

  it('auto-dismisses the toast when the group empties', async () => {
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
    await flush();
    const groupKey = listAgentFailureGroups()[0].groupKey;

    const { removeAgentFailure } = await import('../agent-failure-registry');
    removeAgentFailure('agent-1');
    await flush();

    expect(toastDismissMock).toHaveBeenCalledWith(agentFailureToastId(groupKey));
  });

  it('manual close hides the toast, keeps the registry, and re-shows only on a NEWER failure', async () => {
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom', at: 1000 });
    await flush();
    const groupKey = listAgentFailureGroups()[0].groupKey;
    const id = agentFailureToastId(groupKey);

    lastCustomCallFor(id)!.componentProps.onClose();
    await flush();
    expect(toastDismissMock).toHaveBeenCalledWith(id);
    expect(listAgentFailureGroups()).toHaveLength(1);

    toastCustomMock.mockClear();
    // Same-or-older failure timestamp → stays hidden.
    recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom', at: 1000 });
    await flush();
    expect(lastCustomCallFor(id)).toBeUndefined();

    // Newer failure joins the group → re-shows.
    recordAgentFailure({ agentId: 'agent-2', workspaceId: 'ws-2', error: 'boom', at: 2000 });
    await flush();
    expect(lastCustomCallFor(id)).toBeDefined();
  });

  describe('Retry All wire contract (via ipc-mock-router)', () => {
    it('issues one agent.retry per agent with exact params; ok:true removes, ok:false keeps', async () => {
      const requests: Array<{ method?: string; params?: unknown }> = [];
      registerMockIpcHandler(BACKEND.REQUEST, async (payload) => {
        const request = payload as { method?: string; params?: { agentId?: string } };
        requests.push(request);
        if (request.params?.agentId === 'agent-1') {
          return { ok: true, result: { ok: true, redriven: true } };
        }
        return { ok: true, result: { ok: false } };
      });

      recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
      recordAgentFailure({ agentId: 'agent-2', workspaceId: 'ws-2', error: 'boom' });
      await flush();

      const groupKey = listAgentFailureGroups()[0].groupKey;
      const id = agentFailureToastId(groupKey);
      lastCustomCallFor(id)!.componentProps.onRetry();
      await flush();

      expect(requests).toEqual([
        { method: 'agent.retry', params: { agentId: 'agent-1', workspaceId: 'ws-1' } },
        { method: 'agent.retry', params: { agentId: 'agent-2', workspaceId: 'ws-2' } },
      ]);

      // ok:true removed agent-1; ok:false kept agent-2.
      const groups = listAgentFailureGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0].entries.map((entry) => entry.agentId)).toEqual(['agent-2']);

      // Surviving toast shows the brief retry-failure note.
      const props = lastCustomCallFor(id)!.componentProps;
      expect(props.retryNote).toBe('Retry failed for 1 agent');
      expect(props.retrying).toBe(false);
    });

    it('disables the button while retries are in flight', async () => {
      let releaseRetry: (value: unknown) => void = () => {};
      registerMockIpcHandler(BACKEND.REQUEST, async () => {
        await new Promise((resolve) => {
          releaseRetry = resolve;
        });
        return { ok: true, result: { ok: true } };
      });

      recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
      await flush();

      const groupKey = listAgentFailureGroups()[0].groupKey;
      const id = agentFailureToastId(groupKey);
      lastCustomCallFor(id)!.componentProps.onRetry();
      await flush();

      expect(lastCustomCallFor(id)!.componentProps.retrying).toBe(true);

      releaseRetry(undefined);
      await flush();

      // ok:true empties the group → toast dismissed.
      expect(toastDismissMock).toHaveBeenCalledWith(id);
      expect(listAgentFailureGroups()).toHaveLength(0);
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

      const groupKey = listAgentFailureGroups()[0].groupKey;
      const id = agentFailureToastId(groupKey);
      lastCustomCallFor(id)!.componentProps.onRetry();
      await flush();

      // The agent fails AGAIN while its retry is still in flight — the
      // registry now holds a fresh entry that must survive the stale ok:true.
      recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom', at: 2000 });

      releaseRetry(undefined);
      await flush();

      const groups = listAgentFailureGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0].entries.map((entry) => entry.agentId)).toEqual(['agent-1']);
      expect(groups[0].entries[0].at).toBe(2000);
    });

    it('transport errors keep the entry and surface the failure note', async () => {
      registerMockIpcHandler(BACKEND.REQUEST, async () => {
        throw new Error('socket closed');
      });

      recordAgentFailure({ agentId: 'agent-1', workspaceId: 'ws-1', error: 'boom' });
      await flush();

      const groupKey = listAgentFailureGroups()[0].groupKey;
      const id = agentFailureToastId(groupKey);
      lastCustomCallFor(id)!.componentProps.onRetry();
      await flush();

      expect(listAgentFailureGroups()[0].entries.map((entry) => entry.agentId)).toEqual([
        'agent-1',
      ]);
      expect(lastCustomCallFor(id)!.componentProps.retryNote).toBe('Retry failed for 1 agent');
    });
  });
});
