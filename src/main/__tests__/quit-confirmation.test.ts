/**
 * Unit tests for the extracted running-agents quit confirmation
 * (src/main/quit-confirmation.ts). All collaborators are injected, so no
 * electron dialog or backend client is touched.
 *
 * The confirmation only cares about agents quitting interrupts — those on the
 * spawned sidecar. They are enumerated only in `sidecar` connection mode, on
 * the pooled local client when a window owns one, else through a best-effort
 * startup/default-backend probe. Remote backends and an adopted external
 * daemon outlive the app, so their agents are never queried and never prompt.
 * Browser tabs never trigger or delay the confirmation.
 *
 * The probe suite drops the `listLocalRespondingAgents` override so the real
 * probe runs against a faked JsonRpcClient.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from 'electron';

import type { ConnectionMode } from '../../features/backend/main/connection-mode';
import type {
  QuitBrowserTabSummary,
  QuitConfirmationShowPayload,
} from '../../shared/ipc/quit-confirmation';
import {
  confirmQuitWithRunningAgents,
  resetQuitConfirmationStateForTests,
} from '../quit-confirmation';
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
      if (method === 'agent.listActive') {
        return {
          streams: [
            { agentId: 'agent-9', sessionId: 'agent-9', workspaceId: 'ws-9', startTime: 0 },
          ],
        };
      }
      return { agent: { id: 'agent-9', name: 'Probe worker', isResponding: true } };
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

const { embeddedBrowserCdp } = vi.hoisted(() => ({
  embeddedBrowserCdp: { listAgentOwnedTabs: vi.fn() },
}));
vi.mock('../../features/browser/main/embedded-browser-cdp-service', () => ({
  embeddedBrowserCdp,
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
  /** Renderer decision; defaults to null = renderer unavailable (native path). */
  rendererDecision?: boolean | null;
}) {
  const client = { getStatus: () => 'connected', request: vi.fn() } as unknown as RunningAgentsRpc;
  const parentWindow = { id: 42 } as unknown as BrowserWindow;
  const dialogOptions = { message: 'agents working' } as MessageBoxOptions;
  const backendId = options.remoteActive ? 'remote-1' : 'local';
  const deps = {
    getBackendTargets: vi.fn(() => [{ id: backendId, client }]),
    getConnectionMode: vi.fn(() => options.mode ?? ('sidecar' as ConnectionMode)),
    listRespondingAgents: vi.fn(async () => options.agents),
    listLocalRespondingAgents: vi.fn(async () => options.localAgents ?? []),
    confirmViaRenderer: vi.fn(async () => options.rendererDecision ?? null),
    buildQuitDialogOptions: vi.fn(() => dialogOptions),
    getParentWindow: vi.fn(() => parentWindow),
    showMessageBox: vi.fn(
      async () => ({ response: options.response ?? 0 }) as MessageBoxReturnValue,
    ),
  };
  return { deps, client, parentWindow, dialogOptions };
}

beforeEach(() => {
  resetQuitConfirmationStateForTests();
  embeddedBrowserCdp.listAgentOwnedTabs.mockReset().mockReturnValue(BROWSER_TABS);
});

