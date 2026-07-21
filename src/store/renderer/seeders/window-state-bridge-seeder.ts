/**
 * Window workspace-state invoke bridge — forwards `window:set-in-workspace`
 * and `window:set-open-workspace-tabs` to the real Electron preload bridge
 * (`window.electronAPI.invoke`) when present.
 *
 * The generated `invoke()` routes ALL legacy renderer invokes through the
 * mock router in every build, including the packaged app. These two channels
 * used to be UNBRIDGED_INVOKE_ALLOWLIST absences, so the main-process
 * handlers in features/system/main/system.ipc.ts never ran and the
 * `windowWorkspaceIds` / `windowOpenWorkspaceTabs` maps stayed empty. That
 * broke every consumer of that window-tracking state: the Window menu,
 * `sendToWorkspaceWindows` (dropped `notification:show`, so no notification
 * sound), per-workspace focus gating, and the NotificationService lifecycle
 * driven by `window-workspace-state-changed`.
 *
 * Same pattern as auto-update-bridge-seeder: forward verbatim when the
 * preload bridge exists; resolve undefined when it does not (browser dev /
 * bridge-less build) — every caller is fire-and-forget with `.catch(() => {})`,
 * matching the former allowlist disposition.
 */
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import { IPC_CHANNELS } from "$shared/ipc-registry";

const WINDOW_STATE_INVOKE_CHANNELS = [
  IPC_CHANNELS.WINDOW.SET_IN_WORKSPACE,
  IPC_CHANNELS.WINDOW.SET_OPEN_WORKSPACE_TABS,
] as const;

/** Register the window workspace-state invoke bridge handlers. Idempotent. */
export function registerWindowStateBridge(): void {
  for (const channel of WINDOW_STATE_INVOKE_CHANNELS) {
    // Forward exactly one payload argument — the real preload bridge signature
    // is `invoke(channel, data?)`, so extra args would be silently dropped.
    registerMockIpcHandler(channel, async (payload?: unknown) => {
      const bridge = typeof window !== "undefined" ? window.electronAPI : undefined;
      if (bridge && typeof bridge.invoke === "function") {
        return bridge.invoke(channel, payload);
      }
      return undefined;
    });
  }
}

registerWindowStateBridge();
