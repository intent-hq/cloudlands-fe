/**
 * Agent Instructions
 *
 * Centralized exports for all agent instruction templates.
 * These are TypeScript string constants that serve as the source of truth.
 *
 * To edit instructions:
 * 1. Edit the .ts file directly in this directory
 * 2. The content is a string constant - edit it like any other code
 * 3. Changes are available after rebuild/restart
 *
 * Benefits of .ts files:
 * - Bundled with code (no file I/O)
 * - Type-safe
 * - No path resolution issues
 * - Works identically in all environments
 * - No async loading or caching needed
 */

// Base system prompt (Layer 1)
import baseSystemPrompt from './base-system-prompt';

// Core agent types
import chat from './chat';
import common from './common';
import workspace from './workspace';
import debug from './debug';

// Specialized agents
import setupScriptGenerator from './setup-script-generator';
import taskBreakdown from './task-breakdown';
import taskDebug from './task-debug';
import taskFocused from './task-focused';
import taskLoop from './task-loop';
import ralphLoop from './ralph-loop';
import workspaceAgent from './workspace-agent';

// Shared documentation
import notesSystemGuide from './notes-system-guide';

// Utility agents
import codeReview from './background/code-review';
import codeWalkthrough from './background/code-walkthrough';
import commitMessage from './background/commit-message';
import prDescription from './background/pr-description';

// Re-export for direct imports
export {
  baseSystemPrompt,
  chat,
  common,
  workspace,
  debug,
  setupScriptGenerator,
  taskBreakdown,
  taskDebug,
  taskFocused,
  taskLoop,
  ralphLoop,
  workspaceAgent,
  notesSystemGuide,
  codeReview,
  codeWalkthrough,
  commitMessage,
  prDescription,
};

// Utility agents that don't need workspace instructions (notes, diagrams, delegation)
export const UTILITY_AGENTS = new Set([
  'code-review',
  'code-walkthrough',
  'commit-message',
  'pr-description',
]);

// Background agents that are truly non-interactive - they should NOT get common instructions
// (no agent renaming, no delegation, no note editing - just output their result)
export const NON_INTERACTIVE_BACKGROUND_AGENTS = new Set([
  'commit-message',
  'pr-description',
  'code-review',
  'code-walkthrough',
]);

/**
 * Agent type metadata for UI display
 * This is the source of truth for agent types shown in the sandbox
 */
interface AgentTypeInfo {
  id: string;
  label: string;
  description: string;
  isUtility?: boolean;
  isShared?: boolean;
}

/**
 * Get all agent types with metadata
 * Used by sandbox/rules page to display agent selector
 */
export function getAgentTypesWithMetadata(): AgentTypeInfo[] {
  return [
    { id: 'chat', label: 'Chat', description: 'Conversational agent for Q&A and discussions' },
    {
      id: 'task-focused',
      label: 'Task Focused',
      description: 'Focused on completing a single task',
    },
    {
      id: 'task-loop',
      label: 'Task Loop',
      description: 'Iteratively works through multiple tasks',
    },
    {
      id: 'task-breakdown',
      label: 'Task Breakdown',
      description: 'Breaks large tasks into smaller steps',
    },
    {
      id: 'task-debug',
      label: 'Task Debug',
      description: 'Debugging agent for fixing failing tasks',
    },
    {
      id: 'ralph-loop',
      label: 'Ralph Loop',
      description: 'Coordinator that plans with user then delegates work/test loops',
    },
    { id: 'debug', label: 'Debug', description: 'General debugging and error investigation' },
    {
      id: 'workspace-agent',
      label: 'Workspace Agent',
      description: 'Manages workspace operations via MCP',
    },
    {
      id: 'notes-system-guide',
      label: 'Notes System Guide',
      description: 'Explains the notes system usage',
    },
    {
      id: 'setup-script-generator',
      label: 'Setup Script Generator',
      description: 'Generates worktree setup scripts',
    },
    {
      id: 'workspace',
      label: 'Workspace (shared)',
      description: 'Shared rules for all workspace agents',
      isShared: true,
    },
    {
      id: 'code-review',
      label: 'Code Review (Background)',
      description: 'Background agent for code reviews',
      isUtility: true,
    },
    {
      id: 'code-walkthrough',
      label: 'Code Walkthrough (Background)',
      description: 'Generates narrative walkthroughs of code changes',
      isUtility: true,
    },
    {
      id: 'commit-message',
      label: 'Commit Message (Background)',
      description: 'Generates commit messages',
      isUtility: true,
    },
    {
      id: 'pr-description',
      label: 'PR Description (Background)',
      description: 'Generates PR descriptions',
      isUtility: true,
    },
  ];
}