describe('confirmQuitWithRunningAgents', () => {
  it('returns true without showing a dialog when no agents are responding', async () => {
    const { deps, client } = makeDeps({ agents: [] });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    expect(deps.listRespondingAgents).toHaveBeenCalledWith(client);
    expect(deps.buildQuitDialogOptions).not.toHaveBeenCalled();
    expect(deps.showMessageBox).not.toHaveBeenCalled();
  });

  it('returns true when the user confirms, parenting the dialog to the focused/main window', async () => {
    const { deps, parentWindow, dialogOptions } = makeDeps({ agents: AGENTS, response: 0 });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    expect(deps.buildQuitDialogOptions).toHaveBeenCalledWith(AGENTS);
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

describe('confirmQuitWithRunningAgents — sidecar gate', () => {
  it('prompts with the local agents as interrupted in sidecar mode', async () => {
    const { deps } = makeDeps({ agents: AGENTS, mode: 'sidecar' });

    await confirmQuitWithRunningAgents(deps);

    expect(deps.buildQuitDialogOptions).toHaveBeenCalledWith(AGENTS);
  });

  it('never prompts for local agents on an adopted external daemon', async () => {
    const { deps, client } = makeDeps({ agents: AGENTS, mode: 'external' });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    expect(deps.listRespondingAgents).not.toHaveBeenCalledWith(client);
    expect(deps.listLocalRespondingAgents).not.toHaveBeenCalled();
    expect(deps.confirmViaRenderer).not.toHaveBeenCalled();
    expect(deps.showMessageBox).not.toHaveBeenCalled();
  });

  it('never prompts while the connection mode is still unknown', async () => {
    const { deps } = makeDeps({ agents: AGENTS, mode: 'unknown' });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    expect(deps.listRespondingAgents).not.toHaveBeenCalled();
    expect(deps.listLocalRespondingAgents).not.toHaveBeenCalled();
    expect(deps.showMessageBox).not.toHaveBeenCalled();
  });

  it('never prompts for agents that only a remote backend reports', async () => {
    const { deps } = makeDeps({ agents: AGENTS, mode: 'sidecar', remoteActive: true });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    expect(deps.confirmViaRenderer).not.toHaveBeenCalled();
    expect(deps.showMessageBox).not.toHaveBeenCalled();
  });

  it('does not query remote backend targets for agents at all', async () => {
    const { deps } = makeDeps({ agents: [], mode: 'sidecar' });
    const localClient = { getStatus: () => 'connected' } as RunningAgentsRpc;
    const remoteAClient = { getStatus: () => 'connected' } as RunningAgentsRpc;
    const remoteBClient = { getStatus: () => 'connected' } as RunningAgentsRpc;
    deps.getBackendTargets.mockReturnValue([
      { id: 'remote-a', client: remoteAClient },
      { id: 'local', client: localClient },
      { id: 'remote-b', client: remoteBClient },
    ]);
    deps.listRespondingAgents.mockImplementation(async (target) =>
      target === localClient ? LOCAL_AGENTS : AGENTS,
    );

    await confirmQuitWithRunningAgents(deps);

    expect(deps.listRespondingAgents).toHaveBeenCalledTimes(1);
    expect(deps.listRespondingAgents).toHaveBeenCalledWith(localClient);
    expect(deps.listLocalRespondingAgents).not.toHaveBeenCalled();
    expect(deps.buildQuitDialogOptions).toHaveBeenCalledWith(LOCAL_AGENTS);
  });

  it('does not probe the local daemon separately when its pooled client is live', async () => {
    const { deps } = makeDeps({ agents: AGENTS, mode: 'sidecar', localAgents: LOCAL_AGENTS });

    await confirmQuitWithRunningAgents(deps);

    expect(deps.listLocalRespondingAgents).not.toHaveBeenCalled();
    expect(deps.buildQuitDialogOptions).toHaveBeenCalledWith(AGENTS);
  });

  it('probes the running sidecar when no window owns a local client', async () => {
    const { deps } = makeDeps({ agents: [], localAgents: LOCAL_AGENTS, mode: 'sidecar' });
    deps.getBackendTargets.mockReturnValue([]);

    await confirmQuitWithRunningAgents(deps);

    expect(deps.listLocalRespondingAgents).toHaveBeenCalledTimes(1);
    expect(deps.buildQuitDialogOptions).toHaveBeenCalledWith(LOCAL_AGENTS);
  });

  it('prompts for probed sidecar agents when only a remote window is open', async () => {
    const { deps, dialogOptions, parentWindow } = makeDeps({
      agents: AGENTS,
      localAgents: LOCAL_AGENTS,
      mode: 'sidecar',
      remoteActive: true,
    });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    expect(deps.listLocalRespondingAgents).toHaveBeenCalledTimes(1);
    expect(deps.buildQuitDialogOptions).toHaveBeenCalledWith(LOCAL_AGENTS);
    expect(deps.showMessageBox).toHaveBeenCalledWith(parentWindow, dialogOptions);
  });

  it('fails open when the local probe rejects', async () => {
    const { deps } = makeDeps({ agents: AGENTS, mode: 'sidecar', remoteActive: true });
    deps.listLocalRespondingAgents.mockRejectedValue(new Error('no local daemon'));

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    expect(deps.showMessageBox).not.toHaveBeenCalled();
  });

  it('shows no dialog when the sidecar has no agents', async () => {
    const { deps } = makeDeps({ agents: [], localAgents: [], mode: 'sidecar', remoteActive: true });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    expect(deps.showMessageBox).not.toHaveBeenCalled();
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

    expect(deps.buildQuitDialogOptions).toHaveBeenCalledWith([PROBE_AGENT]);
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

const BROWSER_TABS: QuitBrowserTabSummary[] = [
  { tabId: 'tab-1', ownerAgentId: 'agent-1', title: 'Docs', url: 'https://example.com' },
  { tabId: 'tab-2', ownerAgentId: 'agent-x', workspaceId: 'ws-7' },
];

describe('confirmQuitWithRunningAgents — renderer round-trip', () => {
  it('resolves with the renderer decision and never opens the native dialog', async () => {
    const { deps, parentWindow } = makeDeps({ agents: AGENTS, rendererDecision: true });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    expect(deps.confirmViaRenderer).toHaveBeenCalledWith(parentWindow, {
      requestId: expect.any(String),
      interrupted: [
        { agentId: 'agent-1', agentName: 'Implementor', workspaceId: 'ws-1' },
        { agentId: 'agent-2', agentName: 'Verifier', workspaceId: 'ws-2' },
      ],
      disruptedBrowserTabs: [],
    });
    expect(deps.showMessageBox).not.toHaveBeenCalled();
  });

  it('returns false when the renderer reports a cancel', async () => {
    const { deps } = makeDeps({ agents: AGENTS, rendererDecision: false });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(false);

    expect(deps.showMessageBox).not.toHaveBeenCalled();
  });

  it('warns only about interrupted agents even with agent-owned browser tabs', async () => {
    const { deps } = makeDeps({ agents: AGENTS, rendererDecision: true });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    const payload = deps.confirmViaRenderer.mock.calls[0][1] as QuitConfirmationShowPayload;
    expect(payload.interrupted).toHaveLength(AGENTS.length);
    expect(payload.disruptedBrowserTabs).toEqual([]);
    expect(embeddedBrowserCdp.listAgentOwnedTabs).not.toHaveBeenCalled();
  });

  it('falls back to the native dialog when the renderer path resolves null', async () => {
    const { deps, parentWindow, dialogOptions } = makeDeps({
      agents: AGENTS,
      rendererDecision: null,
      response: 1,
    });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(false);

    expect(deps.confirmViaRenderer).toHaveBeenCalledTimes(1);
    expect(deps.showMessageBox).toHaveBeenCalledWith(parentWindow, dialogOptions);
  });

  it.each(['sidecar', 'external', 'unknown'] satisfies ConnectionMode[])(
    'quits without a browser warning when no agents are interrupted (%s)',
    async (mode) => {
      const { deps } = makeDeps({ agents: [], mode, rendererDecision: false });

      await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

      expect(deps.confirmViaRenderer).not.toHaveBeenCalled();
      expect(deps.showMessageBox).not.toHaveBeenCalled();
      expect(embeddedBrowserCdp.listAgentOwnedTabs).not.toHaveBeenCalled();
    },
  );

  it('does not show a native browser warning when the renderer is unavailable', async () => {
    const { deps } = makeDeps({ agents: [], rendererDecision: null, response: 1 });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    expect(deps.confirmViaRenderer).not.toHaveBeenCalled();
    expect(deps.buildQuitDialogOptions).not.toHaveBeenCalled();
    expect(deps.showMessageBox).not.toHaveBeenCalled();
    expect(embeddedBrowserCdp.listAgentOwnedTabs).not.toHaveBeenCalled();
  });

  it('shares one in-flight confirmation between concurrent callers', async () => {
    const { deps } = makeDeps({ agents: AGENTS });
    let settle!: (value: boolean | null) => void;
    deps.confirmViaRenderer.mockImplementation(
      () => new Promise<boolean | null>((resolve) => (settle = resolve)),
    );

    const first = confirmQuitWithRunningAgents(deps);
    const second = confirmQuitWithRunningAgents(deps);
    await vi.waitFor(() => expect(deps.confirmViaRenderer).toHaveBeenCalledTimes(1));
    settle(true);

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(deps.listRespondingAgents).toHaveBeenCalledTimes(1);
  });
});

/**
 * The default renderer round-trip is exercised through the public entry
 * point: every dep is injected EXCEPT `confirmViaRenderer`, so the real
 * `defaultConfirmViaRenderer` runs against the globally mocked ipcMain and a
 * fake window.
 */
describe('confirmQuitWithRunningAgents — default renderer round-trip', () => {
  function makeRendererDeps(options: { agents?: RespondingAgent[]; response?: number } = {}) {
    const { deps } = makeDeps({ agents: options.agents ?? AGENTS, response: options.response });
    const { confirmViaRenderer: _omitted, ...rest } = deps;
    const send = vi.fn();
    const goneListeners = new Map<string, (() => void)[]>();
    const webContents = {
      isDestroyed: () => false,
      send,
      once: vi.fn((event: string, listener: () => void) => {
        const existing = goneListeners.get(event) ?? [];
        existing.push(listener);
        goneListeners.set(event, existing);
      }),
      removeListener: vi.fn(),
    };
    const window = {
      isDestroyed: () => false,
      webContents,
    } as unknown as BrowserWindow;
    rest.getParentWindow.mockReturnValue(window);
    const emitRendererGone = (event: string) => {
      for (const listener of goneListeners.get(event) ?? []) listener();
    };
    return { deps: rest, send, webContents, emitRendererGone };
  }

  async function getHandlers() {
    const { ipcMain } = await import('electron');
    const handle = vi.mocked(ipcMain.handle);
    const find = (channel: string) =>
      handle.mock.calls.filter(([c]) => c === channel).at(-1)?.[1] as (
        event: unknown,
        data: unknown,
      ) => Promise<unknown>;
    return {
      ack: find('quit-confirmation:ack'),
      response: find('quit-confirmation:response'),
    };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves the renderer decision after ack + response, skipping the native dialog', async () => {
    const { deps, send } = makeRendererDeps();

    const pending = confirmQuitWithRunningAgents(deps);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));

    const [channel, payload] = send.mock.calls[0] as [string, QuitConfirmationShowPayload];
    expect(channel).toBe('quit-confirmation:show');
    expect(payload.interrupted).toHaveLength(AGENTS.length);

    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: payload.requestId });
    await handlers.response({}, { requestId: payload.requestId, proceed: false });

    await expect(pending).resolves.toBe(false);
    expect(deps.showMessageBox).not.toHaveBeenCalled();
  });

  it('ignores ack/response for a stale requestId and keeps waiting', async () => {
    const { deps, send } = makeRendererDeps();

    const pending = confirmQuitWithRunningAgents(deps);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const payload = send.mock.calls[0][1] as QuitConfirmationShowPayload;

    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: 'stale-id' });
    await handlers.response({}, { requestId: 'stale-id', proceed: false });
    // The genuine request is still pending — settle it now.
    await handlers.ack({}, { requestId: payload.requestId });
    await handlers.response({}, { requestId: payload.requestId, proceed: true });

    await expect(pending).resolves.toBe(true);
  });

  it('treats a valid response as an implicit ack when the ack invoke was lost', async () => {
    vi.useFakeTimers();
    const { deps, send } = makeRendererDeps({ response: 0 });

    const pending = confirmQuitWithRunningAgents(deps);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const payload = send.mock.calls[0][1] as QuitConfirmationShowPayload;

    // The ack invoke never arrives, but the user answers within the 3s window.
    const handlers = await getHandlers();
    await handlers.response({}, { requestId: payload.requestId, proceed: false });
    // The ack timeout must have been defused: advancing past it changes nothing.
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(pending).resolves.toBe(false);
    expect(deps.showMessageBox).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalledWith('quit-confirmation:dismiss', expect.anything());
  });

  it('falls back to the native dialog when the renderer dies after acking, and clears the in-flight memo', async () => {
    const { deps, send, emitRendererGone } = makeRendererDeps({ response: 0 });

    const pending = confirmQuitWithRunningAgents(deps);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const payload = send.mock.calls[0][1] as QuitConfirmationShowPayload;

    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: payload.requestId });
    // Renderer crashes after acking — the decision will never arrive.
    emitRendererGone('render-process-gone');

    await expect(pending).resolves.toBe(true);
    expect(deps.showMessageBox).toHaveBeenCalledTimes(1);

    // A fresh quit attempt must not reuse the settled confirmation.
    const second = makeRendererDeps({ response: 1 });
    const secondPending = confirmQuitWithRunningAgents(second.deps);
    await vi.waitFor(() => expect(second.send).toHaveBeenCalledTimes(1));
    const secondPayload = second.send.mock.calls[0][1] as QuitConfirmationShowPayload;
    expect(secondPayload.requestId).not.toBe(payload.requestId);
    const secondHandlers = await getHandlers();
    await secondHandlers.ack({}, { requestId: secondPayload.requestId });
    await secondHandlers.response({}, { requestId: secondPayload.requestId, proceed: true });
    await expect(secondPending).resolves.toBe(true);
  });

  it('falls back to the native dialog when the webContents is destroyed before acking', async () => {
    const { deps, send, emitRendererGone } = makeRendererDeps({ response: 1 });

    const pending = confirmQuitWithRunningAgents(deps);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));

    emitRendererGone('destroyed');

    await expect(pending).resolves.toBe(false);
    expect(deps.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('falls back to the native dialog when the renderer navigates away mid-decision', async () => {
    const { deps, send, emitRendererGone } = makeRendererDeps({ response: 0 });

    const pending = confirmQuitWithRunningAgents(deps);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const payload = send.mock.calls[0][1] as QuitConfirmationShowPayload;

    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: payload.requestId });
    // A reload/navigation wipes the modal and its renderer-side state.
    emitRendererGone('did-navigate');

    await expect(pending).resolves.toBe(true);
    expect(deps.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('falls back to the native dialog and dismisses when the renderer never acks', async () => {
    vi.useFakeTimers();
    const { deps, send } = makeRendererDeps({ response: 0 });

    const pending = confirmQuitWithRunningAgents(deps);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const payload = send.mock.calls[0][1] as QuitConfirmationShowPayload;

    await vi.advanceTimersByTimeAsync(3_000);

    await expect(pending).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith('quit-confirmation:dismiss', {
      requestId: payload.requestId,
    });
    expect(deps.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('falls back to the native dialog without sending when no window exists', async () => {
    const { deps, send } = makeRendererDeps({ response: 1 });
    deps.getParentWindow.mockReturnValue(null as unknown as BrowserWindow);

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(false);

    expect(send).not.toHaveBeenCalled();
    expect(deps.showMessageBox).toHaveBeenCalledWith(null, expect.anything());
  });

  it('falls back to the native dialog when webContents.send throws', async () => {
    const { deps, send } = makeRendererDeps({ response: 0 });
    send.mockImplementation(() => {
      throw new Error('render frame disposed');
    });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    expect(deps.showMessageBox).toHaveBeenCalledTimes(1);
  });
});
