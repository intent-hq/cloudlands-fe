/**
 * Onboarding Redux Types
 *
 * Safe to import from any process (renderer, main, shared, preload).
 */

/**
 * `connect` (paste the provider's credentials) runs only on an orchestrator:
 * its machines need a profile with a key or token to run the provider.
 */
export type OnboardingStep =
  'requirements' | 'welcome' | 'connect' | 'forge' | 'project' | 'configuring' | 'ready';

export type ProjectConfig = {
  repoUrl: string | null;
  repoName: string | null;
  localPath: string | null;
  branch: string | null;
};

type AgentStatus = {
  state: 'idle' | 'thinking' | 'working' | 'done' | 'error';
  message: string | null;
};

export type OnboardingState = {
  step: OnboardingStep;
  projectConfig: ProjectConfig;
  agentStatus: AgentStatus;
  workspaceId: string | null;
  /**
   * Explicit "show the full onboarding flow" request (e.g. Command Palette
   * "Show onboarding"). Consumed by OnboardingPage's initial-step decision so
   * an explicit restart never skips ahead on setup state.
   */
  fullFlowRequested: boolean;
};

export const STEP_ORDER: OnboardingStep[] = [
  'requirements',
  'welcome',
  'connect',
  'forge',
  'project',
  'configuring',
  'ready',
];
