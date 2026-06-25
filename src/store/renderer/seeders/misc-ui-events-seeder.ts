/**
 * Misc UI & events mock seeder (Wave 2 catch-all).
 *
 * Seeds the remaining UI domains not covered by the other Wave 2 seeders so the
 * app boots with no empty/broken panels and no console errors: system status,
 * release notes, the WebSocket API "disabled" snapshot, available models,
 * specialists, and the per-workspace skills, browser recent URLs and workspace
 * event stream. Data is pulled from the `AppClient` seam and dispatched through
 * existing slice actions — replacing the work the corresponding sagas used to do
 * against the real backend.
 */
import { SPECIALISTS } from "$lib/constants/specialists";
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
import {
  setBundledSpecialists,
  setBundledSpecialistsLoaded,
  setCustomSpecialistsLoaded,
  setFileSpecialists,
  setFileSpecialistsLoaded,
  setOverridesLoaded,
} from "../slices/specialists/specialists-slice";
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

  // ── Specialists: bundled + file specialists, mark every source loaded ──
  store.dispatch(setBundledSpecialists(SPECIALISTS));
  store.dispatch(setBundledSpecialistsLoaded(true));
  store.dispatch(setOverridesLoaded(true));
  store.dispatch(setCustomSpecialistsLoaded(true));
  const fileSpecialists = await client.specialists.listFile();
  store.dispatch(setFileSpecialists(fileSpecialists));
  store.dispatch(setFileSpecialistsLoaded(true));

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
