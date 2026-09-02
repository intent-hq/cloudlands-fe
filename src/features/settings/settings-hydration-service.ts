/**
 * Shared settings-change application helper used by the settings saga and the
 * daemon event router.
 *
 * The renderer needs to hydrate provider / background-agent / MCP slices from
 * the daemon's persisted settings (PROTOCOL §5.12) so panels render the live
 * snapshot at first paint and so subsequent `settings:changed` notifications
 * (§6.5) only need to apply the delta.
 *
 * READ-ONLY (two exceptions): this module never invokes `settings.update`,
 * except for the one-time migrations below (the legacy background-model
 * migration and the default-provider enablement seed), which write the
 * migrated values back so the daemon's stored settings are actually
 * migrated. Dependency-light per `src/store/renderer/AGENTS.md` —
 * imports only the AppClient seam, the configured store, slice actions, the
 * typed `settingsChanged` trigger, and the logger (NOT selectors — importing
 * them would evaluate `store.createSelector` while the store module is still
 * mid-init).
 */
import type { AppliedSettingChange } from '$lib/client/app-client';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { store as appStore } from '$store/renderer/store';
import { getActiveBackendId } from '$store/renderer/utils/backend-storage-namespace';
import { settingsChanged } from '$store/renderer/slices/settings-events/settings-events-slice';
import {
  activeProviderReconciled,
  ensureEnabledIfUnset,
  hydrateActiveProvider,
  loadEnabledProvidersFromStorage,
} from '$store/renderer/slices/provider-settings/provider-settings-slice';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import {
  hydrateSettings as hydrateBackgroundAgentSettings,
  type BackgroundAgentType,
} from '$store/renderer/slices/background-agent-settings/background-agent-settings-slice';
import {
  setDisabledServers,
  setEnabled as setMcpEnabled,
  setServers as setMcpServers,
} from '$store/renderer/slices/mcp-settings/mcp-settings-slice';
import type { McpServerConfig } from '$store/renderer/slices/mcp-settings/mcp-settings-types';
import {
  loadDefaultReasoningEffortFromStorage,
  loadProviderModelsFromStorage,
} from '$store/renderer/slices/model/model-slice';
import { setDefaultSpecialistId } from '$store/renderer/slices/specialists/specialists-slice';

const logger = createLogger('SettingsHydrationService');

/** Apply a single applied-change to the slice that owns its dotted path. */
function applyOne(change: AppliedSettingChange): void {
  const { path, value } = change;
  switch (path) {
    case 'providers.active': {
      if (typeof value === 'string' && value.length > 0) {
        appStore.dispatch(hydrateActiveProvider(value));
        // Mirror only the provider that survived the pending-local-intent guard.
        appStore.dispatch(
          activeProviderReconciled(appStore.state.providerSettings.activeProviderId),
        );
      }
      return;
    }
    case 'providers.enabled': {
      if (value && typeof value === 'object') {
        appStore.dispatch(loadEnabledProvidersFromStorage(value as Record<string, boolean>));
      }
      return;
    }
    case 'mcp.servers': {
      if (Array.isArray(value)) {
        appStore.dispatch(setMcpServers(value as McpServerConfig[]));
      }
      return;
    }
    case 'mcp.disabledServers': {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        appStore.dispatch(setDisabledServers(value as Record<string, true>));
      }
      return;
    }
    case 'mcp.enableUserServers': {
      if (typeof value === 'boolean') appStore.dispatch(setMcpEnabled(value));
      return;
    }
    case 'model.providerDefaults': {
      if (value && typeof value === 'object') {
        appStore.dispatch(loadProviderModelsFromStorage(value as Record<string, string>));
      }
      return;
    }
    case 'model.defaultReasoningEffort': {
      if (typeof value === 'string') {
        appStore.dispatch(loadDefaultReasoningEffortFromStorage(value));
      }
      return;
    }
    case 'specialists.default': {
      // The daemon setting is Option<String>: null/unset clears the default.
      if (typeof value === 'string') {
        appStore.dispatch(setDefaultSpecialistId(value.trim()));
      } else if (value === null) {
        appStore.dispatch(setDefaultSpecialistId(''));
      }
      return;
    }
    case 'quickActions.defaultModel':
    case 'quickActions.typeOverrides':
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
 * `quickActions.defaultModel: "haiku4.5"` on ANY background-settings
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
const LEGACY_BACKGROUND_MODEL = 'haiku4.5';
export const BG_MODEL_MIGRATION_MARKER_KEY = 'bg-model-haiku45-migrated';

function migrateLegacyBackgroundModel(
  defaultModel: string,
  typeOverrides: Record<BackgroundAgentType, string>,
): { defaultModel: string; typeOverrides: Record<BackgroundAgentType, string> } {
  try {
    if (localStorage.getItem(BG_MODEL_MIGRATION_MARKER_KEY) === '1') {
      return { defaultModel, typeOverrides };
    }
  } catch {
    // Storage unavailable: skip the migration rather than risk re-running it
    // (and clobbering a deliberate re-pick) on every boot.
    return { defaultModel, typeOverrides };
  }
  const strip = (value: string): string => (value === LEGACY_BACKGROUND_MODEL ? '' : value);
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
    logger.info('migrating legacy haiku4.5 background-model settings to provider default');
    void appClient.settings
      .update([
        { path: 'quickActions.defaultModel', value: migrated.defaultModel },
        { path: 'quickActions.typeOverrides', value: migrated.typeOverrides },
      ])
      .catch((error) => logger.error('failed to persist legacy background-model migration', error));
  }
  try {
    localStorage.setItem(BG_MODEL_MIGRATION_MARKER_KEY, '1');
  } catch {
    // Marker write failed; the migration may re-run next boot (harmless for
    // legacy values, same accepted edge as a cleared localStorage).
  }
  return migrated;
}

