/**
 * Suggested Prompt Types
 *
 * Types for the suggested prompts system that allows agents to
 * recommend follow-up actions to users.
 */

/**
 * A suggested follow-up prompt that an agent can recommend to the user.
 * Displayed after agent responses and sent immediately when clicked.
 */
export type SuggestedPrompt = string;

/**
 * Get the text content from a SuggestedPrompt.
 */
export function getPromptText(prompt: SuggestedPrompt): string {
  return prompt;
}

/**
 * Event payload for suggested prompts updates
 */
export interface SuggestedPromptsEvent {
  /** ID of the agent that set the suggestions */
  agentId: string;

  /** ID of the workspace */
  workspaceId: string;

  /** Array of suggested prompts (empty array clears suggestions) */
  prompts: SuggestedPrompt[];
}
