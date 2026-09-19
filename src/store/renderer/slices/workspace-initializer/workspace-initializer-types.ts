import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { OnboardingStep } from '../onboarding/onboarding-types';
import type { ContextItem } from '$lib/components/chat/input/context-api';
import type { MutationResult, WorkspaceSetupScript } from '$lib/client/app-client';
import type { ProviderTestPromptResult } from '$shared/provider-test-prompt';
import type { ProviderAvailabilityResult } from '$shared/types/provider-availability';
import type { Workspace } from '$shared/types';

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

/** One-shot renderer handoff used by deep links and new-space quick actions. */
export interface WorkspaceInitializerPrefill {
  repoPath?: string;
  branch?: string;
  scope?: string;
  githubUrl?: string;
  projectName?: string;
  parentPath?: string;
  environmentType?: 'local' | 'remote';
  sshConfig?: Record<string, unknown>;
  prompt?: string;
  specialist?: string;
  title?: string;
  previousWorkspaceId?: string;
  previousWorkspaceTitle?: string;
  autoCreate?: boolean | 'true' | 'false';
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

export type WorkspaceInitializerOperation<T> = {
  status: 'idle' | 'loading' | 'success' | 'error';
  version: number;
  data: T | null;
  error: string | null;
};

export type NewWorkspaceDraftRestore =
  | { status: 'restored'; text: string; contextItems: ContextItem[] }
  | { status: 'empty' }
  | { status: 'error' };

export type WorkspaceInitializerCreateResult =
  | { ok: true; data: { workspace: Workspace; initialAgent?: { id: string } } }
  | { ok: false; error: string; errorCode?: string };

export interface WorkspaceInitializerDirectoryStatus {
  exists: boolean;
  isDirectory: boolean;
  isEmpty: boolean;
  isGitRepo: boolean;
}

export interface WorkspaceInitializerPullRequestInfo {
  sourceBranch: string;
  targetBranch?: string;
}

export interface WorkspaceInitializerGitRemote {
  owner: string;
  repo: string;
}

export interface WorkspaceInitializerGitAvailability {
  available: boolean | 'unknown';
  version?: string;
}

export interface WorkspaceInitializerResolvedModel {
  provider: string;
  model: string | undefined;
  behaviorPrompt: string | undefined;
  specialistId: string | null;
  specialistName: string | undefined;
}

export interface WorkspaceInitializerPromptEnhancement {
  enhanced: string;
  original: string;
  mode: 'enhance' | 'layout';
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
  githubBranchListings: Record<
    string,
    {
      branches: string[];
      defaultBranch: string;
      source?: string;
      loading: boolean;
      error: string | null;
    }
  >;
  prefillReads: Record<string, WorkspaceInitializerOperation<WorkspaceInitializerPrefill | null>>;
  draftRestores: Record<string, WorkspaceInitializerOperation<NewWorkspaceDraftRestore>>;
  setupScriptGenerations: Record<
    string,
    WorkspaceInitializerOperation<WorkspaceSetupScript | null>
  >;
  specialistPreviews: Record<
    string,
    WorkspaceInitializerOperation<Record<string, string | undefined>>
  >;
  createRequests: Record<string, WorkspaceInitializerOperation<WorkspaceInitializerCreateResult>>;
  directoryStatusReads: Record<
    string,
    WorkspaceInitializerOperation<WorkspaceInitializerDirectoryStatus | null>
  >;
  pullRequestReads: Record<
    string,
    WorkspaceInitializerOperation<WorkspaceInitializerPullRequestInfo | null>
  >;
  gitRemoteReads: Record<
    string,
    WorkspaceInitializerOperation<WorkspaceInitializerGitRemote | null>
  >;
  gitAvailabilityReads: Record<
    string,
    WorkspaceInitializerOperation<WorkspaceInitializerGitAvailability | null>
  >;
  providerAvailabilityReads: Record<
    string,
    WorkspaceInitializerOperation<ProviderAvailabilityResult>
  >;
  providerTests: Record<string, WorkspaceInitializerOperation<ProviderTestPromptResult>>;
  promptEnhancements: Record<
    string,
    WorkspaceInitializerOperation<WorkspaceInitializerPromptEnhancement>
  >;
  modelResolutions: Record<
    string,
    WorkspaceInitializerOperation<WorkspaceInitializerResolvedModel>
  >;
  repositoryPulls: Record<string, WorkspaceInitializerOperation<MutationResult>>;
  reasoningEffortUpdates: Record<string, WorkspaceInitializerOperation<void>>;
}