/**
 * Check if an agent type is a utility agent (doesn't get workspace instructions)
 */
export function isUtilityAgent(agentType: string): boolean {
  return UTILITY_AGENTS.has(agentType);
}

/**
 * Get instruction by ID
 *
 * @param id - Instruction ID (e.g., 'debug', 'chat')
 * @param fallbackToWorkspace - If true, unknown instructions fall back to 'workspace' instead of throwing
 * @returns Instruction content as string
 * @throws Error if instruction not found and fallbackToWorkspace is false
 */
export function getInstructionById(id: string, fallbackToWorkspace = true): string {
  const instructions: Record<string, string> = {
    chat,
    common,
    debug,
    workspace,
    'setup-script-generator': setupScriptGenerator,
    'task-breakdown': taskBreakdown,
    'task-debug': taskDebug,
    'task-focused': taskFocused,
    'task-loop': taskLoop,
    'ralph-loop': ralphLoop,
    'workspace-agent': workspaceAgent,
    'notes-system-guide': notesSystemGuide,
    'code-review': codeReview,
    'code-walkthrough': codeWalkthrough,
    'commit-message': commitMessage,
    'pr-description': prDescription,
    // Aliases for common agent types
    fix: debug,
    review: codeReview,
    walkthrough: codeWalkthrough,
  };

  const instruction = instructions[id];
  if (!instruction) {
    if (fallbackToWorkspace) {
      // Fall back to 'workspace' for unknown instruction types
      return workspace;
    }
    throw new Error(
      `Unknown instruction: ${id}. Available: ${Object.keys(instructions).join(', ')}`,
    );
  }

  return instruction;
}

/**
 * Get all available instruction IDs
 */
export function getAvailableInstructionIds(): string[] {
  return [
    'chat',
    'common',
    'debug',
    'workspace',
    'setup-script-generator',
    'task-breakdown',
    'task-debug',
    'task-focused',
    'task-loop',
    'ralph-loop',
    'workspace-agent',
    'notes-system-guide',
    'code-review',
    'code-walkthrough',
    'commit-message',
    'pr-description',
  ];
}

/**
 * Combine common instructions with agent-specific instructions
 *
 * Order matches the sandbox/rules page display:
 * 1. Common instructions (shared knowledge, self-identification)
 * 2. Workspace instructions (notes, diagrams, delegation) - for non-utility agents
 * 3. Specific instructions (agent's specialized purpose)
 *
 * @param specificInstructionId - The ID of the specific agent instruction
 * @returns Combined instruction string
 */
export function getInstructionWithCommon(specificInstructionId: string): string {
  // Get the specific instruction
  const specificInstruction = getInstructionById(specificInstructionId);

  // Don't append common/workspace to itself - workspace gets common prepended only
  if (specificInstructionId === 'common') {
    return specificInstruction;
  }

  // workspace agent type: just prepend common (coordinator behavior comes from specialist behaviorPrompt)
  if (specificInstructionId === 'workspace') {
    return `${common}\n\n---\n\n${specificInstruction}`;
  }

  // Non-interactive background agents: NO common instructions
  // These are output-only agents that shouldn't rename themselves, delegate tasks, etc.
  if (NON_INTERACTIVE_BACKGROUND_AGENTS.has(specificInstructionId)) {
    return specificInstruction;
  }

  // Other utility agents: common first, then specific
  if (UTILITY_AGENTS.has(specificInstructionId)) {
    return `${common}\n\n---\n\n${specificInstruction}`;
  }

  // Workspace agents: common, then workspace, then specific
  return `${common}\n\n---\n\n${workspace}\n\n---\n\n${specificInstruction}`;
}
