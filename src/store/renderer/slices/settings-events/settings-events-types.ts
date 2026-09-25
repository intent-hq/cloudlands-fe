import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';

/** Only non-secret, JSON-shaped presentation data may enter form outcomes. */
export type SettingsFormValue = string | number | boolean | null | string[];

export interface SettingsFormIdentity {
  formId: string;
  sessionId: string;
}

export interface SettingsFormRequest extends SettingsFormIdentity {
  requestId: string;
  resource: string;
}

export interface SettingsFormEntry {
  path: string;
  value: SettingsFormValue;
  defaultValue?: SettingsFormValue;
  min?: number;
  max?: number;
  tokenImpact?: string;
}

export interface SettingsFormOperation {
  resource: string;
  requestId: string;
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
  error: string | null;
  submittedDrafts?: Record<string, SettingsFormValue>;
  submittedValues?: Record<string, SettingsFormValue>;
}

export interface SettingsFormOutcome {
  status: Exclude<SettingsFormOperation['status'], 'pending'>;
  error?: string;
  entries?: SettingsFormEntry[];
  values?: Record<string, SettingsFormValue>;
}

export type SettingsFormKind =
  | 'agent-backend'
  | 'agent-features'
  | 'workspace-api'
  | 'git-workspace'
  | 'websocket-api'
  | 'rtk'
  | 'agent-rules';

export interface SettingsForm extends SettingsFormIdentity {
  kind: SettingsFormKind;
  entries: Collection<SettingsFormEntry, 'path'>;
  operations: Collection<SettingsFormOperation, 'resource'>;
  values: Record<string, SettingsFormValue>;
  drafts: Record<string, SettingsFormValue>;
  mutationVersion: number;
  readVersion: number;
  loaded: boolean;
}

export interface SettingsEventsState {
  forms: Collection<SettingsForm, 'formId'>;
}

export interface SettingsFormChange {
  path: string;
  value: SettingsFormValue;
}
