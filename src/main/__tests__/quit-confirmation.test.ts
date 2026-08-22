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
  browserTabs?: QuitBrowserTabSummary[];
  /** Renderer decision; defaults to null = renderer unavailable (native path). */
  rendererDecision?: boolean | null;
}) {
  const client = { getStatus: () => 'connected', request: vi.fn() } as unknown as RunningAgentsRpc;
  const parentWindow = { id: 42 } as unknown as BrowserWindow;
  const dialogOptions = { message: 'agents working' } as MessageBoxOptions;
  const tabsOnlyDialogOptions = { message: 'tabs connected' } as MessageBoxOptions;
  const deps = {
    getBackendClient: vi.fn(() => client),
    getConnectionMode: vi.fn(() => options.mode ?? ('sidecar' as ConnectionMode)),
    isRemoteBackendActive: vi.fn(() => options.remoteActive ?? false),
    listRespondingAgents: vi.fn(async () => options.agents),
    listLocalRespondingAgents: vi.fn(async () => options.localAgents ?? []),
    listDisruptedBrowserTabs: vi.fn(async () => options.browserTabs ?? []),
    confirmViaRenderer: vi.fn(async () => options.rendererDecision ?? null),
    buildQuitDialogOptions: vi.fn(() => dialogOptions),
    buildTabsOnlyQuitDialogOptions: vi.fn(() => tabsOnlyDialogOptions),
    getParentWindow: vi.fn(() => parentWindow),
    showMessageBox: vi.fn(
      async () => ({ response: options.response ?? 0 }) as MessageBoxReturnValue,
    ),
  };
  return { deps, client, parentWindow, dialogOptions, tabsOnlyDialogOptions };
}

beforeEach(() => {
  resetQuitConfirmationStateForTests();
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

const BROWSER_TABS: QuitBrowserTabSummary[] = [
  { tabId: 'tab-1', ownerAgentId: 'agent-1', title: 'Docs', url: 'https://example.com' },
  { tabId: 'tab-2', ownerAgentId: 'agent-x', workspaceId: 'ws-7' },
];

describe('confirmQuitWithRunningAgents — renderer round-trip', () => {
  it('resolves with the renderer decision and never opens the native dialog', async () => {
    const { deps, parentWindow } = makeDeps({
      agents: AGENTS,
      mode: 'external',
      rendererDecision: true,
    });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    expect(deps.confirmViaRenderer).toHaveBeenCalledWith(
      parentWindow,
      expect.objectContaining({
        requestId: expect.any(String),
        keepRunning: [
          { agentId: 'agent-1', agentName: 'Implementor', workspaceId: 'ws-1' },
          { agentId: 'agent-2', agentName: 'Verifier', workspaceId: 'ws-2' },
        ],
        interrupted: [],
        disruptedBrowserTabs: [],
      }),
    );
    expect(deps.showMessageBox).not.toHaveBeenCalled();
  });

  it('returns false when the renderer reports a cancel', async () => {
    const { deps } = makeDeps({ agents: AGENTS, rendererDecision: false });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(false);

    expect(deps.showMessageBox).not.toHaveBeenCalled();
  });

  it('includes disrupted browser tabs, annotated with known owner names', async () => {
    const { deps } = makeDeps({
      agents: AGENTS,
      browserTabs: BROWSER_TABS,
      rendererDecision: true,
    });

    await confirmQuitWithRunningAgents(deps);

    const payload = deps.confirmViaRenderer.mock.calls[0][1] as QuitConfirmationShowPayload;
    expect(payload.disruptedBrowserTabs).toEqual([
      // agent-1 is a responding agent, so its name rides along…
      { ...BROWSER_TABS[0], ownerAgentName: 'Implementor' },
      // …agent-x is unknown (tab owner not among responding agents): no name.
      BROWSER_TABS[1],
    ]);
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

  it('fails open on tab enumeration errors: prompt still shows, without tab data', async () => {
    const { deps } = makeDeps({ agents: AGENTS, rendererDecision: true });
    deps.listDisruptedBrowserTabs.mockRejectedValue(new Error('cdp gone'));

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    const payload = deps.confirmViaRenderer.mock.calls[0][1] as QuitConfirmationShowPayload;
    expect(payload.disruptedBrowserTabs).toEqual([]);
  });

  it('prompts when no agents respond but disrupted tabs exist (tabs alone trigger it)', async () => {
    const { deps } = makeDeps({ agents: [], browserTabs: BROWSER_TABS, rendererDecision: false });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(false);

    expect(deps.confirmViaRenderer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        keepRunning: [],
        interrupted: [],
        disruptedBrowserTabs: BROWSER_TABS,
      }),
    );
    expect(deps.showMessageBox).not.toHaveBeenCalled();
  });

  it('shows the native tabs-only dialog when the renderer is unavailable, honoring quit', async () => {
    const { deps, parentWindow, tabsOnlyDialogOptions } = makeDeps({
      agents: [],
      browserTabs: BROWSER_TABS,
      rendererDecision: null,
      response: 0,
    });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    expect(deps.confirmViaRenderer).toHaveBeenCalledTimes(1);
    expect(deps.buildTabsOnlyQuitDialogOptions).toHaveBeenCalledWith(BROWSER_TABS.length);
    expect(deps.buildQuitDialogOptions).not.toHaveBeenCalled();
    expect(deps.showMessageBox).toHaveBeenCalledWith(parentWindow, tabsOnlyDialogOptions);
  });

  it('honors cancel from the native tabs-only dialog', async () => {
    const { deps } = makeDeps({
      agents: [],
      browserTabs: BROWSER_TABS,
      rendererDecision: null,
      response: 1,
    });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(false);

    expect(deps.buildTabsOnlyQuitDialogOptions).toHaveBeenCalledWith(BROWSER_TABS.length);
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
    const window = {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send },
    } as unknown as BrowserWindow;
    rest.getParentWindow.mockReturnValue(window);
    return { deps: rest, send };
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
    expect(payload.keepRunning.length + payload.interrupted.length).toBe(AGENTS.length);

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
