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

import { getInstructionById, getAgentTypesWithMetadata } from '../main/instructions';
import { SPECIALISTS, type Specialist } from '$lib/constants/specialists';

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
function validatePromptContent(
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
 * Specialist prompt patterns that should be present
 * These patterns are validated against the defaultBehaviorPrompt of each specialist
 */
const SPECIALIST_PATTERNS = {
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
 * Check if an agent type is a utility agent
 */
