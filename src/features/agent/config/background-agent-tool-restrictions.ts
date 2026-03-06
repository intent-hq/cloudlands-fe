/**
 * Background Agent Tool Restrictions
 *
 * Defines which tools should be DENIED for each background agent type.
 * Background agents are utility agents that perform specific tasks like
 * generating commit messages, PR descriptions, or code reviews.
 *
 * IMPORTANT: Background agents should have minimal tool access.
 * Most are pure text generation agents that should not modify files,
 * create agents, or perform any side effects.
 */

// ============================================================================
// Tool Categories (for documentation and grouping)
// ============================================================================

/**
 * All file modification tools - agents with these can edit the codebase
 */
export const FILE_WRITE_TOOLS = [
  // Built-in auggie tools
  'str-replace-editor',
  'save-file',
  'remove-files',
  'str_replace',
  'create',
  'apply_patch',
  // MCP workspace tools
  'write_file_workspace-mcp',
  'delete_file_workspace-mcp',
  'create_directory_workspace-mcp',
  'rename_file_workspace-mcp',
] as const;

/**
 * All git tools - agents with these can modify git state
 */
export const GIT_TOOLS = [
  'git_stage_workspace-mcp',
  'git_commit_workspace-mcp',
  // Note: git_status is read-only, generally safe
] as const;

/**
 * All agent creation/delegation tools - agents with these can spawn new agents
 */
export const AGENT_CREATION_TOOLS = [
  'create_agent_workspace-mcp',
  'delegate_task_workspace-mcp',
  'send_message_to_agent_workspace-mcp',
  'send_message_to_task_agent_workspace-mcp',
  'wake_or_create_task_agent_workspace-mcp',
] as const;

/**
 * All note modification tools - agents with these can modify notes
 */
export const NOTE_WRITE_TOOLS = [
  'create_note_workspace-mcp',
  // Note content tools (renamed for clarity)
  'set_note_content_workspace-mcp', // Full replacement (was update_note)
  'add_to_note_workspace-mcp', // Add content (was append_to_note)
  'edit_note_workspace-mcp', // str_replace style editing
  'edit_note_lines_workspace-mcp', // Line-based editing
  'update_note_metadata_workspace-mcp', // Metadata-only updates (title, tags)
  'delete_note_workspace-mcp',
  // Task tools
  'update_task_status_workspace-mcp',
  'update_note_task_status_workspace-mcp',
  'update_task_workspace-mcp',
  'mark_as_task_workspace-mcp',
  'convert_task_blocks_workspace-mcp',
  'create_prerequisite_workspace-mcp',
  'assign_agent_workspace-mcp',
  'add_note_comment_workspace-mcp',
  'respond_to_comment_thread_workspace-mcp',
  // Primitives
  'add_reference_primitive_workspace-mcp',
  'add_cli_primitive_workspace-mcp',
  'add_patch_primitive_workspace-mcp',
  'add_agent_action_primitive_workspace-mcp',
] as const;

/**
 * Workspace modification tools
 */
export const WORKSPACE_WRITE_TOOLS = [
  'rename_space_workspace-mcp',
  'rename_agent_workspace-mcp',
] as const;

/**
 * Process/command execution tools
 */
export const EXECUTION_TOOLS = ['launch-process', 'execute_command'] as const;

/**
 * External communication tools
 */
export const EXTERNAL_TOOLS = ['web-fetch', 'web-search', 'github-api'] as const;

/**
 * Subagent orchestration tools
 */
export const SUBAGENT_TOOLS = [
  'sub-agent',
  'sub-agent-explore',
  'sub-agent-plan',
  'sub-agent-code-review-local-analyzer',
] as const;

/**
 * Built-in auggie tools that conflict with workspace MCP tools.
 * These should always be removed because the workspace MCP versions
 * (e.g., create_agent_workspace-mcp) are the correct implementations
 * that integrate with the workspace agent lifecycle.
 * Without this, the LLM may call both the built-in and MCP versions
 * in parallel, causing errors and duplicate agent creation.
 */
export const CONFLICTING_BUILTIN_TOOLS = [
  'create_agent', // Conflicts with create_agent_workspace-mcp
] as const;

