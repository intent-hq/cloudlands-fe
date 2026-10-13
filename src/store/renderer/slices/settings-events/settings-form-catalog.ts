import type { SettingDefinitionWithValue } from '$lib/client/app-client';
import { FEATURE_PATHS } from '$lib/components/settings/agent-feature-definitions';
import type {
  SettingsFormEntry,
  SettingsFormKind,
  SettingsFormValue,
} from './settings-events-types';

export const settingsFormPaths = {
  'collaboration-machine-name': ['sharing.machineName'],
  'agent-backend': [
    'agents.maxConcurrent',
    'agents.memoryBudgetMb',
    'agents.idleReapMinutes',
    'agents.acpNodeMaxOldSpaceMb',
  ],
  'agent-features': [...FEATURE_PATHS, 'prMonitor.debounceSeconds', 'agents.maxTopLevelAgents'],
  'workspace-api': [
    'workspaceApi.maxOutputChars',
    'workspaceApi.toonOutput',
    'agents.historyReplayToolContentChars',
    'agents.toolPayloadRetentionDays',
  ],
  'git-workspace': [
    'workspace.worktreesLocation',
    'workspace.sshKeyPath',
    'workspace.defaultShell',
    'git.autoCommit',
    'workspace.cowIsolation',
    'workspace.branchPrefix',
    'sourceControl.github.exposeGitCredentialToChildren',
  ],
} satisfies Partial<Record<SettingsFormKind, string[]>>;

export function isSettingsFormValue(value: unknown): value is SettingsFormValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}

export function catalogEntry(entry: SettingDefinitionWithValue): SettingsFormEntry {
  if (!isSettingsFormValue(entry.value)) throw new Error('Unsupported settings value');
  return {
    path: entry.path,
    value: entry.value,
    ...(isSettingsFormValue(entry.defaultValue) ? { defaultValue: entry.defaultValue } : {}),
    ...(entry.min !== undefined ? { min: entry.min } : {}),
    ...(entry.max !== undefined ? { max: entry.max } : {}),
    ...(entry.tokenImpact !== undefined ? { tokenImpact: entry.tokenImpact } : {}),
  };
}
