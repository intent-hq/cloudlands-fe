/**
 * Settings hydration service — boot-time read of every BE-owned setting plus a
 * shared `applySettingsChanges()` helper the `settings:changed` bridge reuses.
 *
 * The renderer needs to hydrate provider / background-agent / MCP slices from
 * the daemon's persisted settings (PROTOCOL §5.12) so panels render the live
 * snapshot at first paint and so subsequent `settings:changed` notifications
 * (§6.5) only need to apply the delta. Like `git-read-service`, this
 * reconnects the read path WITHOUT re-adding a saga and WITHOUT changing any
 * call site: the middleware kicks off one `settings.list` on first dispatched
 * action and routes every entry through `applySettingsChanges` — the same
 * function `daemon-events-bridge` calls on `settings:changed`.
 *
 * READ-ONLY (one exception): this module never invokes `settings.update`,
 * except for the one-time legacy background-model migration below, which
 * writes the normalized values back so the daemon's stored settings are
 * actually migrated. Dependency-light per `src/store/renderer/AGENTS.md` —
 * imports only the AppClient seam, the configured store, slice actions, the
 * typed `settingsChanged` trigger, and the logger (NOT selectors — importing
 * them would evaluate `store.createSelector` while the store module is still
 * mid-init).
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import type { AppliedSettingChange } from "$lib/client/app-client";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { createLogger } from "$lib/utils/client-logger";
import { settingsChanged } from "$store/renderer/slices/settings-events/settings-events-slice";
import {
  hydrateActiveProvider,
  loadEnabledProvidersFromStorage,
} from "$store/renderer/slices/provider-settings/provider-settings-slice";
import {
  hydrateSettings as hydrateBackgroundAgentSettings,
  type BackgroundAgentType,
} from "$store/renderer/slices/background-agent-settings/background-agent-settings-slice";
import {
  setDisabledServers,
  setEnabled as setMcpEnabled,
  setServers as setMcpServers,
} from "$store/renderer/slices/mcp-settings/mcp-settings-slice";
import type { McpServerConfig } from "$store/renderer/slices/mcp-settings/mcp-settings-types";
import {
  loadDefaultReasoningEffortFromStorage,
  loadProviderModelsFromStorage,
} from "$store/renderer/slices/model/model-slice";

const logger = createLogger("SettingsHydrationService");

let installed = false;

/** Apply a single applied-change to the slice that owns its dotted path. */
function applyOne(change: AppliedSettingChange): void {
  const { path, value } = change;
  switch (path) {
    case "providers.active": {
      if (typeof value === "string" && value.length > 0) {
        appStore.dispatch(hydrateActiveProvider(value));
      }
      return;
    }
    case "providers.enabled": {
      if (value && typeof value === "object") {
        appStore.dispatch(
          loadEnabledProvidersFromStorage(value as Record<string, boolean>),
        );
      }
      return;
    }
    case "mcp.servers": {
      if (Array.isArray(value)) {
        appStore.dispatch(setMcpServers(value as McpServerConfig[]));
      }
      return;
    }
    case "mcp.disabledServers": {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        appStore.dispatch(setDisabledServers(value as Record<string, true>));
      }
      return;
    }
    case "mcp.enableUserServers": {
      if (typeof value === "boolean") appStore.dispatch(setMcpEnabled(value));
      return;
    }
    case "model.providerDefaults": {
      if (value && typeof value === "object") {
        appStore.dispatch(
          loadProviderModelsFromStorage(value as Record<string, string>),
        );
      }
      return;
    }
    case "model.defaultReasoningEffort": {
      if (typeof value === "string") {
        appStore.dispatch(loadDefaultReasoningEffortFromStorage(value));
      }
      return;
    }
    case "backgroundAgents.defaultModel":
    case "backgroundAgents.typeOverrides":
      // These are bundled and applied via applyBackgroundAgentBundle at the
      // end of applySettingsChanges, so we don't dispatch here to avoid
      // duplicate/partial hydration. Individual path changes still trigger
      // the bundle logic.
      return;
  }
}

/**
 * One-time migration of legacy persisted `haiku4.5` background-model values.
 *
 * The pre-provider-default persistence middleware wrote
 * `backgroundAgents.defaultModel: "haiku4.5"` on ANY background-settings
 * action (with '' → haiku4.5 hydration normalization), so for existing
 * installs a persisted haiku4.5 is an artifact of the removed hardcode, not a
 * deliberate pick. On the first hydration per install, strip haiku4.5 (default
 * and per-type overrides) to '' (provider default) and persist the normalized
 * values back so the daemon's stored settings are migrated too; then set a
 * local marker so the migration never re-runs — a deliberate post-migration
 * re-pick of haiku4.5 hydrates verbatim. The stored value alone cannot
 * distinguish legacy artifact from genuine pick, so a cleared localStorage
 * re-runs the migration (accepted edge; users re-pick via the explicit
 * "Provider default"-aware picker).
 */
const LEGACY_BACKGROUND_MODEL = "haiku4.5";
export const BG_MODEL_MIGRATION_MARKER_KEY = "bg-model-haiku45-migrated";