// ============================================================================
// Background Agent Denylists
// ============================================================================

/**
 * Tool restrictions by background agent type.
 *
 * Uses DENYLIST approach: list tools to REMOVE for each agent type.
 * This is safer than an allowlist because new tools are denied by default
 * for background agents that use simpleRequest mode (which skips MCP setup entirely).
 */
export const BACKGROUND_AGENT_TOOL_DENYLISTS: Record<string, readonly string[]> = {
  /**
   * Commit Message Generator
   *
   * Purpose: Generate git commit messages from staged diffs.
   * Input: Diff content, optional context
   * Output: Plain text commit message
   *
   * This is a PURE TEXT GENERATION agent. It should have NO tool access.
   * The diff is provided in the prompt, not fetched via tools.
   */
  'commit-message': [
    ...FILE_WRITE_TOOLS,
    ...GIT_TOOLS,
    ...AGENT_CREATION_TOOLS,
    ...NOTE_WRITE_TOOLS,
    ...WORKSPACE_WRITE_TOOLS,
    ...EXECUTION_TOOLS,
    ...EXTERNAL_TOOLS,
    ...SUBAGENT_TOOLS,
  ],

  /**
   * PR Description Generator
   *
   * Purpose: Generate PR title and description from changes.
   * Input: Diff content, commit history, optional context
   * Output: Markdown PR title + description
   *
   * This is a PURE TEXT GENERATION agent. It should have NO tool access.
   */
  'pr-description': [
    ...FILE_WRITE_TOOLS,
    ...GIT_TOOLS,
    ...AGENT_CREATION_TOOLS,
    ...NOTE_WRITE_TOOLS,
    ...WORKSPACE_WRITE_TOOLS,
    ...EXECUTION_TOOLS,
    ...EXTERNAL_TOOLS,
    ...SUBAGENT_TOOLS,
  ],

  /**
   * Code Review Agent
   *
   * Purpose: Review code changes and identify issues.
   * Input: Diff content, file context
   * Output: JSON with issues array
   *
   * This is a PURE ANALYSIS agent. It should have NO tool access.
   * All context is provided in the prompt.
   */
  'code-review': [
    ...FILE_WRITE_TOOLS,
    ...GIT_TOOLS,
    ...AGENT_CREATION_TOOLS,
    ...NOTE_WRITE_TOOLS,
    ...WORKSPACE_WRITE_TOOLS,
    ...EXECUTION_TOOLS,
    ...EXTERNAL_TOOLS,
    ...SUBAGENT_TOOLS,
  ],

  /**
   * Code Walkthrough Generator
   *
   * Purpose: Generate brief code walkthrough annotations.
   * Input: Diff content, context
   * Output: JSON with title, overview, and annotations
   *
   * This is a PURE ANALYSIS agent. It should have NO tool access.
   * All context is provided in the prompt.
   */
  'code-walkthrough': [
    ...FILE_WRITE_TOOLS,
    ...GIT_TOOLS,
    ...AGENT_CREATION_TOOLS,
    ...NOTE_WRITE_TOOLS,
    ...WORKSPACE_WRITE_TOOLS,
    ...EXECUTION_TOOLS,
    ...EXTERNAL_TOOLS,
    ...SUBAGENT_TOOLS,
  ],

  'task-loop': [...SUBAGENT_TOOLS],
  'ralph-loop': [...SUBAGENT_TOOLS],
  chat: [...SUBAGENT_TOOLS],
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the tool denylist for a specific agent type.
 * Returns empty array if agent type is not a background agent.
 */
export function getToolDenylistForAgentType(agentType: string): readonly string[] {
  return BACKGROUND_AGENT_TOOL_DENYLISTS[agentType] || [];
}

/**
 * Check if an agent type is a background agent with restricted tools.
 */
export function isBackgroundAgentType(agentType: string): boolean {
  return agentType in BACKGROUND_AGENT_TOOL_DENYLISTS;
}

/**
 * Get all background agent types.
 */
export function getBackgroundAgentTypes(): string[] {
  return Object.keys(BACKGROUND_AGENT_TOOL_DENYLISTS);
}
