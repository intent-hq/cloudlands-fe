import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';

type WorkspaceInitializerRepoType = 'local' | 'github' | 'remote';

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
  /** Bare model id of an explicit pick, paired with `selectedProvider`. */
  selectedModel?: string;
  modelWasOverridden?: boolean;
  selectedReasoningEffort?: string;
  isTeamMode?: boolean;
  /** Provider the persisted `selectedModel` belongs to. */
  selectedProvider?: string;
}

export interface CompactWorkspaceInitializerFormState extends WorkspaceInitializerAgentSettings {
  repoPath?: string;
  repoType?: WorkspaceInitializerRepoType;
  githubUrl?: string;
  branch?: string;
  isNewRepo?: boolean;
  isValidPath?: boolean;
  scope?: string;
  scopeRepoPath?: string;
  remoteSetup?: WorkspaceInitializerRemoteSetup | null;
  skipIsolation?: boolean;
}

export interface WorkspaceInitializerOnboardingFormState {
  projectSelection: {
    type?: WorkspaceInitializerRepoType | 'new';
    repoPath?: string;
    branch?: string;
    scope?: string;
    githubUrl?: string;
    projectName?: string;
    isValid?: boolean;
  } | null;
  skipIsolation?: boolean;
  /** User-picked bare model id for the initial Coordinator agent (step 3 picker). */
  selectedModel?: string;
  /** Whether the user explicitly overrode the model (vs the auto-resolved default). */
  modelWasOverridden?: boolean;
  /** Provider the picked `selectedModel` belongs to. */
  selectedProvider?: string;
  step?: 'requirements' | 'welcome' | 'github' | 'project' | 'configuring' | 'ready';
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
}
