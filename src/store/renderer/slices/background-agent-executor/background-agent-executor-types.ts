/**
 * Types for the background-agent-executor Redux slice.
 * Safe to import from any process (renderer, main, shared, preload).
 */

export type ExecutorStatus =
  'idle' | 'initializing' | 'running' | 'success' | 'error' | 'cancelled';

/**
 * Context data for different agent types
 */
export interface AgentExecutorContext {
  // For commit type
  files?: string[];
  changes?: string;

  // For PR type
  targetBranch?: string;
  baseBranch?: string;
  commits?: Array<{
    sha: string;
    message: string;
    author?: string;
    date?: string;
  }>;
  includeStagedFiles?: boolean;
  includeCommitHashes?: string[];

  // For review type
  reviewFiles?: Array<{
    path: string;
    content?: string;
    diff?: string;
  }>;

  // Generic context — constrained to JSON-serializable values
  [key: string]:
    | string
    | number
    | boolean
    | null
    | undefined
    | string[]
    | Record<string, string>
    | Array<Record<string, string | number | boolean | null | undefined>>;
}

/**
 * Per-executor-instance state stored in Redux
 */
export interface ExecutorInstanceState {
  status: ExecutorStatus;
  result: string | null;
  error: string | null;
  progress: number;
  agentId: string | null;
  workspaceId: string | null;
  executionContext: AgentExecutorContext | null;
}

export interface BackgroundAgentExecutorWorkspaceState {
  executors: Record<string, ExecutorInstanceState>;
}

export interface BackgroundAgentExecutorState {
  byWorkspaceId: Record<string, BackgroundAgentExecutorWorkspaceState>;
}

export const emptyExecutorState: ExecutorInstanceState = {
  status: 'idle',
  result: null,
  error: null,
  progress: 0,
  agentId: null,
  workspaceId: null,
  executionContext: null,
};

export const emptyWorkspaceState: BackgroundAgentExecutorWorkspaceState = {
  executors: {},
};

/** Default config for each executor type (keyed by string for flexibility) */
const COMMIT_MESSAGE_EXECUTOR_TIMEOUT_MS = 300_000;

// The commit, commit-merge, pr, and walkthrough executors use JSON output
// contracts (no `resultTag`); review keeps its tag contract.
export const EXECUTOR_CONFIGS: Record<
  string,
  { resultTag?: string; timeout: number; name: string; agentType: string }
> = {
  commit: {
    timeout: COMMIT_MESSAGE_EXECUTOR_TIMEOUT_MS,
    name: 'Commit Message Generator', // i18n-ignore (internal background-agent session name)
    agentType: 'commit-message',
  },
  'commit-merge': {
    timeout: COMMIT_MESSAGE_EXECUTOR_TIMEOUT_MS,
    name: 'Merge Commit Generator', // i18n-ignore (internal background-agent session name)
    agentType: 'commit-message',
  },
  pr: {
    timeout: 180000,
    name: 'PR Description Generator', // i18n-ignore (internal background-agent session name)
    agentType: 'pr-description',
  },
  review: {
    resultTag: 'CODE_REVIEW',
    timeout: 120000,
    name: 'Code Review Assistant', // i18n-ignore (internal background-agent session name)
    agentType: 'code-review',
  },
  walkthrough: {
    timeout: 120000,
    name: 'Code Walkthrough Generator', // i18n-ignore (internal background-agent session name)
    agentType: 'code-walkthrough',
  },
};

/** Maximum diff size per file in characters before skipping */
export const MAX_DIFF_SIZE_PER_FILE = 50_000;

/** Maximum total diff size in characters */
export const MAX_TOTAL_DIFF_SIZE = 200_000;
