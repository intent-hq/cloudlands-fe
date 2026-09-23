/**
 * Starter prompt shape for new users without existing projects.
 */

export interface StarterPrompt {
  /** Short label shown on the button */
  label: string;
  /** Full prompt to fill in the text area */
  prompt: string;
  /** Suggested repo name for the project */
  repoName: string;
}
