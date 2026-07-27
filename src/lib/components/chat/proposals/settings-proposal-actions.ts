import type { AppSettingApplyPlan, AppSettingDefinition } from '$shared/app-settings-schema';
import { findAppSettingDefinition } from '$shared/app-settings-schema';
import type { ProposalActionDetail, SettingsChangeProposal } from '$shared/types/proposal';
import { appClient } from '$lib/client';
import { store as appStore } from "$store/renderer/store";
import type { ThemePreference } from '$store/renderer/slices/theme/theme-types';
import { selectProposalAppliedState } from '$store/renderer/slices/settings-proposal-history/settings-proposal-history-selectors';
import type {
  SerializableSettingValue,
  SettingsProposalReverseChange,
} from '$store/renderer/slices/settings-proposal-history/settings-proposal-history-types';
import {
  applyProposalRequested,
  undoProposalRequested,
} from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-slice';
import {
  selectActiveThemePresetId,
  selectThemePreference,
} from '$store/renderer/slices/theme/theme-selectors';
import { selectSelectedModel } from '$store/renderer/slices/model/model-selectors';
import {
  selectActiveProviderId,
  selectEnabledProviders,
} from '$store/renderer/slices/provider-settings/provider-settings-selectors';
import { selectProviderInUseReasons } from '$store/renderer/slices/provider-settings/provider-in-use-selectors';
import {
  selectMcpDisabledServers,
  selectMcpEnabled,
} from '$store/renderer/slices/mcp-settings/mcp-settings-selectors';
import {
  selectAgentFontStyle,
  selectBetaUpdatesEnabled,
  selectCodeFontFamily,
  selectGroupByRepo,
  selectHasCompletedProviderSetup,
  selectLanguagePreference,
  selectNotificationEnabled,
  selectNotificationVolume,
  selectNoteFontStyle,
  selectShowArchived,
  selectSoundEnabled,
  selectSoundOnlyWhenUnfocused,
  selectSpellcheckEnabled,
} from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import {
  selectBgDefaultModel,
  selectBgTypeOverrides,
} from '$store/renderer/slices/background-agent-settings/background-agent-settings-selectors';
import {
  selectDiffIndicators,
  selectDiffSideBySide,
  selectFoldUnchanged,
  selectIsCollapsed,
  selectLineWrapping,
  selectSidebarSide,
  selectSpacesSidebarCollapsed,
  selectSpacesSidebarWidth,
  selectTabbedSidebarPinned,
} from '$store/renderer/slices/ui-layout/ui-layout-selectors';
import {
  selectHiddenEditorIds,
  selectOpenAction,
} from '$store/renderer/slices/external-editors/external-editors-selectors';
import {
  requestThemePreferenceChange,
  selectThemePreset,
} from '$store/renderer/slices/theme/theme-slice';
import { selectModel } from '$store/renderer/slices/model/model-slice';
import {
  setActiveProvider,
  setProviderEnabled,
} from '$store/renderer/slices/provider-settings/provider-settings-slice';
import { setEnabled, setDisabledServers } from '$store/renderer/slices/mcp-settings/mcp-settings-slice';
import {
  setAgentFontStyle,
  setBetaUpdatesEnabled,
  setCodeFontFamily,
  setGroupByRepo,
  setHasCompletedProviderSetup,
  setLanguagePreference,
  setNotificationEnabled,
  setNoteFontStyle,
  setShowArchived,
  setSoundEnabled,
  setSoundOnlyWhenUnfocused,
  setSpellcheckEnabled,
  setVolume,
  type FontStyle,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { autoUpdateClient } from '$features/auto-update/auto-update.client';
import {
  setDefaultModel,
  setTypeOverride,
  type BackgroundAgentType,
} from '$store/renderer/slices/background-agent-settings/background-agent-settings-slice';
import {
  setCollapsed,
  setDiffIndicators,
  setDiffSideBySide,
  setFoldUnchanged,
  setLineWrapping,
  setSidebarSide,
  setSpacesSidebarCollapsed,
  setSpacesSidebarWidth,
  setTabbedSidebarPinned,
  type SidebarSide,
} from '$store/renderer/slices/ui-layout/ui-layout-slice';
import {
  setHiddenEditorIds,
  setOpenAction,
} from '$store/renderer/slices/external-editors/external-editors-slice';
import { getProposalId } from './proposal-id';

type SettingsChangePayload = { path: string; value: unknown; apply?: AppSettingApplyPlan };

type PreparedSettingsChange = SettingsChangePayload & {
  rollback: SettingsProposalReverseChange | null;
};

function getPayload(proposal: SettingsChangeProposal): { changes: SettingsChangePayload[] } {
  return proposal.payload;
}

function parseEditedValue(detail: ProposalActionDetail, change: SettingsChangePayload): unknown {
  const edited = detail.editedFields[change.path];
  if (edited === undefined) return change.value;
  const definition = findAppSettingDefinition(change.path);
  if (definition?.nullable === true && edited === '') return null;
  if (!definition || definition.type === 'string' || definition.type === 'enum') return edited;
  if (definition.type === 'boolean') return edited === true || edited === 'true';
  if (definition.type === 'number') {
    const parsed = Number(edited);
    return Number.isFinite(parsed) ? parsed : change.value;
  }
  try {
    return JSON.parse(String(edited));
  } catch {
    return change.value;
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function deepGet(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function parseLocalStorageValue(
  raw: string | null | undefined,
  definition: AppSettingDefinition,
): unknown {
  if (raw === null || raw === undefined) return undefined;
  if (definition.type === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  }
  if (definition.type === 'number') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (definition.valuePath || ['object', 'array', 'status', 'readonly'].includes(definition.type)) {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return raw;
}

function toSerializableSettingValue(value: unknown): SerializableSettingValue {
  if (value === undefined) return null;
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as SerializableSettingValue;
  } catch {
    return String(value);
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown settings error');
}

async function readDaemonSettingValue(definition: AppSettingDefinition): Promise<unknown> {
  if (!definition.storageKey) return definition.defaultValue;
  const entry = await appClient.settings.get(definition.storageKey);
  return deepGet(entry?.value, definition.valuePath) ?? definition.defaultValue;
}

function readLocalStorageValue(definition: AppSettingDefinition): unknown {
  if (typeof window === 'undefined' || !definition.storageKey) return definition.defaultValue;
  const parsed = parseLocalStorageValue(
    window.localStorage.getItem(definition.storageKey),
    definition,
  );
  return deepGet(parsed, definition.valuePath) ?? definition.defaultValue;
}

async function writeDaemonSetting(
  path: string,
  valuePath: string | undefined,
  value: unknown,
): Promise<void> {
  if (!valuePath) {
    await appClient.settings.update([{ path, value }]);
    return;
  }
  const entry = await appClient.settings.get(path);
  const current = objectValue(entry?.value);
  const merged: Record<string, unknown> = { ...current, [valuePath]: value };
  await appClient.settings.update([{ path, value: merged }]);
}

function writeLocalStorageValue(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  if (value === null || value === undefined) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

async function readCurrentSettingValue(definition: AppSettingDefinition): Promise<unknown> {
  const state = appStore.state;
  switch (definition.path) {
    case 'preferences.betaUpdatesEnabled':
      return selectBetaUpdatesEnabled.select(state);
    case 'preferences.spellcheckEnabled':
      return selectSpellcheckEnabled.select(state);
    case 'workspaceList.showArchived':
      return selectShowArchived.select(state);
    case 'workspaceList.groupByRepo':
      return selectGroupByRepo.select(state);
    case 'providers.completedSetup':
      return selectHasCompletedProviderSetup.select(state);
    case 'preferences.language':
      return selectLanguagePreference.select(state);
    case 'theme.preference':
      return selectThemePreference.select(state);
    case 'theme.activePresetId':
      return selectActiveThemePresetId.select(state);
    case 'model.default':
      return selectSelectedModel.select(state);
    case 'providers.active':
      return selectActiveProviderId.select(state);
    case 'providers.enabled':
      return selectEnabledProviders.select(state);
    case 'notifications.enabled':
      return selectNotificationEnabled.select(state);
    case 'notifications.soundEnabled':
      return selectSoundEnabled.select(state);
    case 'notifications.soundOnlyWhenUnfocused':
      return selectSoundOnlyWhenUnfocused.select(state);
    case 'notifications.volume':
      return selectNotificationVolume.select(state);
    case 'backgroundAgents.defaultModel':
      return selectBgDefaultModel.select(state);
    case 'backgroundAgents.typeOverrides':
      return selectBgTypeOverrides.select(state);
    case 'fonts.agent':
      return selectAgentFontStyle.select(state);
    case 'fonts.notes':
      return selectNoteFontStyle.select(state);
    case 'fonts.code':
      return selectCodeFontFamily.select(state);
    case 'ui.editor':
      return {
        lineWrapping: selectLineWrapping.select(state),
        foldUnchanged: selectFoldUnchanged.select(state),
        diffSideBySide: selectDiffSideBySide.select(state),
        diffIndicators: selectDiffIndicators.select(state),
      };
    case 'ui.layout':
      return {
        spacesSidebarWidth: selectSpacesSidebarWidth.select(state),
        spacesSidebarCollapsed: selectSpacesSidebarCollapsed.select(state),
        tabbedSidebarPinned: selectTabbedSidebarPinned.select(state),
        sidebarSide: selectSidebarSide.select(state),
      };
    case 'ui.workspaceLeftPanel.collapsed':
      return selectIsCollapsed.select(state);
    case 'openIn.defaultAction':
      return selectOpenAction.select(state);
    case 'openIn.hiddenEditors':
      return selectHiddenEditorIds.select(state);
    case 'mcp.enableUserServers':
      return selectMcpEnabled.select(state);
    case 'mcp.disabledServers':
      return Object.keys(selectMcpDisabledServers.select(state));
    default:
      if (definition.source === 'daemon-settings') return readDaemonSettingValue(definition);
      if (definition.source === 'local-storage') return readLocalStorageValue(definition);
      return definition.defaultValue;
  }
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

function isFontStyle(value: unknown): value is FontStyle {
  return value === 'sans' || value === 'monospace';
}

function dispatchReduxAction(path: string, value: unknown): boolean {
  switch (path) {
    case 'preferences.betaUpdatesEnabled': {
      const enabled = Boolean(value);
      appStore.dispatch(setBetaUpdatesEnabled(enabled));
      // Also call SET_CHANNEL IPC to persist and switch feed immediately
      autoUpdateClient.setChannel(enabled ? 'beta' : 'stable').catch((error) => {
        console.error('Failed to set update channel via IPC', error);
      });
      return true;
    }
    case 'preferences.spellcheckEnabled':
      appStore.dispatch(setSpellcheckEnabled(Boolean(value)));
      return true;
    case 'workspaceList.showArchived':
      appStore.dispatch(setShowArchived(Boolean(value)));
      return true;
    case 'workspaceList.groupByRepo':
      appStore.dispatch(setGroupByRepo(Boolean(value)));
      return true;
    case 'providers.completedSetup':
      appStore.dispatch(setHasCompletedProviderSetup(Boolean(value)));
      return true;
    case 'preferences.language':
      appStore.dispatch(setLanguagePreference(String(value ?? '')));
      return true;
    case 'theme.preference':
      if (!isThemePreference(value)) return false;
      appStore.dispatch(requestThemePreferenceChange(value));
      return true;
    case 'theme.activePresetId':
      if (value !== null) {
        appStore.dispatch(selectThemePreset(String(value)));
      }
      return true;
    case 'model.default':
      appStore.dispatch(selectModel(String(value ?? '')));
      return true;
    case 'providers.active':
      appStore.dispatch(setActiveProvider(String(value ?? '')));
      return true;
    case 'providers.enabled': {
      // Same in-use guard as the Settings UI: agent-driven proposals must not
      // disable a provider pinned by the default model or a specialist,
      // recreating the stale-provider state the UI guard prevents.
      const inUseReasons = selectProviderInUseReasons.select(appStore.state);
      for (const [providerId, enabled] of Object.entries(objectValue(value))) {
        if (!enabled && inUseReasons[providerId]) continue;
        appStore.dispatch(setProviderEnabled({ providerId, enabled: Boolean(enabled) }));
      }
      return true;
    }
    case 'notifications.enabled':
      appStore.dispatch(setNotificationEnabled(Boolean(value)));
      return true;
    case 'notifications.soundEnabled':
      appStore.dispatch(setSoundEnabled(Boolean(value)));
      return true;
    case 'notifications.soundOnlyWhenUnfocused':
      appStore.dispatch(setSoundOnlyWhenUnfocused(Boolean(value)));
      return true;
    case 'notifications.volume': {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return false;
      appStore.dispatch(setVolume(parsed));
      return true;
    }
    case 'backgroundAgents.defaultModel':
      appStore.dispatch(setDefaultModel(String(value ?? '')));
      return true;
    case 'backgroundAgents.typeOverrides':
      for (const [type, model] of Object.entries(objectValue(value))) {
        appStore.dispatch(
          setTypeOverride({ type: type as BackgroundAgentType, model: String(model ?? '') }),
        );
      }
      return true;
    case 'fonts.agent':
      if (!isFontStyle(value)) return false;
      appStore.dispatch(setAgentFontStyle(value));
      return true;
    case 'fonts.notes':
      if (!isFontStyle(value)) return false;
      appStore.dispatch(setNoteFontStyle(value));
      return true;
    case 'fonts.code':
      appStore.dispatch(setCodeFontFamily(String(value ?? '')));
      return true;
    case 'ui.editor': {
      const settings = objectValue(value);
      if ('lineWrapping' in settings)
        appStore.dispatch(setLineWrapping(Boolean(settings.lineWrapping)));
      if ('foldUnchanged' in settings)
        appStore.dispatch(setFoldUnchanged(Boolean(settings.foldUnchanged)));
      if ('diffSideBySide' in settings)
        appStore.dispatch(setDiffSideBySide(Boolean(settings.diffSideBySide)));
      if ('diffIndicators' in settings)
        appStore.dispatch(setDiffIndicators(Boolean(settings.diffIndicators)));
      return true;
    }
    case 'ui.layout': {
      const settings = objectValue(value);
      if (
        typeof settings.spacesSidebarWidth === 'number' &&
        Number.isFinite(settings.spacesSidebarWidth)
      )
        appStore.dispatch(setSpacesSidebarWidth(settings.spacesSidebarWidth));
      if ('spacesSidebarCollapsed' in settings)
        appStore.dispatch(setSpacesSidebarCollapsed(Boolean(settings.spacesSidebarCollapsed)));
      if ('tabbedSidebarPinned' in settings)
        appStore.dispatch(setTabbedSidebarPinned(Boolean(settings.tabbedSidebarPinned)));
      if (settings.sidebarSide === 'left' || settings.sidebarSide === 'right')
        appStore.dispatch(setSidebarSide(settings.sidebarSide as SidebarSide));
      return true;
    }
    case 'ui.workspaceLeftPanel.collapsed':
      appStore.dispatch(setCollapsed(Boolean(value)));
      return true;
    case 'openIn.defaultAction':
      appStore.dispatch(setOpenAction(String(value ?? '')));
      return true;
    default:
      return false;
  }
}

async function applyPersistedSetting(
  path: string,
  value: unknown,
  apply: AppSettingApplyPlan | undefined,
): Promise<void> {
  if (!apply || apply.kind === 'read-only') return;
  if (dispatchReduxAction(path, value)) return;
  if (apply.kind === 'daemon-settings-update') {
    await writeDaemonSetting(apply.path, apply.valuePath, value);
    if (path === 'mcp.enableUserServers') appStore.dispatch(setEnabled(Boolean(value)));
    if (path === 'mcp.disabledServers' && Array.isArray(value)) {
      appStore.dispatch(
        setDisabledServers(Object.fromEntries(value.map((name) => [String(name), true]))),
      );
    }
    return;
  }
  if (apply.kind === 'local-storage-set') {
    writeLocalStorageValue(apply.key, value);
    if (path === 'openIn.hiddenEditors' && Array.isArray(value)) {
      appStore.dispatch(setHiddenEditorIds(value.map(String)));
    }
  }
}

async function prepareSettingsChange(
  change: SettingsChangePayload,
): Promise<PreparedSettingsChange> {
  const definition = findAppSettingDefinition(change.path);
  if (!definition) return { ...change, rollback: null };
  const apply = change.apply ?? definition.apply;
  const currentValue = await readCurrentSettingValue(definition);
  return {
    ...change,
    apply,
    rollback: {
      path: change.path,
      value: toSerializableSettingValue(currentValue),
      apply,
    },
  };
}

async function rollbackSettingsChanges(applied: PreparedSettingsChange[]): Promise<string[]> {
  const failures: string[] = [];
  for (const change of [...applied].reverse()) {
    if (!change.rollback) continue;
    try {
      await applyPersistedSetting(
        change.rollback.path,
        change.rollback.value,
        change.rollback.apply,
      );
    } catch (error) {
      failures.push(`${change.rollback.path}: ${getErrorMessage(error)}`);
    }
  }
  return failures;
}

async function applySettingsTransaction(
  changes: SettingsChangePayload[],
  failurePrefix: string,
): Promise<SettingsProposalReverseChange[]> {
  const prepared: PreparedSettingsChange[] = [];
  for (const change of changes) {
    prepared.push(await prepareSettingsChange(change));
  }

  const applied: PreparedSettingsChange[] = [];
  try {
    for (const change of prepared) {
      await applyPersistedSetting(change.path, change.value, change.apply);
      applied.push(change);
    }
  } catch (error) {
    const rollbackFailures = await rollbackSettingsChanges(applied);
    const message = `${failurePrefix}: ${getErrorMessage(error)}`;
    if (rollbackFailures.length > 0) {
      throw new Error(`${message}; rollback failed for ${rollbackFailures.join(', ')}`);
    }
    throw new Error(message);
  }

  return prepared
    .map((change) => change.rollback)
    .filter((change): change is SettingsProposalReverseChange => change !== null);
}

export function applySettingsProposal(detail: ProposalActionDetail): boolean {
  if (detail.proposal.kind !== 'settings-change') return false;
  const proposalId = getProposalId(detail.proposal);
  appStore.dispatch(applyProposalRequested({ proposalId, kind: 'settings-change', detail }));
  return true;
}

export async function applySettingsProposalWork(
  detail: ProposalActionDetail,
): Promise<{ reverseChanges: SettingsProposalReverseChange[] }> {
  if (detail.proposal.kind !== 'settings-change') {
    throw new Error('applySettingsProposalWork requires a settings-change proposal');
  }
  const changes = getPayload(detail.proposal).changes;
  const reverseChanges = await applySettingsTransaction(
    changes.map((change) => ({
      ...change,
      value: parseEditedValue(detail, change),
    })),
    'Failed to apply settings change',
  );
  return {
    reverseChanges,
  };
}

export async function undoSettingsProposalChanges(
  reverseChanges: SettingsProposalReverseChange[],
): Promise<void> {
  await applySettingsTransaction(reverseChanges, 'Failed to undo settings change');
}

export async function undoSettingsProposalWork(
  reverseChanges: SettingsProposalReverseChange[],
): Promise<void> {
  await undoSettingsProposalChanges(reverseChanges);
}

export function undoSettingsProposal(proposalId: string): boolean {
  const store = appStore;
  const appliedState = selectProposalAppliedState.select(appStore.state, proposalId);
  if (!appliedState) return false;
  store.dispatch(undoProposalRequested({ proposalId, kind: 'settings-change' }));
  return true;
}
