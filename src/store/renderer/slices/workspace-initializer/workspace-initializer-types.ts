import type { Collection } from '$lib/store-shim/utils/collections/collection-utils';
import type { OnboardingStep } from '../onboarding/onboarding-types';

export type WorkspaceInitializerRepoType = 'local' | 'github' | 'remote';

export interface WorkspaceInitializerRemoteSetup {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  keyPath?: string;
  useAgent?: boolean;
  workspacePath: string;
  lastUsedRepo?: string;
  lastUsed?: string;
  transport?: 'ssh' | 'websocket';
  wsUrl?: string;
  branch?: string;
}

export interface WorkspaceInitializerRepoSelection {
  path: string;
  type: WorkspaceInitializerRepoType;
  githubUrl?: string;
  clonePath?: string;
  isNewRepo?: boolean;
  isValidPath?: boolean;
  scope?: string;
  remoteSetup?: WorkspaceInitializerRemoteSetup;
}

export interface WorkspaceInitializerRecentRepo {
  path: string;
  type: 'local' | 'github';
  githubUrl?: string;
  name: string;
  owner?: string;
}

export interface WorkspaceInitializerAgentSettings {
  selectedSpecialist?: string | null;
  selectedModel?: string;
  modelWasOverridden?: boolean;
  isTeamMode?: boolean;
}

export interface CompactWorkspaceInitializerFormState extends WorkspaceInitializerAgentSettings {
  repoPath?: string;
  repoType?: WorkspaceInitializerRepoType;
  githubUrl?: string;
  clonePath?: string;
  branch?: string;
  isNewRepo?: boolean;
  isValidPath?: boolean;
  scope?: string;
  scopeRepoPath?: string;
  remoteSetup?: WorkspaceInitializerRemoteSetup | null;
  selectedProvider?: string;
  setupScript?: string;
  showSetupScript?: boolean;
  setupScriptName?: string;
  isCustomSetupScript?: boolean;
  skipIsolation?: boolean;
  stayOnHomePage?: boolean;
}

export interface WorkspaceInitializerOnboardingFormState {
  projectSelection: {
    type?: WorkspaceInitializerRepoType | 'new';
    repoPath?: string;
    branch?: string;
    scope?: string;
    githubUrl?: string;
    clonePath?: string;
    projectName?: string;
    isValid?: boolean;
  } | null;
  skipIsolation?: boolean;
  setupScript?: string;
  setupScriptName?: string;
  isCustomSetupScript?: boolean;
  /** User-picked model for the initial Coordinator agent (step 3 picker). */
  selectedModel?: string;
  /** Whether the user explicitly overrode the model (vs the auto-resolved default). */
  modelWasOverridden?: boolean;
  step?: OnboardingStep;
}

/**
 * GitHub issue/PR selected from a chat link action, pending insertion into the
 * new-workspace initializer prompt as a context mention. Transient (not persisted);
 * cleared as soon as the initializer consumes it.
 */
export interface WorkspaceInitializerPendingGitHubPrefill {
  owner: string;
  repo: string;
  number: number;
  kind: 'issue' | 'pr';
  url: string;
}

export interface WorkspaceInitializerHydrationState {
  compactFormState?: CompactWorkspaceInitializerFormState | null;
  onboardingFormState?: WorkspaceInitializerOnboardingFormState | null;
  lastSelectedRepo?: WorkspaceInitializerRepoSelection | null;
  branchByRepo?: Record<string, string>;
  defaultParentPath?: string;
  recentRepos?: WorkspaceInitializerRecentRepo[];
  remoteSetups?: WorkspaceInitializerRemoteSetup[];
  lastSubmittedAgent?: WorkspaceInitializerAgentSettings | null;
}

export interface WorkspaceInitializerState {
  hydrated: boolean;
  compactFormState: CompactWorkspaceInitializerFormState | null;
  onboardingFormState: WorkspaceInitializerOnboardingFormState | null;
  lastSelectedRepo: WorkspaceInitializerRepoSelection | null;
  branchByRepo: Record<string, string>;
  defaultParentPath: string;
  recentRepos: Collection<WorkspaceInitializerRecentRepo, 'path'>;
  remoteSetups: Collection<WorkspaceInitializerRemoteSetup, 'id'>;
  lastSubmittedAgent: WorkspaceInitializerAgentSettings | null;
  /** Transient GitHub issue/PR prefill pending consumption by the initializer (not persisted). */
  pendingGitHubPrefill: WorkspaceInitializerPendingGitHubPrefill | null;
}
