/**
 * Prompt Loader for Testing
 *
 * Loads agent prompts directly from the instruction files in the codebase.
 * This ensures tests always use the exact same prompts as production code.
 *
 * Key benefits:
 * - Tests stay in sync with prompt changes
 * - No duplication of prompt content
 * - Validates prompt structure and content
 */

import {
  getInstructionById,
  getInstructionWithCommon,
  getAvailableInstructionIds,
  getAgentTypesWithMetadata,
  isUtilityAgent,
  UTILITY_AGENTS,
  baseSystemPrompt,
  common,
  workspace,
} from '../instructions';
import {
  SPECIALISTS,
  type Specialist,
} from '$lib/constants/specialists';

/**
 * Prompt metadata extracted from instruction content
 */
export interface PromptMetadata {
  id: string;
  label: string;
  hasToolInstructions: boolean;
  hasWaveInstructions: boolean;
  hasDelegationInstructions: boolean;
  sections: string[];
  estimatedTokens: number;
}

/**
 * Load a specific instruction by ID
 *
 * @param id - Instruction ID (e.g., 'debug', 'workspace', 'task-loop')
 * @returns The instruction content
 */
export function loadInstruction(id: string): string {
  return getInstructionById(id, false);
}

/**
 * Load instruction with common instructions prepended
 *
 * @param id - Instruction ID
 * @returns Combined instruction content
 */
export function loadInstructionWithCommon(id: string): string {
  return getInstructionWithCommon(id);
}

/**
 * Load the base system prompt
 */
export function loadBaseSystemPrompt(): string {
  return baseSystemPrompt;
}

/**
 * Load common instructions
 */
export function loadCommonInstructions(): string {
  return common;
}

/**
 * Load workspace instructions
 */
export function loadWorkspaceInstructions(): string {
  return workspace;
}

/**
 * Get all available instruction IDs
 */
export function getAllInstructionIds(): string[] {
  return getAvailableInstructionIds();
}

/**
 * Get all specialist configurations
 */
export function getSpecialists(): Specialist[] {
  return SPECIALISTS;
}

/**
 * Get a specific specialist by ID
 */
export function getSpecialist(id: Specialist['id']): Specialist | undefined {
  return SPECIALISTS.find((s) => s.id === id);
}

/**
 * Analyze a prompt and extract metadata
 *
 * @param content - Prompt content to analyze
 * @param id - Prompt ID for metadata
 * @returns Extracted metadata
 */