function migrateLegacyBackgroundModel(
  defaultModel: string,
  typeOverrides: Record<BackgroundAgentType, string>,
): { defaultModel: string; typeOverrides: Record<BackgroundAgentType, string> } {
  try {
    if (localStorage.getItem(BG_MODEL_MIGRATION_MARKER_KEY) === "1") {
      return { defaultModel, typeOverrides };
    }
  } catch {
    // Storage unavailable: skip the migration rather than risk re-running it
    // (and clobbering a deliberate re-pick) on every boot.
    return { defaultModel, typeOverrides };
  }
  const strip = (value: string): string => (value === LEGACY_BACKGROUND_MODEL ? "" : value);
  const migrated = {
    defaultModel: strip(defaultModel),
    typeOverrides: {
      commit: strip(typeOverrides.commit),
      pr: strip(typeOverrides.pr),
      review: strip(typeOverrides.review),
      fast: strip(typeOverrides.fast),
    },
  };
  const changed =
    migrated.defaultModel !== defaultModel ||
    (Object.keys(migrated.typeOverrides) as BackgroundAgentType[]).some(
      (type) => migrated.typeOverrides[type] !== typeOverrides[type],
    );
  if (changed) {
    logger.info("migrating legacy haiku4.5 background-model settings to provider default");
    void appClient.settings
      .update([
        { path: "backgroundAgents.defaultModel", value: migrated.defaultModel },
        { path: "backgroundAgents.typeOverrides", value: migrated.typeOverrides },
      ])
      .catch((error) =>
        logger.error("failed to persist legacy background-model migration", error),
      );
  }
  try {
    localStorage.setItem(BG_MODEL_MIGRATION_MARKER_KEY, "1");
  } catch {
    // Marker write failed; the migration may re-run next boot (harmless for
    // legacy values, same accepted edge as a cleared localStorage).
  }
  return migrated;
}

/**
 * Background-agent settings reconcile two dotted paths in one dispatch.
 * Only called when the delta actually includes at least one backgroundAgents.* key.
 */
function applyBackgroundAgentBundle(byPath: Map<string, unknown>): void {
  // A settings:changed delta may only include ONE of defaultModel / typeOverrides.
  // Fall back to current slice state for missing keys so partial updates don't drop values.
  const currentState = appStore.state.backgroundAgentSettings;
  const defaultModel =
    (byPath.get("backgroundAgents.defaultModel") as string | undefined) ?? currentState.defaultModel;
  const typeOverrides =
    (byPath.get("backgroundAgents.typeOverrides") as Record<BackgroundAgentType, string> | undefined) ??
    currentState.typeOverrides;

  // Always dispatch when defaultModel is a string (even if empty) so typeOverrides can hydrate.
  // An empty defaultModel means "provider default" (no explicit model configured).
  if (typeof defaultModel === "string") {
    const fallback: Record<BackgroundAgentType, string> = {
      commit: "",
      pr: "",
      review: "",
      fast: "",
    };
    const overrides =
      typeOverrides && typeof typeOverrides === "object" && !Array.isArray(typeOverrides)
        ? { ...fallback, ...(typeOverrides as Record<string, string>) }
        : fallback;
    const migrated = migrateLegacyBackgroundModel(
      defaultModel,
      overrides as Record<BackgroundAgentType, string>,
    );
    appStore.dispatch(hydrateBackgroundAgentSettings(migrated));
  }
}

/**
 * Apply an applied-change list (boot snapshot or `settings:changed` delta) into
 * the relevant Redux slices and emit the typed `settingsChanged` trigger so
 * panels with bespoke wiring can react. Unknown paths are silently skipped
 * (the FE intentionally tolerates BE-side schema additions).
 */
export function applySettingsChanges(changes: readonly AppliedSettingChange[]): void {
  if (changes.length === 0) return;
  const bundle = new Map<string, unknown>();
  let hasBackgroundAgentPaths = false;
  for (const change of changes) {
    applyOne(change);
    bundle.set(change.path, change.value);
    if (change.path.startsWith("backgroundAgents.")) {
      hasBackgroundAgentPaths = true;
    }
  }
  // Only reconcile background-agent bundle when the delta contains at least one backgroundAgents.* key
  if (hasBackgroundAgentPaths) {
    applyBackgroundAgentBundle(bundle);
  }
  appStore.dispatch(settingsChanged([...changes]));
}

/** Pull every BE-owned setting once and route it through `applySettingsChanges`. */
async function hydrateOnce(): Promise<void> {
  try {
    const list = await appClient.settings.list();
    if (!Array.isArray(list) || list.length === 0) return;
    const changes: AppliedSettingChange[] = list.map((entry) => ({
      path: entry.path,
      value: entry.value,
    }));
    applySettingsChanges(changes);
  } catch (error) {
    logger.error("settings hydration failed", error);
  }
}

/**
 * Lazily hydrate settings on the first dispatched action so the renderer store
 * is fully constructed before we touch `appClient` / `appStore`. The call is
 * fire-and-forget — dispatch stays synchronous and is never blocked by the
 * boot read.
 */
export function createSettingsHydrationMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    if (!installed) {
      installed = true;
      void hydrateOnce();
    }
    return next(action);
  };
}

/** Test-only — reset the installed-once guard so each test fixture can boot fresh. */
export function __resetSettingsHydrationForTests(): void {
  installed = false;
}
