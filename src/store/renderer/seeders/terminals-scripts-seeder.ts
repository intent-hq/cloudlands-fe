/**
 * Terminals & scripts seeder.
 *
 * Pulls per-workspace terminal tabs and workspace scripts plus the global setup
 * scripts from the `AppClient` seam and dispatches existing slice actions so the
 * terminal overlay and scripts panel render — replacing the work the
 * terminal/scripts/setup-scripts sagas used to do against the real backend.
 *
 * Also bridges the legacy renderer→main terminal IPC channels to the daemon's
 * unified PTY host (PROTOCOL §5.13) through the `AppClient` terminals seam:
 *   `terminal:createWithCommand` → `terminal.create` (with `command`/`cwd`),
 *     emitting the `terminal:created` mock event the panel layout listens for
 *     and forwarding the daemon's `terminal:exit` to the per-terminal
 *     `terminal:professional:exit:<id>` channel CLI blocks subscribe to.
 *   `terminal:professional:write` → `terminal.write` (base64 framing handled
 *     by the live client).
 * The interactive panes themselves (`TerminalAdapter`) already consume the
 * live client directly; no mock terminal handlers feed them.
 */
import { emitMockIpcEvent, registerMockIpcHandler } from "$shared/ipc-mock-router";
import { appClient } from "$lib/client";
import { registerMockSeeder } from "../mock-bootstrap";
import { loadWorkspaceTerminals } from "../slices/terminals/terminals-slice";
import {
  setScriptsData,
  setScriptsInitialized,
} from "../slices/scripts/scripts-slice";
import { hydrateScripts } from "../slices/setup-scripts/setup-scripts-slice";

/** Coerce a possibly-unknown invoke argument into a plain object record. */
function asRecord(arg: unknown): Record<string, unknown> {
  return arg && typeof arg === "object" ? (arg as Record<string, unknown>) : {};
}

/**
 * `terminal:createWithCommand` → daemon `terminal.create` (PROTOCOL §5.13).
 * The daemon runs `command` in the new PTY and assigns the terminal id. On
 * success this emits `terminal:created` (so `PanelLayout` reloads the
 * workspace's terminal list) and forwards the daemon's `terminal:exit` to
 * `terminal:professional:exit:<terminalId>` so call sites (CliBlock,
 * changes/commit panels) observe the command's exit code. Returns the legacy
 * `{ ok, terminalId?, error? }` envelope the call sites consume.
 */
registerMockIpcHandler("terminal:createWithCommand", async (arg) => {
  const params = asRecord(arg);
  const workspaceId = typeof params.workspaceId === "string" ? params.workspaceId : "";
  const command = typeof params.command === "string" ? params.command : "";
  if (!workspaceId || !command) {
    return { ok: false, error: "workspaceId and command are required" };
  }
  const result = await appClient.terminals.create({
    workspaceId,
    cols: 80,
    rows: 24,
    ...(typeof params.cwd === "string" && params.cwd ? { cwd: params.cwd } : {}),
    command,
  });
  if (!result.success || !result.id) {
    return { ok: false, error: result.error ?? "Failed to create terminal" };
  }
  const terminalId = result.id;
  const unsubscribe = appClient.terminals.subscribeEvents(terminalId, {
    onExit: ({ exitCode }) => {
      emitMockIpcEvent(`terminal:professional:exit:${terminalId}`, exitCode);
      unsubscribe();
    },
  });
  emitMockIpcEvent("terminal:created", { terminalId, workspaceId, background: true });
  return { ok: true, terminalId };
});

/** `terminal:professional:write` → daemon `terminal.write` (PROTOCOL §5.13). */
registerMockIpcHandler("terminal:professional:write", async (arg) => {
  const params = asRecord(arg);
  const terminalId = typeof params.terminalId === "string" ? params.terminalId : "";
  const data = typeof params.data === "string" ? params.data : "";
  if (!terminalId) return { success: false, error: "terminalId is required" };
  const result = await appClient.terminals.write(terminalId, data);
  if (!result.success) {
    throw new Error(result.error ?? "terminal.write failed");
  }
  return { success: true };
});

registerMockSeeder("terminals-scripts", async ({ store, client }) => {
  const workspaces = await client.workspaces.list();

  for (const workspace of workspaces) {
    const wsId = String(workspace.id);

    // ── Terminals ──
    try {
      const terminals = await client.terminals.list(wsId);
      if (terminals.length > 0) {
        store.dispatch(loadWorkspaceTerminals(wsId, terminals));
      }
    } catch (err) {
      console.warn(`Mock seeder: failed to load terminals for workspace ${wsId}`, err);
    }

    // ── Workspace scripts ──
    try {
      const scripts = await client.scripts.list(wsId);
      if (scripts.length > 0) {
        store.dispatch(setScriptsData(wsId, scripts));
      }
    } catch (err) {
      console.warn(`Mock seeder: failed to load scripts for workspace ${wsId}`, err);
    }
    store.dispatch(setScriptsInitialized(wsId, true));
  }

  // ── Setup scripts (global, not workspace-scoped) ──
  const setupScripts = await client.setupScripts.list();
  store.dispatch(hydrateScripts(setupScripts));
});
