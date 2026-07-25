/**
 * Misc UI & events mock seeder (catch-all).
 *
 * Seeds the remaining UI domains not covered by the other seeders so the
 * app boots with no empty/broken panels and no console errors: system status,
 * release notes, the WebSocket API "disabled" snapshot, available models,
 * specialists, and the per-workspace skills, browser recent URLs and workspace
 * event stream. Data is pulled from the `AppClient` seam and dispatched through
 * existing slice actions — replacing the work the corresponding sagas used to do
 * against the real backend.
 *
 * (`external-editors:detect-installed` is bridged to the daemon's
 * `host.listInstalledEditors` in host-bridge-seeder.ts. The former
 * `file-tracking:get-line-stats` stub is gone — WindowTitleBar's line stats
 * now read the daemon directly via `file-tracking.getLineStats`, PROTOCOL
 * §5.19.)
 */
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import { registerMockSeeder } from "../mock-bootstrap";
import { setSystemStatus } from "../slices/system-status/system-status-slice";
import { setInitialized } from "../slices/release-notes/release-notes-slice";
import {
  setWebSocketApiLoading,
  webSocketApiStatusLoaded,
} from "../slices/websocket-api/websocket-api-slice";
import type { WebSocketApiStatusSnapshot } from "../slices/websocket-api/websocket-api-types";
import {
  setAvailableModels,
  setLoadingStateForProvider,
} from "../slices/model/model-slice";
import { dispatchSpecialistList } from "$features/specialists/specialists-mutation-service";
import { setSkills } from "../slices/skills/skills-slice";
import { hydrateBrowserState } from "../slices/browser/browser-slice";
import { eventsLoaded } from "../slices/workspace-events/workspace-events-slice";

/** Static "disabled" snapshot for the WebSocket API settings pane. */
const DISABLED_WEBSOCKET_API: WebSocketApiStatusSnapshot = {
  enabled: false,
  token: "",
  port: null,
  discoveryEnabled: false,
  discoveryExpiresAt: null,
  localIps: ["127.0.0.1"],
  certFingerprint: "",
};

// ── window:open-new (cmd-click "open in new window" affordances) ──
// SidebarNav / NewWorkspaceCard fall back to in-window navigation from their
// `.catch`, and openWorkspaceInNewWindow folds both a `{ success:false }`
// envelope and a rejection into `goto(route)`. The legacy Electron
// BrowserWindow spawner is gone, so this handler opens the route as a new
// browser window/tab when the environment allows it and otherwise THROWS — a
// resolved failure would strand the `.catch`-only callers on a silent no-op
// (same "a throw is the honest terminal state" idiom as the
// settings-legacy-bridge feature-codes gate). Registered at import time so
// the affordance works from the very first render.
registerMockIpcHandler("window:open-new", async (arg) => {
  const rawRoute = (arg as { route?: unknown } | undefined)?.route;
  const route = typeof rawRoute === "string" && rawRoute.startsWith("/") ? rawRoute : "/";
  const opened =
    typeof window !== "undefined"
      ? window.open(`${window.location.origin}${route}`, "_blank")
      : null;
  if (!opened) {
    throw new Error("Opening a new window is not available in this build");
  }
  opened.opener = null;
  return { success: true };
});

registerMockSeeder("misc-ui-events", async ({ store, client }) => {
  // ── System status (Node / auggie install indicators) ──
  const systemStatus = await client.system.status();
  store.dispatch(setSystemStatus(systemStatus));

  // ── Release notes (mark initialized; modal stays closed on boot) ──
  store.dispatch(setInitialized());

  // ── WebSocket API: static disabled snapshot, resolve the loading spinner ──
  store.dispatch(webSocketApiStatusLoaded(DISABLED_WEBSOCKET_API));
  store.dispatch(setWebSocketApiLoading(false));

  // ── Models (global): populate the picker for the active provider ──
  const providerSettings = await client.settings.getProviderSettings();
  const activeProviderId = providerSettings?.activeProviderId ?? "auggie";
  const models = await client.models.list();
  if (models.length > 0) {
    store.dispatch(setAvailableModels(models));
    store.dispatch(
      setLoadingStateForProvider({
        providerId: activeProviderId,
        status: "success",
        retryAttempt: 0,
      }),
    );
  }

  // ── Specialists: split the daemon's merged `specialist.list` view ──
  // (PROTOCOL §5.11: 3-tier resolution, project > user > bundled) into the
  // bundled and file-backed slices via the shared `dispatchSpecialistList`
  // mappers (same path as the live `specialists:changed` subscription and the
  // post-write refetch), so wire fields (e.g. `hidden`) cannot diverge between
  // the seeder ingest and later refetches. It reconstructs the bundled set
  // from the SPECIALISTS constant overlaid with daemon entries, so an empty
  // bundled tier (daemon offline / empty resources) still populates the picker.
  const specialistDefs = await client.specialists.list();
  dispatchSpecialistList(specialistDefs);

  // ── Per-workspace: skills, browser recent URLs, workspace event stream ──
  const workspaces = await client.workspaces.list();
  for (const workspace of workspaces) {
    const wsId = String(workspace.id);

    const skills = await client.skills.list(wsId);
    store.dispatch(setSkills(wsId, skills));

    const recentUrls = await client.browser.recentUrls(wsId);
    store.dispatch(hydrateBrowserState(wsId, recentUrls));

    const events = await client.events.list(wsId);
    store.dispatch(eventsLoaded(wsId, events));
  }
});