/**
 * One-time migration seeding the default provider's enablement entry
 * (monorepo#1947).
 *
 * fe#759 (v2.17.0) removed the "default provider is enabled when unset"
 * special case from `resolveProviderEnabled`, so every disableable provider
 * resolves disabled without an explicit entry. Pre-2.17 installs never
 * persisted an entry for their default provider (the special case covered
 * it), so after upgrading it resolves disabled until manually re-enabled.
 * When `providers.enabled` hydrates without an entry for the effective
 * default provider (the active provider's model prefix when it is a known
 * catalog row, else `providers.active`), seed it to `true` and persist the map
 * back so the daemon's stored settings are migrated too. When legacy state has
 * no active provider but exactly one persisted `model.providerDefaults` key,
 * that sole key is the only unambiguous migration candidate. An explicit
 * persisted entry (e.g. a deliberate `false`) always wins — the seed only
 * fills the unset case, which also makes the migration naturally idempotent
 * (no run-once marker: after the first seed the explicit entry
 * short-circuits every later hydration).
 *
 * The catalog is fetched over the wire instead of read from the
 * provider-catalog slice because settings hydration races the catalog seeder
 * at boot; catalog-unknown providers are never seeded and non-disableable
 * rows need no entry (always enabled).
 */
let enablementSeedInFlight = false;
let enablementSeedDeferred = false;

/**
 * Boot race guard: `connections.activeId` stays at its boot-time local default
 * until the connections saga's async `connections:list` IPC resolves, while
 * the settings snapshot can hydrate first — so the local-only gate in
 * `seedDefaultProviderEnablement` cannot trust `getActiveBackendId` yet (a
 * remote boot would pass it and seed stale local renderer state into the
 * remote daemon). Defer the seed until `hasReceivedList` flips, then re-run
 * the full gate against the settled active backend.
 */
function deferEnablementSeedUntilConnectionsList(): void {
  if (enablementSeedDeferred) return;
  enablementSeedDeferred = true;
  let settled = false;
  const unsubscribe = appStore.getReadableState().subscribe((state) => {
    if (settled || !state.connections?.hasReceivedList) return;
    settled = true;
    // Microtask: the subscriber fires synchronously on subscribe, before
    // `unsubscribe` is assigned.
    queueMicrotask(() => {
      unsubscribe();
      enablementSeedDeferred = false;
      seedDefaultProviderEnablement();
    });
  });
}

function resolveDefaultProviderCandidate(
  activeProviderId: string,
  providerModels: Record<string, string>,
  knownProviderIds?: readonly string[],
): string {
  const providerModelIds = Object.keys(providerModels);
  const persistedProviderId =
    activeProviderId || (providerModelIds.length === 1 ? providerModelIds[0] : '');
  const model = persistedProviderId ? providerModels[persistedProviderId] : undefined;
  const prefix = model?.includes(':') ? splitLegacyCompoundId(model).providerId : undefined;
  if (prefix && (!knownProviderIds || knownProviderIds.includes(prefix))) return prefix;
  return persistedProviderId;
}

