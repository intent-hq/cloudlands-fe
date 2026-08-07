/**
 * Unit tests for the extracted running-agents quit confirmation
 * (src/main/quit-confirmation.ts). All collaborators are injected, so no
 * electron dialog or backend client is touched.
 *
 * The confirmation aggregates two agent sources before deciding anything: the
 * active client (remote when a remote backend is pinned) and — only while a
 * remote is active — a best-effort query of the startup/default backend. Each
 * source is grouped by whether quitting shuts its daemon down, so the framing
 * follows daemon ownership rather than the startup connection mode alone.
 *
 * The last suite drops the `listLocalRespondingAgents` override so the real
 * probe runs against a faked JsonRpcClient.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from 'electron';

import type { ConnectionMode } from '../../features/backend/main/connection-mode';
import { confirmQuitWithRunningAgents } from '../quit-confirmation';
import type { RespondingAgent, RunningAgentsRpc } from '../running-agents';

/**
 * Fake for the throwaway client the default probe builds. `behavior` decides
 * what `start()` produces, so the connect/error/hang paths are all reachable.
 */
const fake = vi.hoisted(() => {
  const state = {
    behavior: 'connect' as 'connect' | 'error' | 'hang',
    instances: [] as FakeClient[],
  };

  class FakeClient {
    started = 0;
    disposed = 0;
    readonly options: Record<string, unknown>;
    private readonly listeners = new Map<string, ((arg: never) => void)[]>();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      state.instances.push(this);
    }

    on(event: string, handler: (arg: never) => void): this {
      const existing = this.listeners.get(event) ?? [];
      existing.push(handler);
      this.listeners.set(event, existing);
      return this;
    }

    start(): void {
      this.started += 1;
      if (state.behavior === 'hang') return;
      queueMicrotask(() => {
        if (state.behavior === 'connect') this.emit('status', 'connected');
        else this.emit('error', new Error('ECONNREFUSED'));
      });
    }

    getStatus(): string {
      return 'connected';
    }

    async request(method: string): Promise<unknown> {
      if (method === 'workspace.list') return { workspaces: [{ id: 'ws-9' }] };
      return { agents: [{ id: 'agent-9', name: 'Probe worker', isResponding: true }] };
    }

    dispose(): void {
      this.disposed += 1;
    }

    private emit(event: string, arg: unknown): void {
      for (const handler of this.listeners.get(event) ?? []) handler(arg as never);
    }
  }

  return { state, FakeClient };
});

vi.mock('../../features/backend/main/json-rpc-client', () => ({
  JsonRpcClient: fake.FakeClient,
}));

vi.mock('../../features/backend/main/backend-connection', () => ({
  resolveBackendConfig: vi.fn(() => ({ transport: 'uds', socketPath: '/tmp/intentd.sock' })),
}));

const AGENTS: RespondingAgent[] = [
  { agentId: 'agent-1', name: 'Implementor', workspaceId: 'ws-1' },
  { agentId: 'agent-2', name: 'Verifier', workspaceId: 'ws-2' },
];

const LOCAL_AGENTS: RespondingAgent[] = [
  { agentId: 'agent-3', name: 'Local worker', workspaceId: 'ws-3' },
];

function makeDeps(options: {
  agents: RespondingAgent[];
  localAgents?: RespondingAgent[];
  response?: number;
  mode?: ConnectionMode;
  remoteActive?: boolean;
}) {
  const client = { getStatus: () => 'connected', request: vi.fn() } as unknown as RunningAgentsRpc;
  const parentWindow = { id: 42 } as unknown as BrowserWindow;
  const dialogOptions = { message: 'agents working' } as MessageBoxOptions;
  const deps = {
    getBackendClient: vi.fn(() => client),
    getConnectionMode: vi.fn(() => options.mode ?? ('sidecar' as ConnectionMode)),
    isRemoteBackendActive: vi.fn(() => options.remoteActive ?? false),
    listRespondingAgents: vi.fn(async () => options.agents),
    listLocalRespondingAgents: vi.fn(async () => options.localAgents ?? []),
    buildQuitDialogOptions: vi.fn(() => dialogOptions),
    getParentWindow: vi.fn(() => parentWindow),
    showMessageBox: vi.fn(
      async () => ({ response: options.response ?? 0 }) as MessageBoxReturnValue,
    ),
  };
  return { deps, client, parentWindow, dialogOptions };
}

