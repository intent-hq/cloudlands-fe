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
import {
  hydrateProviderFastMode,
  loadEnabledProvidersFromStorage,
} from '$store/renderer/slices/provider-settings/provider-settings-slice';
import {
  hydrateSettings as hydrateBackgroundAgentSettings,
  backgroundSettingsHydrationRequested,
  type BackgroundAgentType,
  type BackgroundAgentSettingsState,
} from '$store/renderer/slices/background-agent-settings/background-agent-settings-slice';
import {
  setDisabledServers,
  setEnabled as setMcpEnabled,
  setServers as setMcpServers,
} from '$store/renderer/slices/mcp-settings/mcp-settings-slice';
import type { McpServerConfig } from '$store/renderer/slices/mcp-settings/mcp-settings-types';
import {
  hydrateDefaultProvider,
  loadProviderModelsFromStorage,
  loadDefaultReasoningEffortFromStorage,
} from '$store/renderer/slices/model/model-slice';
import { setDefaultSpecialistId } from '$store/renderer/slices/specialists/specialists-slice';
import { hydrateNotificationVolume } from '$store/renderer/slices/user-preferences/user-preferences-slice';

import { hydrateNotificationSettings } from '$store/renderer/slices/user-preferences/user-preferences-slice';

export { BG_MODEL_MIGRATION_MARKER_KEY } from '$store/renderer/slices/background-agent-settings/background-agent-settings-slice';

/** Apply a single applied-change to the slice that owns its dotted path. */
function applyOne(change: AppliedSettingChange, revision?: number): void {
  const { path, value } = change;
  switch (path) {
    case 'notifications.soundPath':
      if (typeof value === 'string')
        appStore.dispatch(hydrateNotificationSettings({ soundPath: value }, revision));
      return;
    case 'notifications.enabled':
      if (typeof value === 'boolean')
        appStore.dispatch(hydrateNotificationSettings({ enabled: value }, revision));
      return;
    case 'notifications.soundEnabled':
      if (typeof value === 'boolean')
        appStore.dispatch(hydrateNotificationSettings({ soundEnabled: value }, revision));
      return;
    case 'notifications.soundOnlyWhenUnfocused':
      if (typeof value === 'boolean')
        appStore.dispatch(hydrateNotificationSettings({ soundOnlyWhenUnfocused: value }, revision));
      return;
    case 'model.defaultProvider': {
      if (typeof value === 'string') appStore.dispatch(hydrateDefaultProvider(value));
      else if (value === null) appStore.dispatch(hydrateDefaultProvider(''));
      return;
    }
    case 'model.providerDefaults': {
      if (value && typeof value === 'object' && !Array.isArray(value))
        appStore.dispatch(loadProviderModelsFromStorage(value as Record<string, string>));
      return;
    }
    case 'notifications.volume': {
      if (typeof value === 'number') appStore.dispatch(hydrateNotificationVolume(value, revision));
      return;
    }
    case 'providers.fastMode': {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const entries = Object.entries(value).filter(
          ([id, enabled]) => ['claude-code', 'codex'].includes(id) && typeof enabled === 'boolean',
        );
        appStore.dispatch(hydrateProviderFastMode(Object.fromEntries(entries), revision));
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
 * Reconcile provider identity and the quick-action model/effort bundle together.
 */
function applyBackgroundAgentBundle(byPath: Map<string, unknown>, revision?: number): void {
  // A settings:changed delta may only include ONE of defaultModel / typeOverrides.
  // Fall back to current slice state for missing keys so partial updates don't drop values.
  const currentState = appStore.state.backgroundAgentSettings;
  const incomingProvider = byPath.get('model.defaultProvider');
  const providerId =
    typeof incomingProvider === 'string'
      ? incomingProvider
      : (currentState.authoritativeSettings?.providerId ?? appStore.state.model.defaultProviderId);
  const providerChanged = typeof incomingProvider === 'string';
  if (![...byPath.keys()].some((path) => path.startsWith('quickActions.'))) {
    appStore.dispatch(
      hydrateBackgroundAgentSettings({
        ...currentState,
        revision,
        changedFields: [],
        providerId,
        providerChanged,
      }),
    );
    return;
  }
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
      backgroundSettingsHydrationRequested({
        defaultModel,
        typeOverrides: overrides,
        revision,
        changedFields: (
          [
            'defaultModel',
            'typeOverrides',
            'defaultReasoningEffort',
            'typeReasoningEffortOverrides',
            'providerSettings',
          ] as const
        ).filter((field) => byPath.has(`quickActions.${field}`)),
        providerId,
        providerChanged,
        defaultReasoningEffort: byPath.has('quickActions.defaultReasoningEffort')
          ? ((byPath.get('quickActions.defaultReasoningEffort') as string | null) ?? '')
          : currentState.defaultReasoningEffort,
        typeReasoningEffortOverrides: byPath.has('quickActions.typeReasoningEffortOverrides')
          ? ((byPath.get(
              'quickActions.typeReasoningEffortOverrides',
            ) as BackgroundAgentSettingsState['typeReasoningEffortOverrides']) ?? {})
          : currentState.typeReasoningEffortOverrides,
        providerSettings: byPath.has('quickActions.providerSettings')
          ? ((byPath.get(
              'quickActions.providerSettings',
            ) as BackgroundAgentSettingsState['providerSettings']) ?? {})
          : currentState.providerSettings,
      }),
    );
  }
}

/**
 * Apply an applied-change list (boot snapshot or `settings:changed` delta) into
 * the relevant Redux slices and emit the typed `settingsChanged` trigger so
 * panels with bespoke wiring can react. Unknown paths are silently skipped
 * (the FE intentionally tolerates BE-side schema additions).
 */
export function applySettingsChanges(
  changes: readonly AppliedSettingChange[],
  revision?: number,
): void {
  if (changes.length === 0) return;
  const bundle = new Map<string, unknown>();
  let hasBackgroundAgentPaths = false;
  for (const change of changes) {
    applyOne(change, revision);
    bundle.set(change.path, change.value);
    if (change.path.startsWith('quickActions.') || change.path === 'model.defaultProvider') {
      hasBackgroundAgentPaths = true;
    }
  }
  // Provider-only deltas must also reconcile the bundle's authoritative identity.
  if (hasBackgroundAgentPaths) {
    applyBackgroundAgentBundle(bundle, revision);
  }
  appStore.dispatch(settingsChanged([...changes]));
}
