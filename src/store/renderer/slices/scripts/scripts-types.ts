/**
 * Scripts slice types — safe to import from any process.
 */

import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { ScriptReadChange } from '$features/scripts/utils/script-change';
import type {
  ScriptMode,
  ScriptPurpose,
  WorkspaceScript,
  ScriptListEntry,
} from '$features/scripts/types';

// Re-export types that consumers need
export type {
  WorkspaceScript,
  ScriptRuntimeState,
  ScriptWithState,
  ScriptListEntry,
} from '$features/scripts/types';

/**
 * One decoded `script:output` chunk (PROTOCOL §6.5). `text` is the UTF-8
 * decoding of the raw PTY bytes, stored verbatim — never line-split — so
 * xterm can replay the exact byte stream (spinner `\r` redraws, ANSI
 * sequences split across chunk boundaries, the daemon's in-band
 * `--- Restarting … ---` separators).
 */
export type ScriptOutputChunk = {
  text: string;
  timestamp: string;
};

/**
 * Bounded ring buffer of raw output chunks for one script. `dropped` counts
 * chunks evicted from the front so viewers can track their position in the
 * stream across evictions.
 */
export type ScriptOutputBuffer = {
  chunks: ScriptOutputChunk[];
  dropped: number;
};

/** A viewer-owned formatted poll result, never part of the raw PTY stream. */
type ScriptRetainedOutput = {
  scriptId: string;
  status: 'loading' | 'available' | 'unavailable';
  text?: string;
};

export type ScriptQuickAction = 'start' | 'stop' | 'restart' | 'delete' | 'edit';

export type ScriptDefinitionInput = {
  purpose?: ScriptPurpose;
  name: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  mode: ScriptMode;
  category?: string;
  source?: string;
  autoStart?: boolean;
  healthUrl?: string;
  readyPattern?: string;
};

export type ScriptDefinitionUpdate = Partial<
  Pick<
    ScriptDefinitionInput,
    | 'name'
    | 'command'
    | 'cwd'
    | 'env'
    | 'mode'
    | 'category'
    | 'autoStart'
    | 'healthUrl'
    | 'readyPattern'
  >
>;

export type ScriptDefinitionChanges = {
  add: ScriptDefinitionInput[];
  update: Array<{ id: string; updates: ScriptDefinitionUpdate }>;
  remove: string[];
};

export type ScriptDetectionOutcome = {
  detected: number;
  added: number;
  updated: number;
  removed: number;
  skippedRunning: string[];
  packageManager?: 'npm' | 'yarn' | 'pnpm';
};

export type ScriptDefinitionChangesOutcome = ScriptDetectionOutcome & {
  /** Full pre-change inventory captured by the saga for Undo. */
  snapshot: ScriptDefinitionSnapshot;
};

export type ScriptAgentDetectionOutcome =
  | { source: 'agent'; presentation: 'changes' | 'legacy'; changes: ScriptDefinitionChangesOutcome }
  | {
      source: 'local';
      detection: ScriptDetectionOutcome;
      fallbackReason: 'agent-failed' | 'unexpected-format' | 'apply-failed';
    };

export type ScriptRemovalTarget = Pick<
  WorkspaceScript,
  'id' | 'workspaceId' | 'source' | 'updatedAt' | 'archivedAt'
>;

export type ScriptBulkRemovalOutcome = {
  removed: string[];
  failed: Array<{ scriptId: string; error: string }>;
};

/** Mount-scoped identity for a serializable script UI workflow. */
export interface ScriptWorkflowConsumer {
  consumerId: string;
  requestId: string;
  resourceId: string;
}

export type ScriptWorkflowResult =
  | WorkspaceScript
  | ScriptListEntry
  | ScriptListEntry[]
  | ScriptBulkRemovalOutcome
  | ScriptDetectionOutcome
  | ScriptDefinitionChangesOutcome
  | ScriptAgentDetectionOutcome;

export interface ScriptWorkflowOutcome extends ScriptWorkflowConsumer {
  id: string;
  workspaceId: string;
  status: 'pending' | 'success' | 'failure' | 'cancelled';
  result?: ScriptWorkflowResult;
  error?: string;
  consumed?: true;
}

export type ScriptDefinitionSnapshot = WorkspaceScript[];

export type ScriptOperationState = {
  action: ScriptQuickAction;
  pending: boolean;
  error?: string;
  reservationId?: string;
};

/**
 * Per-workspace scripts state.
 */
export type ScriptsWorkspaceState = {
  /** Script definitions with runtime state keyed by script ID */
  scripts: Record<string, ScriptListEntry>;
  /** Event journals exist only while an authoritative list read is pending. */
  pendingReads?: Record<string, Collection<ScriptReadChange & { sequence: string }, 'sequence'>>;
  /** Raw-chunk output ring buffers keyed by script ID */
  outputBuffers: Record<string, ScriptOutputBuffer>;
  retainedOutputs?: Record<string, ScriptRetainedOutput>;
  /** Transient Shell controls state keyed by script ID. */
  operations: Record<string, ScriptOperationState>;
  /** Detection owns every definition, including rows not yet loaded into the cache. */
  detectionOperation?: ScriptOperationState;
  /** Whether the workspace scripts have been initialized */
  initialized: boolean;
  /** Whether scripts are currently loading */
  loading: boolean;
  lifecycleSupported?: boolean;
  activeScriptIds?: string[];
  loadError?: string;
  nextCursor?: string;
  /** Mount-scoped, serializable results for UI consumers. */
  workflowOutcomes?: Collection<ScriptWorkflowOutcome, 'id'>;
};

/**
 * Top-level scripts slice state (workspace-scoped).
 */
export type ScriptsState = {
  byWorkspaceId: Record<string, ScriptsWorkspaceState>;
};