describe('confirmQuitWithRunningAgents', () => {
  it('returns true without showing a dialog when no agents are responding', async () => {
    const { deps, client } = makeDeps({ agents: [] });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    expect(deps.listRespondingAgents).toHaveBeenCalledWith(client);
    expect(deps.buildQuitDialogOptions).not.toHaveBeenCalled();
    expect(deps.showMessageBox).not.toHaveBeenCalled();
  });

  it('returns true when the user confirms, parenting the dialog to the focused/main window', async () => {
    const { deps, parentWindow, dialogOptions } = makeDeps({
      agents: AGENTS,
      response: 0,
      mode: 'external',
    });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    // An adopted external daemon outlives the app: its agents keep running…
    expect(deps.buildQuitDialogOptions).toHaveBeenCalledWith({
      keepRunning: AGENTS,
      interrupted: [],
    });
    // …and the dialog is shown parented to the window from getParentWindow().
    expect(deps.showMessageBox).toHaveBeenCalledWith(parentWindow, dialogOptions);
  });

  it('returns false when the user cancels (dialog cancel button, response 1)', async () => {
    const { deps } = makeDeps({ agents: AGENTS, response: 1 });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(false);

    expect(deps.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('passes a null parent through to showMessageBox when no window is available', async () => {
    const { deps } = makeDeps({ agents: AGENTS, response: 0 });
    deps.getParentWindow.mockReturnValue(null as unknown as BrowserWindow);

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    expect(deps.showMessageBox).toHaveBeenCalledWith(null, expect.anything());
  });
});

describe('confirmQuitWithRunningAgents — local only (no remote pinned)', () => {
  it('groups agents as interrupted in sidecar mode', async () => {
    const { deps } = makeDeps({ agents: AGENTS, mode: 'sidecar' });

    await confirmQuitWithRunningAgents(deps);

    expect(deps.buildQuitDialogOptions).toHaveBeenCalledWith({
      keepRunning: [],
      interrupted: AGENTS,
    });
  });

  it('treats unknown mode conservatively as interrupted', async () => {
    const { deps } = makeDeps({ agents: AGENTS, mode: 'unknown' });

    await confirmQuitWithRunningAgents(deps);

    expect(deps.buildQuitDialogOptions).toHaveBeenCalledWith({
      keepRunning: [],
      interrupted: AGENTS,
    });
  });

  it('never queries the local daemon separately when no remote is pinned', async () => {
    const { deps } = makeDeps({ agents: AGENTS, mode: 'sidecar', localAgents: LOCAL_AGENTS });

    await confirmQuitWithRunningAgents(deps);

    expect(deps.listLocalRespondingAgents).not.toHaveBeenCalled();
  });
});

describe('confirmQuitWithRunningAgents — remote backend active', () => {
  it('frames remote agents as keeping running even when we spawned a local sidecar', async () => {
    const { deps } = makeDeps({ agents: AGENTS, mode: 'sidecar', remoteActive: true });

    await confirmQuitWithRunningAgents(deps);

    expect(deps.buildQuitDialogOptions).toHaveBeenCalledWith({
      keepRunning: AGENTS,
      interrupted: [],
    });
  });

  it('shows the dialog for local sidecar agents even when the remote has none', async () => {
    const { deps, dialogOptions, parentWindow } = makeDeps({
      agents: [],
      localAgents: LOCAL_AGENTS,
      mode: 'sidecar',
      remoteActive: true,
    });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    expect(deps.buildQuitDialogOptions).toHaveBeenCalledWith({
      keepRunning: [],
      interrupted: LOCAL_AGENTS,
    });
    expect(deps.showMessageBox).toHaveBeenCalledWith(parentWindow, dialogOptions);
  });

  it('combines remote keep-running agents with interrupted local sidecar agents', async () => {
    const { deps } = makeDeps({
      agents: AGENTS,
      localAgents: LOCAL_AGENTS,
      mode: 'sidecar',
      remoteActive: true,
    });

    await confirmQuitWithRunningAgents(deps);

    expect(deps.buildQuitDialogOptions).toHaveBeenCalledWith({
      keepRunning: AGENTS,
      interrupted: LOCAL_AGENTS,
    });
  });

  it('merges adopted external local agents into the keep-running group', async () => {
    const { deps } = makeDeps({
      agents: AGENTS,
      localAgents: LOCAL_AGENTS,
      mode: 'external',
      remoteActive: true,
    });

    await confirmQuitWithRunningAgents(deps);

    expect(deps.buildQuitDialogOptions).toHaveBeenCalledWith({
      keepRunning: [...AGENTS, ...LOCAL_AGENTS],
      interrupted: [],
    });
  });

  it('fails open when the local daemon query rejects', async () => {
    const { deps } = makeDeps({ agents: AGENTS, mode: 'sidecar', remoteActive: true });
    deps.listLocalRespondingAgents.mockRejectedValue(new Error('no local daemon'));

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    expect(deps.buildQuitDialogOptions).toHaveBeenCalledWith({
      keepRunning: AGENTS,
      interrupted: [],
    });
  });

  it('treats unknown mode conservatively as interrupted for the local agents', async () => {
    const { deps } = makeDeps({
      agents: AGENTS,
      localAgents: LOCAL_AGENTS,
      mode: 'unknown',
      remoteActive: true,
    });

    await confirmQuitWithRunningAgents(deps);

    expect(deps.buildQuitDialogOptions).toHaveBeenCalledWith({
      keepRunning: AGENTS,
      interrupted: LOCAL_AGENTS,
    });
  });

  it('shows no dialog when neither the remote nor the local daemon has agents', async () => {
    const { deps } = makeDeps({ agents: [], localAgents: [], mode: 'sidecar', remoteActive: true });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    expect(deps.showMessageBox).not.toHaveBeenCalled();
  });
});

describe('confirmQuitWithRunningAgents — overlapping sources', () => {
  it('lists an agent once when both sources resolve to the same daemon', async () => {
    const { deps } = makeDeps({
      agents: AGENTS,
      localAgents: AGENTS,
      mode: 'external',
      remoteActive: true,
    });

    await confirmQuitWithRunningAgents(deps);

    expect(deps.buildQuitDialogOptions).toHaveBeenCalledWith({
      keepRunning: AGENTS,
      interrupted: [],
    });
  });

  it('keeps an overlapping agent in keepRunning only, never in both groups', async () => {
    const { deps } = makeDeps({
      agents: AGENTS,
      localAgents: [AGENTS[0], ...LOCAL_AGENTS],
      mode: 'sidecar',
      remoteActive: true,
    });

    await confirmQuitWithRunningAgents(deps);

    expect(deps.buildQuitDialogOptions).toHaveBeenCalledWith({
      keepRunning: AGENTS,
      interrupted: LOCAL_AGENTS,
    });
  });

  it('queries both sources concurrently rather than one after the other', async () => {
    const { deps } = makeDeps({ agents: AGENTS, mode: 'sidecar', remoteActive: true });
    let activeSettled = false;
    deps.listRespondingAgents.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      activeSettled = true;
      return AGENTS;
    });
    deps.listLocalRespondingAgents.mockImplementation(async () => {
      // Started while the active query is still in flight.
      expect(activeSettled).toBe(false);
      return LOCAL_AGENTS;
    });

    await confirmQuitWithRunningAgents(deps);

    expect(deps.buildQuitDialogOptions).toHaveBeenCalledWith({
      keepRunning: AGENTS,
      interrupted: LOCAL_AGENTS,
    });
  });
});

/**
 * The default probe is exercised through the public entry point: every dep is
 * injected EXCEPT `listLocalRespondingAgents`, so the real
 * `defaultListLocalRespondingAgents` runs against the faked JsonRpcClient.
 */
describe('confirmQuitWithRunningAgents — default startup-backend probe', () => {
  const PROBE_AGENT: RespondingAgent = {
    agentId: 'agent-9',
    name: 'Probe worker',
    workspaceId: 'ws-9',
  };

  function makeProbeDeps() {
    const { deps } = makeDeps({ agents: [], mode: 'sidecar', remoteActive: true });
    const { listLocalRespondingAgents: _omitted, ...rest } = deps;
    return rest;
  }

  beforeEach(() => {
    fake.state.instances.length = 0;
    fake.state.behavior = 'connect';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the agents it finds and disposes the throwaway client', async () => {
    const deps = makeProbeDeps();

    await confirmQuitWithRunningAgents(deps);

    expect(deps.buildQuitDialogOptions).toHaveBeenCalledWith({
      keepRunning: [],
      interrupted: [PROBE_AGENT],
    });
    expect(fake.state.instances).toHaveLength(1);
    expect(fake.state.instances[0].started).toBe(1);
    expect(fake.state.instances[0].disposed).toBe(1);
  });

  it('fails open and disposes the client when the connection errors', async () => {
    fake.state.behavior = 'error';
    const deps = makeProbeDeps();

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    expect(deps.showMessageBox).not.toHaveBeenCalled();
    expect(fake.state.instances[0].disposed).toBe(1);
  });

  it('fails open and disposes the client when the probe exceeds its deadline', async () => {
    fake.state.behavior = 'hang';
    vi.useFakeTimers();
    const deps = makeProbeDeps();

    const pending = confirmQuitWithRunningAgents(deps);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toBe(true);
    expect(deps.showMessageBox).not.toHaveBeenCalled();
    expect(fake.state.instances[0].disposed).toBe(1);
  });
});
