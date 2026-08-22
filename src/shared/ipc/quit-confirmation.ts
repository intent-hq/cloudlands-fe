/**
 * Quit-confirmation IPC payload contract (main ⇄ renderer).
 *
 * The main process (`src/main/quit-confirmation.ts`) renders the "agents are
 * still working" quit prompt in the renderer instead of a native message box.
 * Channels (see `IPC_CHANNELS.QUIT_CONFIRMATION` in `../ipc-registry`):
 *
 * - `quit-confirmation:show` (main → renderer, `webContents.send`):
 *   {@link QuitConfirmationShowPayload}. Sent to the focused/main window.
 * - `quit-confirmation:ack` (renderer → main, `invoke`):
 *   {@link QuitConfirmationAckPayload}. The renderer MUST invoke this as soon
 *   as the modal mounts — main only waits a short window for the ack before
 *   dismissing the request and falling back to the native dialog. Once acked,
 *   main waits indefinitely for the decision (no timeout on the user).
 * - `quit-confirmation:response` (renderer → main, `invoke`):
 *   {@link QuitConfirmationResponsePayload}. Cancel / Escape / backdrop click
 *   all map to `proceed: false`.
 * - `quit-confirmation:dismiss` (main → renderer, `webContents.send`):
 *   {@link QuitConfirmationDismissPayload}. Close the modal for a request that
 *   was settled or superseded (e.g. main gave up waiting for the ack and used
 *   the native fallback).
 *
 * Kept in `src/shared/` so both processes import the same shapes; the Zod
 * schemas validating the renderer → main payloads live in
 * `src/main/ipc-schemas.ts`.
 */

/** One responding agent shown in the prompt (projected from RespondingAgent). */
export interface QuitAgentSummary {
  agentId: string;
  agentName: string;
  workspaceId?: string;
  workspaceName?: string;
}

/** One agent-owned embedded browser tab that quitting would destroy. */
export interface QuitBrowserTabSummary {
  tabId: string;
  ownerAgentId: string;
  ownerAgentName?: string;
  title?: string;
  url?: string;
  workspaceId?: string;
}

/** `quit-confirmation:show` payload (main → renderer). */
export interface QuitConfirmationShowPayload {
  requestId: string;
  /** Agents on a daemon the app does not stop (remote / adopted external). */
  keepRunning: QuitAgentSummary[];
  /** Agents on the app-spawned sidecar, stopped mid-turn by quitting. */
  interrupted: QuitAgentSummary[];
  /** Agent-owned embedded browser tabs destroyed by quitting. */
  disruptedBrowserTabs: QuitBrowserTabSummary[];
}

/** `quit-confirmation:ack` payload (renderer → main invoke). */
export interface QuitConfirmationAckPayload {
  requestId: string;
}

/** `quit-confirmation:response` payload (renderer → main invoke). */
export interface QuitConfirmationResponsePayload {
  requestId: string;
  /** True to proceed with quit; cancel/Escape/backdrop → false. */
  proceed: boolean;
}

/** `quit-confirmation:dismiss` payload (main → renderer). */
export interface QuitConfirmationDismissPayload {
  requestId: string;
}
