/**
 * Workspace Script Types
 *
 * Types for workspace scripts — named processes with lifecycle management.
 * Scripts can be long-running services (dev servers) or one-shot commands (test suites).
 */

import type { WorkspaceId } from '../../shared/types/branded-ids';

/**
 * Script execution mode.
 * - `service`: Long-running, auto-restartable (dev server, file watcher)
 * - `command`: Run-once, exits with result (test suite, build, lint)
 */
export type ScriptMode = 'service' | 'command';

/**
 * Script category for grouping in the UI.
 */
export type ScriptCategory =
  | 'dev'
  | 'build'
  | 'test'
  | 'lint'
  | 'typecheck'
  | 'format'
  | 'storybook'
  | 'other';

/**
 * How the script was created.
 * - `auto-detected`: Discovered from package.json or similar
 * - `user`: Manually created by user or agent
 */
export type ScriptSource = 'auto-detected' | 'user';

/**
 * Runtime status of a script process.
 */
export type ScriptStatus = 'idle' | 'running' | 'restarting' | 'exited';

/**
 * A workspace script definition — persisted to .workspace/scripts.json.
 */
export interface WorkspaceScript {
  id: string;
  workspaceId: string;
  name: string;
  command: string;
  cwd?: string; // Relative to workspace repo root
  env?: Record<string, string>;
  mode: ScriptMode;
  category?: ScriptCategory;
  source: ScriptSource;
  autoStart?: boolean; // Start when workspace opens (services only)
  createdAt: string;
  updatedAt?: string;
  lastRunAt?: string;
}

/**
 * Runtime state of a script process — kept in memory, not persisted.
 */
export interface ScriptRuntimeState {
  status: ScriptStatus;
  pid?: number;
  exitCode?: number | null;
  startedAt?: string;
  stoppedAt?: string;
  restartCount: number;
  error?: string;
  detectedUrl?: string; // URL detected from stdout (for services)
  previouslyRunning?: boolean; // Service was running before the daemon shut down (PROTOCOL §5.8)
}

/**
 * Combined script definition + runtime state for the renderer.
 */
export interface ScriptWithState extends WorkspaceScript {
  runtime: ScriptRuntimeState;
}

/**
 * Persistence format for .workspace/scripts.json.
 * Includes a version field for forward compatibility.
 */
export interface ScriptsFileFormat {
  version: number;
  scripts: WorkspaceScript[];
}

/**
 * Default runtime state for a script that hasn't been started.
 */
export function createDefaultRuntimeState(): ScriptRuntimeState {
  return {
    status: 'idle',
    restartCount: 0,
  };
}

