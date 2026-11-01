/**
 * Whether the New Workspace / onboarding "Clone" source tab is offered.
 *
 * Clone is hidden only once both forge status reads have settled and neither
 * GitHub nor GitLab is connected. While a status is still pending, or if a read
 * failed, Clone stays visible — the same fail-safe as the git-toggle default.
 */
export interface CloneSourceVisibilityInput {
  githubConnected: boolean;
  githubSettled: boolean;
  githubFailed: boolean;
  gitlabConnected: boolean;
  gitlabSettled: boolean;
  gitlabFailed: boolean;
}

export function resolveCloneSourceVisible(input: CloneSourceVisibilityInput): boolean {
  if (input.githubConnected || input.gitlabConnected) return true;
  if (input.githubFailed || input.gitlabFailed) return true;
  return !input.githubSettled || !input.gitlabSettled;
}
