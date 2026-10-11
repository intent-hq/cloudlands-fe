import type { AppliedSettingChange } from '$lib/client/settings-types';
import type { GenericAction } from '@themislib/themis/types';
import { settingsChanged } from '../../store/renderer/slices/settings-events/settings-events-slice';
import {
  hydrateProviderFastMode,
  loadEnabledProvidersFromStorage,
} from '../../store/renderer/slices/provider-settings/provider-settings-slice';
import {
  hydrateSettings as hydrateBackgroundAgentSettings,
  backgroundSettingsHydrationRequested,
  type BackgroundAgentType,
  type BackgroundAgentSettingsState,
} from '../../store/renderer/slices/background-agent-settings/background-agent-settings-slice';
import {
  hydrateDefaultProvider,
  loadProviderModelsFromStorage,
  loadDefaultReasoningEffortFromStorage,
} from '../../store/renderer/slices/model/model-slice';

/** Canonical model/provider/Quick Action receipt application, shared by renderers. */
export function createSettingsHydrator({
  dispatch,
  getState,
  applyOther,
}: {
  dispatch: (action: GenericAction) => unknown;
  getState: () => {
    backgroundAgentSettings: BackgroundAgentSettingsState;
    model: { defaultProviderId: string };
  };
  applyOther?: (change: AppliedSettingChange, revision?: number) => void;
}) {
  /** Apply a single applied-change to the slice that owns its dotted path. */
  function applyOne(change: AppliedSettingChange, revision?: number): void {
    const { path, value } = change;
    switch (path) {
      case 'model.defaultProvider': {
        if (typeof value === 'string') dispatch(hydrateDefaultProvider(value));
        else if (value === null) dispatch(hydrateDefaultProvider(''));
        return;
      }
      case 'model.providerDefaults': {
        if (value && typeof value === 'object' && !Array.isArray(value))
          dispatch(loadProviderModelsFromStorage(value as Record<string, string>));
        return;
      }
      case 'providers.fastMode': {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const entries = Object.entries(value).filter(
            ([id, enabled]) =>
              ['claude-code', 'codex'].includes(id) && typeof enabled === 'boolean',
          );
          dispatch(hydrateProviderFastMode(Object.fromEntries(entries), revision));
        }
        return;
      }
      case 'providers.enabled': {
        if (value && typeof value === 'object') {
          dispatch(loadEnabledProvidersFromStorage(value as Record<string, boolean>));
        }
        return;
      }
      case 'model.defaultReasoningEffort': {
        if (typeof value === 'string') {
          dispatch(loadDefaultReasoningEffortFromStorage(value));
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
    const currentState = getState().backgroundAgentSettings;
    const incomingProvider = byPath.get('model.defaultProvider');
    const providerId =
      typeof incomingProvider === 'string'
        ? incomingProvider
        : (currentState.authoritativeSettings?.providerId ?? getState().model.defaultProviderId);
    const providerChanged = typeof incomingProvider === 'string';
    if (![...byPath.keys()].some((path) => path.startsWith('quickActions.'))) {
      dispatch(
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
      (byPath.get('quickActions.typeOverrides') as
        Record<BackgroundAgentType, string> | undefined) ?? currentState.typeOverrides;

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
      dispatch(
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
  function applySettingsChanges(changes: readonly AppliedSettingChange[], revision?: number): void {
    if (changes.length === 0) return;
    const bundle = new Map<string, unknown>();
    let hasBackgroundAgentPaths = false;
    for (const change of changes) {
      applyOne(change, revision);
      applyOther?.(change, revision);
      bundle.set(change.path, change.value);
      if (change.path.startsWith('quickActions.') || change.path === 'model.defaultProvider') {
        hasBackgroundAgentPaths = true;
      }
    }
    // Provider-only deltas must also reconcile the bundle's authoritative identity.
    if (hasBackgroundAgentPaths) {
      applyBackgroundAgentBundle(bundle, revision);
    }
    dispatch(settingsChanged([...changes]));
  }

  return applySettingsChanges;
}
