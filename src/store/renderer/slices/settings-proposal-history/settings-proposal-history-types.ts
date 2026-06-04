import type { AppSettingApplyPlan } from '$shared/app-settings-schema';

export type SerializableSettingValue =
  | string
  | number
  | boolean
  | null
  | SerializableSettingValue[]
  | { [key: string]: SerializableSettingValue };

export interface SettingsProposalReverseChange {
  path: string;
  value: SerializableSettingValue;
  apply: AppSettingApplyPlan;
}

export interface SettingsProposalHistoryEntry {
  appliedAt: number;
  reverseChanges: SettingsProposalReverseChange[];
}

export interface SettingsProposalHistoryState {
  entries: Record<string, SettingsProposalHistoryEntry>;
}
