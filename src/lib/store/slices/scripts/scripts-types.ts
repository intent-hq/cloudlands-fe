/**
 * Scripts slice types — safe to import from any process.
 */

import type { ScriptWithState } from '$features/scripts/types';

// Re-export types that consumers need
export type { WorkspaceScript, ScriptRuntimeState, ScriptWithState } from '$features/scripts/types';

/**
 * Output line type for display.
 */
export type ScriptOutputLine = {
  text: string;
  stream: 'stdout' | 'stderr';
  timestamp: string;
};

/**
 * Per-workspace scripts state.
 */
export type ScriptsWorkspaceState = {
  /** Script definitions with runtime state keyed by script ID */
  scripts: Record<string, ScriptWithState>;
  /** Output buffers keyed by script ID */
  outputBuffers: Record<string, ScriptOutputLine[]>;
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
