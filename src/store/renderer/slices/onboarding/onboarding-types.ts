/**
 * Onboarding Redux Types
 *
 * Safe to import from any process (renderer, main, shared, preload).
 */

export type OnboardingStep =
  | 'requirements'
  | 'welcome'
  | 'github'
  | 'project'
  | 'configuring'
  | 'ready';

export type ProjectConfig = {
  repoUrl: string | null;
  repoName: string | null;
  localPath: string | null;
  branch: string | null;
};

export type AgentStatus = {
  state: 'idle' | 'thinking' | 'working' | 'done' | 'error';
  message: string | null;
};

export type OnboardingState = {
  step: OnboardingStep;
  projectConfig: ProjectConfig;
  agentStatus: AgentStatus;
  workspaceId: string | null;
};

export const STEP_ORDER: OnboardingStep[] = [
  'requirements',
  'welcome',
  'github',
  'project',
  'configuring',
  'ready',
];
