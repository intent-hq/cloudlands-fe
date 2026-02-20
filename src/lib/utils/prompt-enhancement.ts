/**
 * Prompt enhancement utilities
 *
 * This module provides utilities for enhancing user prompts using AI.
 * It includes the prompt template and parsing functions for the enhancement process.
 */

/**
 * Context information for prompt enhancement
 */
export interface PromptEnhancementContext {
  // Agent context
  agentTitle?: string;
  agentStatus?: string;
  sessionSummary?: string;

  // Entity context
  entityTitle?: string;
  entityType?: string;
  entityDescription?: string;

  // Workspace context
  workspacePath?: string;
  workspaceTitle?: string;

  // General context
  contextType?: 'agent-chat' | 'workspace-chat';
}

/**
 * Creates the enhancement prompt template that instructs the AI to improve a user's input
 * @param input - The original user input to be enhanced
 * @param context - Optional context information to help with enhancement
 * @returns The formatted prompt for the AI enhancement request
 */
export const getInputWithEnhancePrompt = (
  input: string,
  context?: PromptEnhancementContext,
): string =>
  '⚠️ NO TOOLS ALLOWED ⚠️\n\n' +
  "Here is an instruction that I'd like to give you, but it needs to be improved. " +
  'Rewrite and enhance this instruction to make it clearer, more specific, ' +
  'less ambiguous, and correct any mistakes. ' +
  "Do not use any tools: reply immediately with your answer, even if you're not sure. " +
  'Consider the context of our conversation history when enhancing the prompt. ' +
  'If there is code in triple backticks (```) consider whether it is a code sample and should remain unchanged.' +
  'Reply with the following format:\n\n' +
  '### BEGIN RESPONSE ###\n' +
  'Here is an enhanced version of the original instruction that is more specific and clear:\n' +
  '<augment-enhanced-prompt>enhanced prompt goes here</augment-enhanced-prompt>\n\n' +
  '### END RESPONSE ###\n\n' +
  `Here is my original instruction:\n\n${input}`;

/**
 * Extracts the enhanced prompt from the AI response
 * @param responseText - The full response text from the AI
 * @returns The extracted enhanced prompt, or null if parsing failed
 */
export function extractEnhancedPrompt(responseText: string): string | null {
  // More robust regex that handles various whitespace and formatting
  const tagPattern = /<augment-enhanced-prompt>\s*([\s\S]*?)\s*<\/augment-enhanced-prompt>/i;
  const match = responseText.match(tagPattern);

  if (match && match[1]) {
    const extracted = match[1].trim();
    // Additional validation to ensure we got meaningful content
    if (
      extracted.length > 0 &&
      extracted !== '[Your enhanced version of the instruction goes here]'
    ) {
      return extracted;
    }
  }

  return null;
}

/**
 * Validates that a prompt is suitable for enhancement
 * @param prompt - The prompt to validate
 * @returns True if the prompt can be enhanced, false otherwise
 */
export function canEnhancePrompt(prompt: string): boolean {
  const trimmed = prompt.trim();

  // Don't enhance empty prompts
  if (!trimmed) {
    return false;
  }

  // Don't enhance very short prompts (likely not worth enhancing)
  if (trimmed.length < 10) {
    return false;
  }

  // Don't enhance prompts that are already very long (might be well-formed)
  if (trimmed.length > 2000) {
    return false;
  }

  return true;
}

/**
 * Error types that can occur during prompt enhancement
 */
export enum PromptEnhancementError {
  EMPTY_PROMPT = 'empty_prompt',
  NETWORK_ERROR = 'network_error',
  PARSING_ERROR = 'parsing_error',
  UNKNOWN_ERROR = 'unknown_error',
}

/**
 * Result of a prompt enhancement operation
 */
export interface PromptEnhancementResult {
  success: boolean;
  enhancedPrompt?: string;
  error?: PromptEnhancementError;
  errorMessage?: string;
}
