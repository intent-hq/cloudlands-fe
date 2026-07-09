/**
 * AgentsList — initial render against the scripted-daemon WSS seam.
 *
 * First consumer suite of `installMockBackend()` (see
 * `src/test/mocks/backend-transport.mock.ts`). Scripts `workspace.list` and
 * `agent.list` on the mock transport, drives `LiveAgentsClient.subscribe()` to
 * pull the initial snapshot through the exact JSON-RPC calls the real client
 * emits, then renders `AgentsList` with that snapshot as a prop and asserts
 * both agents render. Does NOT touch the existing `AgentsList.test.ts` (which
 * exercises pure-prop rendering with hand-crafted `AgentSession` values).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Route the real backend-transport module at the scripted-daemon fixture. The
// `vi.mock` factory is hoisted; a dynamic import inside it lets the factory
// reach the mock module without pinning an import-order dependency.
vi.mock('$lib/client/live/backend-transport', async () => {
  const mod = await import('../../../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});

// UI-side seam mocks (same shape as the sibling AgentsList.test.ts) so the
// presenter can render without booting the full renderer store.
vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToAgent: vi.fn(),
}));

vi.mock('$store/renderer/slices/theme/theme-selectors', () => ({
  selectIsDarkTheme: Object.assign(
    () => ({
      subscribe: (run: (value: boolean) => void) => {
        run(false);
        return () => {};
      },
    }),
    { select: () => false },
  ),
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentIsThinking: Object.assign(
    () => ({
      subscribe: (run: (value: boolean) => void) => {
        run(false);
        return () => {};
      },
    }),
    { select: () => false },
  ),
  selectAgentProvider: Object.assign(
    () => ({
      subscribe: (run: (value: string | undefined) => void) => {
        run(undefined);
        return () => {};
      },
    }),
    { select: () => undefined },
  ),
}));

import { render } from '@testing-library/svelte';

import AgentsList from '../AgentsList.svelte';
import { LiveAgentsClient } from '$lib/client/live/live-agents-client';
import type { AgentSession } from '$shared/types';
import type { Unsubscribe } from '$lib/client/app-client';
import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../../../test/mocks/backend-transport.mock';

/** Microtask flush — the scripted transport resolves synchronously via Promise.resolve. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AgentsList — initial fetch + render against scripted daemon (WSS seam)', () => {
  let backend: MockBackendHandle;
  let disposeSubscription: Unsubscribe | undefined;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    backend = installMockBackend();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    disposeSubscription?.();
    disposeSubscription = undefined;
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    resetMockBackend();
  });

  it('drives LiveAgentsClient over the scripted seam and renders both agents', async () => {
    const WORKSPACE_ID = 'ws-mock-1';

    backend.onRequest('workspace.list', () => ({
      workspaces: [{ id: WORKSPACE_ID, name: 'Mock Workspace' }],
    }));
    backend.onRequest('agent.list', () => ({
      agents: [
        {
          id: 'agent-1',
          workspaceId: WORKSPACE_ID,
          name: 'First Agent',
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'agent-2',
          workspaceId: WORKSPACE_ID,
          name: 'Second Agent',
          status: 'idle',
          createdAt: '2026-01-01T00:00:01.000Z',
          updatedAt: '2026-01-01T00:00:01.000Z',
        },
      ],
    }));

    // Drive the initial snapshot through the exact seam the real renderer
    // uses: `LiveAgentsClient.subscribe()` → `listWorkspaceIds()` +
    // `agent.list({workspaceId})` (see createDeltaSubscription's initial
    // refetchEmit).
    const client = new LiveAgentsClient();
    const initialSnapshot = new Promise<AgentSession[]>((resolve) => {
      let resolved = false;
      disposeSubscription = client.subscribe((agents) => {
        if (!resolved && agents.length > 0) {
          resolved = true;
          resolve(agents);
        }
      });
    });

    const agents = await initialSnapshot;

    expect(agents.map((a) => a.id)).toEqual(['agent-1', 'agent-2']);
    expect(agents.map((a) => a.name)).toEqual(['First Agent', 'Second Agent']);
    expect(agents.map((a) => a.status)).toEqual(['active', 'idle']);
    expect(agents.every((a) => a.workspaceId === WORKSPACE_ID)).toBe(true);

    const { container } = render(AgentsList, {
      props: { agents, collapsed: false },
    });

    // Both agents render by name; expanded view emits one Button per agent
    // (plus zero for the "no threads" placeholder path).
    expect(container.textContent).toContain('First Agent');
    expect(container.textContent).toContain('Second Agent');
    expect(container.querySelectorAll('button').length).toBeGreaterThanOrEqual(2);

    // Wire-shape assertions per PROTOCOL §5: subscribe issues exactly one
    // `workspace.list` and one `agent.list({workspaceId})` for the initial
    // snapshot. The daemon's `events.subscribe` fast-path is also exercised
    // by createDeltaSubscription but is unrelated to the render assertion.
    const agentListCalls = backend.requests.filter((r) => r.method === 'agent.list');
    expect(agentListCalls).toHaveLength(1);
    expect(agentListCalls[0]?.params).toEqual({ workspaceId: WORKSPACE_ID });

    const workspaceListCalls = backend.requests.filter((r) => r.method === 'workspace.list');
    expect(workspaceListCalls).toHaveLength(1);

    // No unbridged-channel rejections logged during fetch + render — those are
    // the ipc-mock-router loud-warning path; the WSS seam should reach the
    // daemon without touching legacy IPC bridges.
    const consoleCalls = [
      ...consoleErrorSpy.mock.calls,
      ...consoleWarnSpy.mock.calls,
    ];
    for (const call of consoleCalls) {
      const joined = call.map((arg) => String(arg)).join(' ');
      expect(joined).not.toContain('UnbridgedMockIpcChannel');
      expect(joined.toLowerCase()).not.toContain('unbridged');
    }

    // Belt-and-braces: flush any trailing microtasks the subscription may
    // still be processing so afterEach sees a quiescent tree.
    await flush();
  });
});
