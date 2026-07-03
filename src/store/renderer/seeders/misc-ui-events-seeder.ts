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
 * Also registers a boot-time mock IPC stub for the same unregistered-channel
 * class of bug as the workspaces/agents seeders: `file-tracking:get-line-stats`
 * (called by WindowTitleBar on mount; the undefined fallback TypeErrors on
 * `response.ok` even though it is caught silently). A neutral empty default
 * keeps the surface quiet until the daemon owns it.
 * (`external-editors:detect-installed` is bridged to the daemon's
 * `host.listInstalledEditors` in host-bridge-seeder.ts.)
 */
import { IPC_CHANNELS } from "$shared/ipc-registry";
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import { SPECIALISTS, type Specialist } from "$lib/constants/specialists";
import type { ModelTier, SpecialistFileScope } from "$shared/specialist-file-types";
import type { SpecialistDef } from "$lib/client/app-client";
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
  type FileSpecialist,
} from "../slices/specialists/specialists-slice";
import { setSkills } from "../slices/skills/skills-slice";
import { hydrateBrowserState } from "../slices/browser/browser-slice";
import { eventsLoaded } from "../slices/workspace-events/workspace-events-slice";

// Registered at import time so the dispatch site (WindowTitleBar mount)
// resolves through the mock router before any component effect could read an
// undefined response.
registerMockIpcHandler(IPC_CHANNELS.FILE_TRACKING.GET_LINE_STATS, async () => ({
  ok: true,
  data: { additions: 0, deletions: 0 },
}));

/** Wire `modelTier` is carried verbatim from frontmatter; only known tiers map. */
const MODEL_TIERS: ReadonlySet<string> = new Set(["fast", "balanced", "smart"]);

function toModelTier(value: string | undefined): ModelTier | undefined {
  return value !== undefined && MODEL_TIERS.has(value) ? (value as ModelTier) : undefined;
}

/** Map a bundled-tier wire `SpecialistDef` (PROTOCOL §5.11) to the store's `Specialist`. */
function toBundledSpecialist(def: SpecialistDef): Specialist {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    codingAgent: def.codingAgent,
    defaultModel: def.model,
    defaultModelTier: toModelTier(def.modelTier),
    defaultBehaviorPrompt: def.behaviorPrompt ?? def.prompt ?? "",
    roleReminder: def.roleReminder,
    source: "bundled",
    defaultAgentType: def.agentType,
  };
}

/** Map a user/project-tier wire `SpecialistDef` to the store's `FileSpecialist`. */
function toFileSpecialist(def: SpecialistDef): FileSpecialist {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    codingAgent: def.codingAgent,
    model: def.model ?? "",
    modelTier: toModelTier(def.modelTier),
    behaviorPrompt: def.behaviorPrompt ?? def.prompt ?? "",
    roleReminder: def.roleReminder,
    filePath: def.path ?? "",
    source: def.source as SpecialistFileScope,
  };
}

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

  // ── Specialists: split the daemon's merged `specialist.list` view ──
  // (PROTOCOL §5.11: 3-tier resolution, project > user > bundled) into the
  // bundled and file-backed slices. When no bundled entries arrive (daemon
  // offline / empty resources) the hardcoded SPECIALISTS constant keeps the
  // picker populated, matching the selector's last-resort fallback.
  const specialistDefs = await client.specialists.list();
  const bundledDefs = specialistDefs.filter((def) => def.source === "bundled");
  const fileDefs = specialistDefs.filter(
    (def) => def.source === "user" || def.source === "project",
  );
  store.dispatch(
    setBundledSpecialists(
      bundledDefs.length > 0 ? bundledDefs.map(toBundledSpecialist) : SPECIALISTS,
    ),
  );
  store.dispatch(setBundledSpecialistsLoaded(true));
  store.dispatch(setOverridesLoaded(true));
  store.dispatch(setCustomSpecialistsLoaded(true));
  store.dispatch(setFileSpecialists(fileDefs.map(toFileSpecialist)));
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