function seedDefaultProviderEnablement(): void {
  const state = appStore.state;
  const { activeProviderId, enabledProviders } = state.providerSettings;
  const providerModels = state.model?.providerModels ?? {};
  const candidate = resolveDefaultProviderCandidate(activeProviderId, providerModels);
  // Cheap sync gate: only hit the wire when some default-provider candidate
  // actually lacks an entry. The async body re-resolves against the catalog.
  if (!candidate || enabledProviders[candidate] !== undefined) return;
  // The backend gate below cannot be trusted until the connections list has
  // landed (activeId is still the boot-time local default) — defer and re-run
  // once it settles. Absent slice (bridge-less test stores) counts as local,
  // matching getActiveBackendId's own fallback.
  if (state.connections && !state.connections.hasReceivedList) {
    deferEnablementSeedUntilConnectionsList();
    return;
  }
  // Local sidecar only: the monorepo#1947 migration exists for pre-2.17 LOCAL
  // installs whose default provider never got a persisted enablement entry. A
  // remote backend's daemon has no such legacy state, and the renderer-side
  // candidate (activeProviderId / model.providerModels) can still reflect the
  // local machine mid-switch — seeding would write that stale local default
  // into the fresh remote daemon's `providers.enabled`.
  if (getActiveBackendId(state) !== LOCAL_CONNECTION_ID) return;
  if (enablementSeedInFlight) return;
  enablementSeedInFlight = true;
  void (async () => {
    try {
      const catalog = await appClient.providers.catalog();
      const settings = appStore.state.providerSettings;
      const row = (id: string) => catalog.providers.find((entry) => entry.id === id);
      const defaultProviderId = resolveDefaultProviderCandidate(
        settings.activeProviderId,
        appStore.state.model?.providerModels ?? {},
        catalog.providers.map((entry) => entry.id),
      );
      if (!defaultProviderId) return;
      const entry = row(defaultProviderId);
      if (!entry || entry.canBeDisabled === false) return;
      // Re-check against live state: an entry may have landed while the
      // catalog read was in flight, and an explicit false must never flip.
      const live = appStore.state.providerSettings.enabledProviders;
      if (live[defaultProviderId] !== undefined) return;
      logger.info('seeding default-provider enablement entry', {
        providerId: defaultProviderId,
      });
      // Persist first, dispatch only after the daemon write succeeds: if the
      // write rejects, the renderer must not diverge from the daemon (which
      // would still resolve the provider disabled). A failed write simply
      // retries on the next `providers.enabled` hydration.
      await appClient.settings.update([
        {
          path: 'providers.enabled',
          value: { ...live, [defaultProviderId]: true },
        },
      ]);
      appStore.dispatch(ensureEnabledIfUnset(defaultProviderId));
    } catch (error) {
      logger.error('failed to seed default-provider enablement', error);
    } finally {
      enablementSeedInFlight = false;
    }
  })();
}

/**
 * Background-agent settings reconcile two dotted paths in one dispatch.
 * Only called when the delta actually includes at least one quickActions.* key.
 */
function applyBackgroundAgentBundle(byPath: Map<string, unknown>): void {
  // A settings:changed delta may only include ONE of defaultModel / typeOverrides.
  // Fall back to current slice state for missing keys so partial updates don't drop values.
  const currentState = appStore.state.backgroundAgentSettings;
  const defaultModel =
    (byPath.get('quickActions.defaultModel') as string | undefined) ?? currentState.defaultModel;
  const typeOverrides =
    (byPath.get('quickActions.typeOverrides') as Record<BackgroundAgentType, string> | undefined) ??
    currentState.typeOverrides;

  // Always dispatch when defaultModel is a string (even if empty) so typeOverrides can hydrate.
  // An empty defaultModel means "provider default" (no explicit model configured).
  if (typeof defaultModel === 'string') {
    const fallback: Record<BackgroundAgentType, string> = {
      commit: '',
      pr: '',
      review: '',
      fast: '',
    };
    const overrides =
      typeOverrides && typeof typeOverrides === 'object' && !Array.isArray(typeOverrides)
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
  let hasEnabledProvidersPath = false;
  for (const change of changes) {
    applyOne(change);
    bundle.set(change.path, change.value);
    if (change.path.startsWith('quickActions.')) {
      hasBackgroundAgentPaths = true;
    }
    if (change.path === 'providers.enabled') {
      hasEnabledProvidersPath = true;
    }
  }
  // Only reconcile quick-action bundle when the delta contains at least one quickActions.* key
  if (hasBackgroundAgentPaths) {
    applyBackgroundAgentBundle(bundle);
  }
  // Seed the default provider's enablement entry when the hydrated map lacks
  // one (upgrade migration, monorepo#1947).
  if (hasEnabledProvidersPath) {
    seedDefaultProviderEnablement();
  }
  appStore.dispatch(settingsChanged([...changes]));
}
