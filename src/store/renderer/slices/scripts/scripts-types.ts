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
  /** Where the chunk's bytes sit in its run's log; absent for daemon notices and older daemons. */
  position?: ScriptOutputPosition;
  /** The positioned chunk's raw bytes (base64), so a join can decode across its edges. */
  data?: string;
};

/**
 * A half-open raw-byte range `[start, end)` in one run's output stream
 * (PROTOCOL §5.8 output cursors). Positions of different `(bootId, runId)`
 * streams are never compared.
 */
export type ScriptOutputPosition = {
  runId: string;
  bootId: string;
  start: number;
  end: number;
};

/** Where a positioned `script.output` snapshot sits in its run's stream. */
export type ScriptOutputCursor = {
  /** `null` when the script has no run yet. */
  runId: string | null;
  bootId: string;
  start: number;
  end: number;
  /** Position of the oldest byte the run's log keeps. */
  logStart: number;
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
export type ScriptRetainedOutput = {
  scriptId: string;
  status: 'loading' | 'available' | 'unavailable';
  text?: string;
  /**
   * Live stream position (`dropped` + chunk index) just before the read. The
   * daemon logs each chunk before it streams it, so every chunk before this
   * position is in the reply; later chunks may repeat its tail. Absent after a
   * failed read.
   */
  liveOffset?: number;
  /**
   * `outputStreamEpoch` of the unbroken live stream the read was joined to.
   * Absent when the read started before the stream was routable.
   */
  streamEpoch?: number;
  /** Present when the daemon answered with stream positions (`scriptOutputCursor: 1`). */
  cursor?: ScriptOutputCursor;
  /** The snapshot's raw log bytes (base64), for joining it by position. */
  data?: string;
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

export type ScriptDetectionOutcome = {
  detected: number;
  added: number;
  updated: number;
  removed: number;
  skippedRunning: string[];
  packageManager?: 'npm' | 'yarn' | 'pnpm';
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
  | ScriptDetectionOutcome;

export interface ScriptWorkflowOutcome extends ScriptWorkflowConsumer {
  id: string;
  workspaceId: string;
  status: 'pending' | 'success' | 'failure' | 'cancelled';
  result?: ScriptWorkflowResult;
  error?: string;
  consumed?: true;
}

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
  /**
   * Whether this workspace's live `script:output` lease is subscribed and
   * routable. Viewer snapshots wait for it so no output falls between the
   * snapshot and the live stream.
   */
  outputStreamReady?: boolean;
  /** Counts live stream interruptions: output between epochs was never streamed. */
  outputStreamEpoch?: number;
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
