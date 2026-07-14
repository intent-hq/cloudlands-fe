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

export class LiveSystemClient implements SystemClient {
  /**
   * Fetches system status from the daemon via `system.status` JSON-RPC.
   *
   * This method intentionally **always resolves** (never rejects), even when
   * the daemon call fails. Callers always receive a `SystemStatusState` object;
   * `nodeVersionOk: null` signals "unknown/error" state. This design keeps the
   * UI stable (no uncaught rejections on transient network/daemon failures) and
   * matches the component contract, which renders `null` as "Checking…" rather
   * than crashing on error.
   *
   * Field coercion: missing or non-boolean `nodeVersionOk` becomes `null` (UI
   * "unknown" state); missing/invalid `auggieInstalled` and `binaryInstallAvailable`
   * become `false` (safer default: if the daemon doesn't confirm installation or
   * availability, the UI should not offer install/download affordances).
   */
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
        auggieInstalled: typeof result.auggieInstalled === "boolean" ? result.auggieInstalled : false,
        binaryInstallAvailable:
          typeof result.binaryInstallAvailable === "boolean" ? result.binaryInstallAvailable : false,
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
    // Release notes are not yet wired through the auto-update surface.
    // autoUpdate() provides update state through autoUpdateClient.getState(),
    // but release notes content is not currently exposed by the auto-update
    // client. Return null for now; wire when the client adds release notes access.
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
    // Emit-once with the initial fetch. status() always resolves, so no rejection
    // handler is needed — the catch branch is unreachable.
    this.status().then((state) => handler(state));
    return () => {};
  }
}
