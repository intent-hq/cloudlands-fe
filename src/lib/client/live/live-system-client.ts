/**
 * Live system domain backed by the intentd daemon (PROTOCOL §5.7).
 *
 * `status()` → daemon `system.status` through the JSON-RPC IPC bridge.
 * `releaseNotes()` / `autoUpdate()` → the existing auto-update feature surface
 * (Electron-main-owned; the daemon does not own app updates).
 * `subscribe()` → emit-once with the initial fetch, matching how other live
 * clients handle subscribe.
 */
import type { ReleaseNotes } from "$store/renderer/slices/release-notes/release-notes-types";
import type { AutoUpdateState } from "$store/renderer/slices/auto-update/auto-update-types";
import type { SystemStatusState } from "$store/renderer/slices/system-status/system-status-slice";
import type { SystemClient, SubscriptionHandler, Unsubscribe } from "../app-client";
import { backendRequest } from "./backend-transport";
import { autoUpdateClient } from "$features/auto-update/auto-update.client";

function emitOnce<T>(handler: SubscriptionHandler<T>, value: T): Unsubscribe {
  setTimeout(() => handler(value), 0);
  return () => {};
}

export class LiveSystemClient implements SystemClient {
  async status(): Promise<SystemStatusState> {
    try {
      const result = await backendRequest<SystemStatusState>("system.status");
      if (!result || typeof result !== "object") {
        return {
          nodeVersionOk: null,
          nodeVersion: undefined,
          auggieInstalled: false,
          binaryInstallAvailable: false,
        };
      }
      return {
        nodeVersionOk: typeof result.nodeVersionOk === "boolean" ? result.nodeVersionOk : null,
        nodeVersion: typeof result.nodeVersion === "string" ? result.nodeVersion : undefined,
        auggieInstalled: Boolean(result.auggieInstalled),
        binaryInstallAvailable: Boolean(result.binaryInstallAvailable),
      };
    } catch {
      return {
        nodeVersionOk: null,
        nodeVersion: undefined,
        auggieInstalled: false,
        binaryInstallAvailable: false,
      };
    }
  }

  async releaseNotes(): Promise<ReleaseNotes | null> {
    // Release notes are not managed by the daemon; return null.
    // The FE manages this through its own channels.
    return null;
  }

  async autoUpdate(): Promise<AutoUpdateState | null> {
    try {
      const updateState = await autoUpdateClient.getState();
      return {
        ...updateState,
        toastVisible: false,
        downloadedToastDismissedAt: null,
      };
    } catch {
      return null;
    }
  }

  subscribe(handler: SubscriptionHandler<SystemStatusState>): Unsubscribe {
    // Emit-once with the initial fetch.
    this.status().then(
      (state) => handler(state),
      () => {
        handler({
          nodeVersionOk: null,
          nodeVersion: undefined,
          auggieInstalled: false,
          binaryInstallAvailable: false,
        });
      },
    );
    return () => {};
  }
}
