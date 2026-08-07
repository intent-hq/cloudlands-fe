/**
 * Unit tests for the extracted running-agents quit confirmation
 * (src/main/quit-confirmation.ts). All collaborators are injected, so no
 * electron dialog or backend client is touched.
 *
 * The confirmation aggregates two agent sources before deciding anything: the
 * active client (remote when a remote backend is pinned) and — only while a
 * remote is active — a best-effort query of the LOCAL daemon. Each source is
 * grouped by whether quitting shuts its daemon down, so the framing follows
 * daemon ownership rather than the startup connection mode alone.
 */

import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from 'electron';

import type { ConnectionMode } from '../../features/backend/main/connection-mode';
import { confirmQuitWithRunningAgents } from '../quit-confirmation';
import type { RespondingAgent, RunningAgentsRpc } from '../running-agents';

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

  it('shows no dialog when neither the remote nor the local daemon has agents', async () => {
    const { deps } = makeDeps({ agents: [], localAgents: [], mode: 'sidecar', remoteActive: true });

    await expect(confirmQuitWithRunningAgents(deps)).resolves.toBe(true);

    expect(deps.showMessageBox).not.toHaveBeenCalled();
  });
});
