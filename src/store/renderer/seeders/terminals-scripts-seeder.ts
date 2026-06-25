/**
 * Terminals & scripts mock seeder.
 *
 * Pulls per-workspace terminal tabs and workspace scripts plus the global setup
 * scripts from the `AppClient` seam and dispatches existing slice actions so the
 * terminal overlay and scripts panel render with mock data — replacing the work
 * the terminal/scripts/setup-scripts sagas used to do against the real backend.
 *
 * Terminals also need the renderer→main IPC boundary mocked: when the terminal
 * overlay opens, `TerminalAdapter` invokes `terminal:professional:*` channels to
 * check the backend terminal and restore its scrollback. Those channels are
 * registered against the mock IPC router here so a seeded terminal renders
 * (existing terminal → restore buffer → reconnect) instead of erroring.
 */
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import { registerMockSeeder } from "../mock-bootstrap";
import { loadWorkspaceTerminals } from "../slices/terminals/terminals-slice";
import {
  setScriptsData,
  setScriptsInitialized,
} from "../slices/scripts/scripts-slice";
import { hydrateScripts } from "../slices/setup-scripts/setup-scripts-slice";

/** Read a `terminalId` field off an opaque IPC invoke argument. */
function readTerminalId(arg: unknown): string {
  return (arg as { terminalId?: string } | undefined)?.terminalId ?? "";
}

registerMockSeeder("terminals-scripts", async ({ store, client }) => {
  // ── Terminal IPC handlers (TerminalAdapter calls these on overlay open) ──
  // Report every seeded terminal as existing on the backend so the adapter
  // restores its buffer and reconnects rather than opening a new PTY.
  registerMockIpcHandler("terminal:professional:info", async (arg) => ({
    success: true,
    info: { id: readTerminalId(arg) },
  }));
  registerMockIpcHandler("terminal:professional:get-buffer", async (arg) => ({
    success: true,
    buffer: await client.terminals.output(readTerminalId(arg)),
  }));
  registerMockIpcHandler("terminal:professional:create", async () => ({
    success: true,
  }));

  const workspaces = await client.workspaces.list();

  for (const workspace of workspaces) {
    const wsId = String(workspace.id);

    // ── Terminals ──
    const terminals = await client.terminals.list(wsId);
    if (terminals.length > 0) {
      store.dispatch(loadWorkspaceTerminals(wsId, terminals));
    }

    // ── Workspace scripts ──
    const scripts = await client.scripts.list(wsId);
    if (scripts.length > 0) {
      store.dispatch(setScriptsData(wsId, scripts));
    }
    store.dispatch(setScriptsInitialized(wsId, true));
  }

  // ── Setup scripts (global, not workspace-scoped) ──
  const setupScripts = await client.setupScripts.list();
  store.dispatch(hydrateScripts(setupScripts));
});
