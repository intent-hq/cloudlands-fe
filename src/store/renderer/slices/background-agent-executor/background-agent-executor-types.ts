/**
 * Types for the background-agent-executor Redux slice.
 * Safe to import from any process (renderer, main, shared, preload).
 */

export type ExecutorStatus =
  | 'idle'
  | 'initializing'
  | 'running'
  | 'success'
  | 'error'
  | 'cancelled';

export type BackgroundExecutorType = 'commit' | 'pr' | 'review' | 'walkthrough';

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

export interface BackgroundAgentConfig {
  type: BackgroundExecutorType | string;
  name?: string;
  promptPath?: string;
  resultTag?: string;
  resultPattern?: string; // Serialized regex pattern (not RegExp)
  timeout?: number;
}

export interface ResultContext {
  /** Whether this result was restored from a previous session */
  isRestored: boolean;
  /** The workspace ID this result was generated for */
  workspaceId?: string;
  /** The execution context captured when the execution started */
  executionContext?: AgentExecutorContext;
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

export const EXECUTOR_CONFIGS: Record<
  string,
  { resultTag: string; timeout: number; name: string; agentType: string }
> = {
  // i18n-ignore (internal background-agent session names)
  commit: {
    resultTag: 'COMMIT_MESSAGE',
    timeout: COMMIT_MESSAGE_EXECUTOR_TIMEOUT_MS,
    name: 'Commit Message Generator',
    agentType: 'commit-message',
  },
  // i18n-ignore (internal background-agent session names)
  'commit-merge': {
    resultTag: 'COMMIT_MESSAGE',
    timeout: COMMIT_MESSAGE_EXECUTOR_TIMEOUT_MS,
    name: 'Merge Commit Generator',
    agentType: 'commit-message',
  },
  // i18n-ignore (internal background-agent session names)
  pr: {
    resultTag: 'PR_DESCRIPTION',
    timeout: 180000,
    name: 'PR Description Generator',
    agentType: 'pr-description',
  },
  // i18n-ignore (internal background-agent session names)
  review: {
    resultTag: 'CODE_REVIEW',
    timeout: 120000,
    name: 'Code Review Assistant',
    agentType: 'code-review',
  },
  // i18n-ignore (internal background-agent session names)
  walkthrough: {
    resultTag: 'CODE_WALKTHROUGH',
    timeout: 120000,
    name: 'Code Walkthrough Generator',
    agentType: 'code-walkthrough',
  },
};

/** Maximum diff size per file in characters before skipping */
export const MAX_DIFF_SIZE_PER_FILE = 50_000;

/** Maximum total diff size in characters */
export const MAX_TOTAL_DIFF_SIZE = 200_000;
