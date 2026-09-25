/**
 * Shared settings-change application helper used by the settings saga and the
 * daemon event router.
 *
 * The renderer needs to hydrate provider / background-agent / MCP slices from
 * the daemon's persisted settings (PROTOCOL §5.12) so panels render the live
 * snapshot at first paint and so subsequent `settings:changed` notifications
 * (§6.5) only need to apply the delta.
 *
 * READ-ONLY: migration and persistence intents are handed to their ordered
 * saga owners. Dependency-light per `src/store/renderer/AGENTS.md` —
 * imports only the configured store, slice actions, and the
 * typed `settingsChanged` trigger (NOT selectors — importing
 * them would evaluate `store.createSelector` while the store module is still
 * mid-init).
 */
import type { AppliedSettingChange } from '$lib/client/app-client';
import { store as appStore } from '$store/renderer/store';
import { settingsChanged } from '$store/renderer/slices/settings-events/settings-events-slice';
import { loadEnabledProvidersFromStorage } from '$store/renderer/slices/provider-settings/provider-settings-slice';
import {
  backgroundSettingsHydrationRequested,
  type BackgroundAgentType,
} from '$store/renderer/slices/background-agent-settings/background-agent-settings-slice';
import {
  setDisabledServers,
  setEnabled as setMcpEnabled,
  setServers as setMcpServers,
} from '$store/renderer/slices/mcp-settings/mcp-settings-slice';
import type { McpServerConfig } from '$store/renderer/slices/mcp-settings/mcp-settings-types';
import {
  hydrateDefaultProvider,
  loadDefaultReasoningEffortFromStorage,
  loadProviderModelsFromStorage,
} from '$store/renderer/slices/model/model-slice';
import { setDefaultSpecialistId } from '$store/renderer/slices/specialists/specialists-slice';

export { BG_MODEL_MIGRATION_MARKER_KEY } from '$store/renderer/slices/background-agent-settings/background-agent-settings-slice';

/** Apply a single applied-change to the slice that owns its dotted path. */
function applyOne(change: AppliedSettingChange): void {
  const { path, value } = change;
  switch (path) {
    case 'model.defaultProvider': {
      // The reducer's pending-local-intent guard keeps a newer local pick
      // over a stale snapshot/echo until the daemon confirms it.
      if (typeof value === 'string' && value.length > 0) {
        appStore.dispatch(hydrateDefaultProvider(value));
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
    appStore.dispatch(
      backgroundSettingsHydrationRequested({ defaultModel, typeOverrides: overrides }),
    );
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
    if (change.path.startsWith('quickActions.')) {
      hasBackgroundAgentPaths = true;
    }
  }
  // Only reconcile quick-action bundle when the delta contains at least one quickActions.* key
  if (hasBackgroundAgentPaths) {
    applyBackgroundAgentBundle(bundle);
  }
  appStore.dispatch(settingsChanged([...changes]));
}
