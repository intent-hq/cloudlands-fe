/**
 * Unit tests for the extracted running-agents quit confirmation
 * (src/main/quit-confirmation.ts). All collaborators are injected, so no
 * electron dialog or backend client is touched.
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

function makeDeps(options: {
  agents: RespondingAgent[];
  response?: number;
  mode?: ConnectionMode;
}) {
  const client = { getStatus: () => 'connected', request: vi.fn() } as unknown as RunningAgentsRpc;
  const parentWindow = { id: 42 } as unknown as BrowserWindow;
  const dialogOptions = { message: 'agents working' } as MessageBoxOptions;
  const deps = {
    getBackendClient: vi.fn(() => client),
    getConnectionMode: vi.fn(() => options.mode ?? ('sidecar' as ConnectionMode)),
    listRespondingAgents: vi.fn(async () => options.agents),
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

    // Dialog copy is built from the live connection mode + agent list…
    expect(deps.buildQuitDialogOptions).toHaveBeenCalledWith('external', AGENTS);
    // …and shown parented to the window resolved by getParentWindow().
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