export function analyzePrompt(content: string, id: string): PromptMetadata {
  const agentTypes = getAgentTypesWithMetadata();
  const agentType = agentTypes.find((t) => t.id === id);

  // Extract markdown sections (## headers)
  const sectionMatches = content.match(/^##\s+.+$/gm) || [];
  const sections = sectionMatches.map((s) => s.replace(/^##\s+/, ''));

  // Estimate tokens (rough approximation: ~4 chars per token)
  const estimatedTokens = Math.ceil(content.length / 4);

  return {
    id,
    label: agentType?.label || id,
    // Check for tool references like `read_note_workspace-mcp`, `delegate_task(`, or _mcp suffixes
    hasToolInstructions:
      /\btool[s]?\b/i.test(content) ||
      /`[a-z_-]+\(/i.test(content) ||
      /[a-z_]+_mcp/i.test(content) ||
      /`[a-z_-]+`/i.test(content),
    hasWaveInstructions: /wave/i.test(content) || /wait_mode/i.test(content),
    hasDelegationInstructions:
      /delegate/i.test(content) || /create_agent/i.test(content) || /wake_or_create/i.test(content),
    sections,
    estimatedTokens,
  };
}

/**
 * Validate that a prompt contains expected sections/patterns
 *
 * @param content - Prompt content
 * @param expectedPatterns - Array of patterns (string or RegExp) that should be present
 * @returns Validation result with missing patterns
 */
export function validatePromptContent(
  content: string,
  expectedPatterns: (string | RegExp)[],
): { valid: boolean; missingPatterns: (string | RegExp)[] } {
  const missingPatterns: (string | RegExp)[] = [];

  for (const pattern of expectedPatterns) {
    if (typeof pattern === 'string') {
      if (!content.includes(pattern)) {
        missingPatterns.push(pattern);
      }
    } else {
      if (!pattern.test(content)) {
        missingPatterns.push(pattern);
      }
    }
  }

  return {
    valid: missingPatterns.length === 0,
    missingPatterns,
  };
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if a prompt mentions specific tools
 *
 * @param content - Prompt content
 * @param toolNames - Tool names to check for
 * @returns Map of tool name to whether it's mentioned
 */
export function checkToolMentions(content: string, toolNames: string[]): Map<string, boolean> {
  const result = new Map<string, boolean>();

  for (const tool of toolNames) {
    // Check for tool name with parentheses (e.g., `delegate_task(`)
    // Escape the tool name to handle special regex characters
    const escapedTool = escapeRegExp(tool);
    const toolPattern = new RegExp(`\\b${escapedTool}\\s*\\(`, 'i');
    result.set(tool, toolPattern.test(content));
  }

  return result;
}

/**
 * Extract code examples from a prompt
 *
 * @param content - Prompt content
 * @returns Array of code blocks found in the prompt
 */
export function extractCodeExamples(content: string): string[] {
  const codeBlocks: string[] = [];
  const codeBlockRegex = /```[\s\S]*?```/g;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    codeBlocks.push(match[0]);
  }

  return codeBlocks;
}

/**
 * Specialist prompt patterns that should be present
 * These patterns are validated against the defaultBehaviorPrompt of each specialist
 */
export const SPECIALIST_PATTERNS = {
  'spec-writer': [
    /coordinator/i,
    /delegate|delegation/i,
    /wave/i,
    /spec|plan/i, // Spec-writer focuses on planning and spec creation
  ],
  // Updated patterns to match optimized implementor behavior prompt
  implementor: [/implement/i, /task/i, /scope/i, /execution/i],
  // Updated patterns to match optimized verifier behavior prompt
  verifier: [/verify|verification/i, /check/i, /test/i, /evidence|criteria/i],
  // PR Reviewer patterns for code review and high-confidence feedback
  'pr-reviewer': [
    /review|code review/i,
    /high confidence/i,
    /severity/i,
    /delegate.*implementor|do not make.*changes/i,
  ],
  // UI Designer patterns for accessibility and design system discovery
  'ui-designer': [
    /accessible|accessibility/i,
    /contrast|focus/i,
    /discover|search.*codebase|existing pattern/i,
    /design system|design token/i,
  ],
} as const;

/**
 * Validate specialist behavior prompt contains expected patterns
 *
 * @param specialistId - Specialist ID
 * @param behaviorPrompt - The behavior prompt to validate (defaultBehaviorPrompt from Specialist)
 * @returns Validation result
 */
export function validateSpecialistPrompt(
  specialistId: Specialist['id'],
  behaviorPrompt: string,
): { valid: boolean; missingPatterns: RegExp[] } {
  const patterns = SPECIALIST_PATTERNS[specialistId] || [];
  return validatePromptContent(behaviorPrompt, patterns) as {
    valid: boolean;
    missingPatterns: RegExp[];
  };
}

/**
 * Get the default behavior prompt for a specialist
 */
export function getSpecialistBehaviorPrompt(specialistId: Specialist['id']): string | undefined {
  const specialist = getSpecialist(specialistId);
  return specialist?.defaultBehaviorPrompt;
}

/**
 * Load all prompts for comprehensive testing
 */
export function loadAllPrompts(): Map<string, string> {
  const prompts = new Map<string, string>();
  const ids = getAllInstructionIds();

  for (const id of ids) {
    try {
      prompts.set(id, loadInstruction(id));
    } catch {
      // Skip if not found
    }
  }

  return prompts;
}

/**
 * Check if an agent type is a utility agent
 */
export { isUtilityAgent, UTILITY_AGENTS };
