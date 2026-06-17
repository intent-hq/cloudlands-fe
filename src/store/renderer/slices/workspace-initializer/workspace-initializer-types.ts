import type { Collection } from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";

export type WorkspaceInitializerRepoType = "local" | "github" | "remote";

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
  transport?: "ssh" | "websocket";
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
  type: "local" | "github";
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
  skipWorktree?: boolean;
  stayOnHomePage?: boolean;
}

export interface WorkspaceInitializerOnboardingFormState {
  projectSelection: {
    type?: WorkspaceInitializerRepoType | "new";
    repoPath?: string;
    branch?: string;
    scope?: string;
    githubUrl?: string;
    clonePath?: string;
    projectName?: string;
    isValid?: boolean;
  } | null;
  skipWorktree?: boolean;
  setupScript?: string;
  setupScriptName?: string;
  isCustomSetupScript?: boolean;
  step?: "welcome" | "project" | "configuring" | "ready";
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
  recentRepos: Collection<WorkspaceInitializerRecentRepo, "path">;
  remoteSetups: Collection<WorkspaceInitializerRemoteSetup, "id">;
  lastSubmittedAgent: WorkspaceInitializerAgentSettings | null;
}