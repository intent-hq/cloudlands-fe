/**
 * Scripts slice types — safe to import from any process.
 */

import type { ScriptWithState } from '$features/scripts/types';

// Re-export types that consumers need
export type { WorkspaceScript, ScriptRuntimeState, ScriptWithState } from '$features/scripts/types';

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

/**
 * Per-workspace scripts state.
 */
export type ScriptsWorkspaceState = {
  /** Script definitions with runtime state keyed by script ID */
  scripts: Record<string, ScriptWithState>;
  /** Raw-chunk output ring buffers keyed by script ID */
  outputBuffers: Record<string, ScriptOutputBuffer>;
  /** Whether the workspace scripts have been initialized */
  initialized: boolean;
  /** Whether scripts are currently loading */
  loading: boolean;
};

/**
 * Top-level scripts slice state (workspace-scoped).
 */
export type ScriptsState = {
  byWorkspaceId: Record<string, ScriptsWorkspaceState>;
};

// IPC event payload types
export type ScriptStartedEvent = {
  workspaceId: string;
  scriptId: string;
  pid?: number;
  startedAt: string;
};

export type ScriptStoppedEvent = {
  workspaceId: string;
  scriptId: string;
  exitCode: number | null;
  signal?: string | null;
  stoppedAt: string;
};

export type ScriptOutputEvent = {
  workspaceId: string;
  scriptId: string;
  lines: Array<{ text: string; stream: 'stdout' | 'stderr'; timestamp: string }>;
};

export type ScriptErrorEvent = {
  workspaceId: string;
  scriptId: string;
  error: string;
};

export type ScriptUrlDetectedEvent = {
  workspaceId: string;
  scriptId: string;
  url: string;
};
