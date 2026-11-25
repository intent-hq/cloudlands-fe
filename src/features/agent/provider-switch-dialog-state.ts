/**
 * Transient view state for the "Switch all…" dialog opened from a grouped
 * failure toast. The failure toast saga owns and writes it; the dialog host
 * in the app layout renders it and calls back through `actions`. Never
 * Redux, gone on reload.
 */
import { writable } from 'svelte/store';
import type { BulkAgentStatus, BulkSwitchTarget } from './bulk-provider-switch';
import type { GroupedFailureKind } from './agent-failure-groups';

interface ProviderSwitchModelOption {
  value: string;
  label: string;
}

export interface ProviderSwitchTargetOption {
  providerId: string;
  label: string;
  models: ProviderSwitchModelOption[];
}

export interface ProviderSwitchDialogAgent {
  agentId: string;
  name: string;
  workspaceName?: string;
  /** Targets eligible in this agent's workspace context. */
  eligibleProviderIds: string[];
  outcome?: { status: BulkAgentStatus; reason?: string };
}

export interface ProviderSwitchDialogRow {
  key: string;
  providerRef: string;
  model: string | null;
  /** "Claude Code · Opus 5.5". */
  label: string;
  agents: ProviderSwitchDialogAgent[];
  workerCount: number;
  /** Union of the row agents' eligible targets. */
  targets: ProviderSwitchTargetOption[];
  selection: BulkSwitchTarget | null;
  workersSwitched?: number;
}

interface ProviderSwitchDialogActions {
  select(rowKey: string, target: BulkSwitchTarget): void;
  confirm(): void;
  retryAll(): void;
  close(): void;
}

export interface ProviderSwitchDialogState {
  open: boolean;
  groupKey: string | null;
  kind: GroupedFailureKind | null;
  providerLabel: string;
  loading: boolean;
  running: boolean;
  /** True once a switch or retry ran in this dialog session. */
  finished: boolean;
  progress: { done: number; total: number };
  rows: ProviderSwitchDialogRow[];
  actions: ProviderSwitchDialogActions | null;
}

export const closedProviderSwitchDialog: ProviderSwitchDialogState = {
  open: false,
  groupKey: null,
  kind: null,
  providerLabel: '',
  loading: false,
  running: false,
  finished: false,
  progress: { done: 0, total: 0 },
  rows: [],
  actions: null,
};

export const providerSwitchDialog = writable<ProviderSwitchDialogState>(closedProviderSwitchDialog);
