/**
 * View state for the "Switch all…" dialog opened from a grouped failure
 * toast. Transient UI state: the failure toast saga fills it, the dialog host
 * renders it, and nothing persists across reloads.
 */
import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { BulkAgentStatus, BulkSwitchTarget } from '$features/agent/bulk-provider-switch';
import type { GroupedFailureKind } from '$features/agent/agent-failure-groups';

interface ProviderSwitchModelOption {
  value: string;
  label: string;
}

export interface ProviderSwitchTargetOption {
  providerId: string;
  label: string;
  models: ProviderSwitchModelOption[];
}

export interface ProviderSwitchAgentOutcome {
  status: BulkAgentStatus;
  reason?: string;
}

export interface ProviderSwitchDialogAgent {
  agentId: string;
  name: string;
  workspaceName?: string;
  /** Targets eligible in this agent's workspace context. */
  eligibleProviderIds: string[];
  outcome?: ProviderSwitchAgentOutcome;
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
  /** Workspace whose provider catalog the target picker reads (absent: global). */
  pickerWorkspaceId?: string;
  selection: BulkSwitchTarget | null;
  workersSwitched?: number;
}

interface ProviderSwitchDialogFields {
  open: boolean;
  groupKey: string | null;
  kind: GroupedFailureKind | null;
  providerLabel: string;
  loading: boolean;
  running: boolean;
  /** True once a switch or retry ran in this dialog session. */
  finished: boolean;
  progress: { done: number; total: number };
}

export interface ProviderSwitchDialogSliceState extends ProviderSwitchDialogFields {
  rows: Collection<ProviderSwitchDialogRow, 'key'>;
  /** Run results by agent id; the selector merges them into the rows. */
  outcomes: Record<string, ProviderSwitchAgentOutcome>;
  /** Failed workers switched with each coordinator, by agent id. */
  workersSwitched: Record<string, number>;
}

/** What the dialog component renders (rows in display order). */
export interface ProviderSwitchDialogView extends ProviderSwitchDialogFields {
  rows: ProviderSwitchDialogRow[];
}
