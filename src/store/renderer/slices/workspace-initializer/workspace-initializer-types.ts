import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { OnboardingStep } from '../onboarding/onboarding-types';
import type { RepositoryCheckoutDraft } from '../repository-checkout/repository-checkout-types';
import type { RepositoryTarget } from '$shared/types/repository-context';
import type { CreateWorkspaceRequest, Workspace } from '$shared/types';
import type { KnownRepo } from '$shared/types/known-repo';
import type { CheckoutRepoConfigQuery, CheckoutSelection } from '$shared/types/repository-checkout';
import type { SetupScriptNameSource } from '$features/setup-scripts/repo-config';

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
  /** Display identity only; null explicitly marks unqualified legacy metadata. */
  repositoryIdentity?: RepositoryTarget | null;
}

export interface WorkspaceInitializerRecentRepoRefresh {
  id: string;
  requestId: string;
  admission: string;
  status: 'pending' | 'ready' | 'failed';
  repos: WorkspaceInitializerRecentRepo[];
  workspaces: Workspace[];
  registryRepos: KnownRepo[];
}

export interface WorkspaceInitializerDirectoryStatus {
  exists: boolean;
  isDirectory: boolean;
  isEmpty: boolean;
  isGitRepo: boolean;
  path: string;
  parentGitRoot?: string;
  relativePathFromGitRoot?: string;
  isSubdirectoryOfGitRepo?: boolean;
}

export interface WorkspaceInitializerDirectoryStatusCheck {
  id: string;
  requestId: string;
  admission: string;
  path: string;
  status: 'pending' | 'ready' | 'failed' | 'unsupported';
  result: WorkspaceInitializerDirectoryStatus | null;
}

export interface WorkspaceInitializerRepoConfigProbeInput {
  identity: {
    path: string | null;
    type: string | null;
    githubUrl?: string | null;
    branch?: string | null;
  };
  probeKey: string | null;
  repoKey: string | null;
  debounce: boolean;
  setupScriptAtRequest: string;
  applyAllowed: boolean;
  checkout?: {
    formId: string;
    scopeKey: string;
    query: CheckoutRepoConfigQuery;
  };
}

interface WorkspaceInitializerRepoConfigProbe extends WorkspaceInitializerRepoConfigProbeInput {
  id: string;
  requestId: string;
  admission: string;
  status: 'pending' | 'ready' | 'failed';
  script: string | null;
}

export interface WorkspaceInitializerAgentSettings {
  selectedSpecialist?: string | null;
  /** Bare model id of an explicit pick, paired with `selectedProvider`. */
  selectedModel?: string;
  modelWasOverridden?: boolean;
  /** Absent inherits defaults; blank remembers an explicit clear. */
  selectedReasoningEffort?: string;
  isTeamMode?: boolean;
  /** Provider the persisted `selectedModel` belongs to. */
  selectedProvider?: string;
}

export interface CompactWorkspaceInitializerFormState extends WorkspaceInitializerAgentSettings {
  repoPath?: string;
  repoType?: WorkspaceInitializerRepoType | 'gitlab';
  repositoryCheckoutDraft?: RepositoryCheckoutDraft;
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
  /** Already-read PR branches; available on both browser and Electron Home. */
  sourceBranch?: string;
  targetBranch?: string;
  title?: string;
}

export interface WorkspaceInitializerHydrationState {
  compactFormState?: CompactWorkspaceInitializerFormState | null;
  onboardingFormState?: WorkspaceInitializerOnboardingFormState | null;
  lastSelectedRepo?: WorkspaceInitializerRepoSelection | null;
  branchByRepo?: Record<string, string>;
  defaultParentPath?: string;
  recentRepos?: WorkspaceInitializerRecentRepo[];
  dismissedRecentRepoKeys?: Record<string, true>;
  remoteSetups?: WorkspaceInitializerRemoteSetup[];
  lastSubmittedAgent?: WorkspaceInitializerAgentSettings | null;
  /** Last created agent setup per repository (`agentSettingsRepoKey`), oldest first. */
  agentByRepo?: Record<string, WorkspaceInitializerAgentSettings>;
  /** Specialist ids used to create workspaces, most recent first. */
  recentSpecialistIds?: string[];
}

export interface WorkspaceInitializerDraftAttachment {
  id: string;
  type: string;
  label: string;
  description?: string;
  content?: string;
  path?: string;
  imageData?: string;
  imageMimeType?: string;
  attachmentId?: string;
  attachmentMimeType?: string;
  attachmentSize?: number;
  sourcePath?: string;
  placementStatus?: 'failed';
}

export interface WorkspaceInitializerDraftPayload {
  text: string;
  attachments?: WorkspaceInitializerDraftAttachment[];
}

export interface WorkspaceInitializerDraftRestore {
  id: string;
  requestId: string;
  status: 'pending' | 'restored' | 'empty' | 'error';
  text: string;
  attachments: WorkspaceInitializerDraftAttachment[];
}

export interface WorkspaceInitializerDraftClear {
  id: string;
  requestId: string;
  ownerRequestId?: string;
  status: 'pending' | 'success' | 'failure';
}

type WorkspaceInitializationJson =
  | null
  | boolean
  | number
  | string
  | WorkspaceInitializationJson[]
  | { [key: string]: WorkspaceInitializationJson };

/** Serializable projection of a pre-workspace attachment/context item. */
export interface WorkspaceInitializationStagedItem {
  id: string;
  type: 'file' | 'note' | 'selection' | 'workspace' | 'memory' | 'personality' | 'folder';
  label: string;
  description?: string;
  content?: string;
  path?: string;
  metadata?: Record<string, WorkspaceInitializationJson>;
  imageData?: string;
  imageMimeType?: string;
  attachmentId?: string;
  attachmentMimeType?: string;
  attachmentSize?: number;
  placementStatus?: 'placing' | 'failed' | 'placed';
  placementProgress?: number;
  placementError?: string;
  sourcePath?: string;
  placementIdempotencyKey?: string;
  placementFileName?: string;
  placementAttachmentId?: string;
}

interface WorkspaceInitializationImageBlock {
  type: 'image';
  data?: string;
  mimeType?: string;
  attachmentId?: string;
  placementIdempotencyKey?: string;
  placementFileName?: string;
}

export interface WorkspaceInitializationConsumer {
  id: string;
  resourceId: string;
}

interface WorkspaceInitializationHeldMessage {
  content: string;
  imageBlocks: WorkspaceInitializationImageBlock[];
  contextReferences: WorkspaceInitializationJson[];
}

export interface WorkspaceInitializationRequest {
  entrypoint: 'compact' | 'onboarding';
  admission: string;
  createRequest?: CreateWorkspaceRequest;
  resume?: { workspaceId: string; agentId?: string; workspacePath?: string };
  pull?: { repositoryPath: string; branch: string };
  agentTitle: string;
  coordinator: boolean;
  stagedItems: WorkspaceInitializationStagedItem[];
  heldMessage?: WorkspaceInitializationHeldMessage;
  lastSubmittedAgent: WorkspaceInitializerAgentSettings;
  /** Repository (`agentSettingsRepoKey`) to remember `lastSubmittedAgent` for once created. */
  rememberAgentRepoKey?: string;
  /** Base branch to remember for the repository once the workspace is created. */
  rememberBranch?: { repoPath: string; branch: string };
  selectedPrNumber?: number;
  recentGitHubRepository?: { repository: string; name: string; owner: string; githubUrl: string };
  /** Last-used setup script recorded for the repository once the workspace is created. */
  setupScriptRecord?: WorkspaceInitializationSetupScriptRecord;
  /** Form completion applied once the workspace is created, before the success outcome. */
  completion?: WorkspaceInitializationCompletion;
}

export interface WorkspaceInitializationSetupScriptRecord {
  repoPath: string;
  githubUrl?: string;
  name: string;
  content: string;
  nameSource: SetupScriptNameSource;
}

interface WorkspaceInitializationCompletion {
  draft?: { ownerId: string; restoreRequestId: string; clear: boolean };
  lastSelectedRepo?: WorkspaceInitializerRepoSelection;
  compactFormState?: CompactWorkspaceInitializerFormState;
  onboarding?: true;
}

/** Editor context mention (issue, PR, …) captured at submit. */
interface WorkspaceInitializationContextMention {
  itemType?: string;
  provider?: string;
  identifier: string;
  title: string;
  url?: string;
  description?: string;
  metadata?: string;
}

/** Editor file/terminal/script mention captured at submit. */
interface WorkspaceInitializationFileMention {
  type: string;
  id?: string;
  label?: string;
  uri?: string;
  meta?: Record<string, WorkspaceInitializationJson>;
}

interface WorkspaceInitializationSubmissionBase {
  admission: string;
  prompt: string;
  contextMentions: WorkspaceInitializationContextMention[];
  fileMentions: WorkspaceInitializationFileMention[];
  /** Terminal references snapshotted at the widget edge before submit. */
  runtimeReferences: WorkspaceInitializationJson[];
  stagedItems: WorkspaceInitializationStagedItem[];
  setupScript: string;
  setupScriptName: string;
  setupScriptNameSource: SetupScriptNameSource;
  repoConfigScript: string | null;
  repoConfigScriptRepo: string | null;
  setupScriptExplicit: boolean;
  /** The component probe was still running at submit; the saga settles it. */
  repoConfigUnavailable: boolean;
  repoConfigProbe?: { id: string; requestId: string };
  branchBehind: number;
  pullEnabled: boolean;
  skipIsolation: boolean;
  selectedPrNumber: number | null;
  draft: NonNullable<WorkspaceInitializationCompletion['draft']>;
}

export interface CompactWorkspaceInitializationSubmission extends WorkspaceInitializationSubmissionBase {
  entrypoint: 'compact';
  repoType: WorkspaceInitializerRepoType | 'gitlab';
  repoPath: string;
  githubUrl: string;
  branch: string;
  isNewRepo: boolean;
  isValidPath: boolean;
  scope: string;
  prefillTitle: string;
  remoteSetup: WorkspaceInitializerRemoteSetup | null;
  checkoutFormId: string;
  checkoutScopeKey: string;
  repositoryCheckout: CheckoutSelection | null;
  repositoryCheckoutDraft?: RepositoryCheckoutDraft;
  checkoutContextUrl: string | null;
  checkoutInstanceBaseUrl: string | null;
  selectedPRBranch: string;
  selectedPRTargetBranch: string;
  agent: WorkspaceInitializerAgentSettings;
  rememberAgentRepoKey?: string;
  repoConfigError: boolean;
  setupScriptProbeKey: string | null;
  setupScriptRepoKey: string | null;
  formPersistence: boolean;
}

export interface OnboardingWorkspaceInitializationSubmission extends WorkspaceInitializationSubmissionBase {
  entrypoint: 'onboarding';
  project: {
    type: string;
    repoPath: string;
    githubUrl?: string;
    branch: string;
    scope?: string;
  };
  treatAsNewRepo: boolean;
  effectiveBranch: string;
  selectedModel?: string;
  selectedProvider?: string;
  modelWasOverridden: boolean;
  defaultModelPreview?: { provider: string; model: string | undefined };
}

/** Pill state captured when retrying a retained post-create failure. */
export interface WorkspaceInitializationResumeInput {
  entrypoint: WorkspaceInitializationRequest['entrypoint'];
  admission: string;
  stagedItems: WorkspaceInitializationStagedItem[];
}

export type WorkspaceInitializationSubmission =
  CompactWorkspaceInitializationSubmission | OnboardingWorkspaceInitializationSubmission;

/** Request retained after a post-create failure so a retry resumes instead of re-creating. */
export interface WorkspaceInitializationResume {
  id: string;
  request: WorkspaceInitializationRequest;
}

export interface WorkspaceInitializationResult {
  workspaceId: string;
  agentId?: string;
  workspacePath?: string;
}

export interface WorkspaceInitializationOutcome extends WorkspaceInitializationConsumer {
  seq: number;
  entrypoint: WorkspaceInitializationRequest['entrypoint'];
  status: 'pending' | 'success' | 'failure' | 'cancelled';
  stage?: 'prepare' | 'pull' | 'create' | 'post-create' | 'attachments' | 'first-message';
  workspaceId?: string;
  agentId?: string;
  workspacePath?: string;
  pullCompleted?: boolean;
  error?: string;
  errorCode?: string;
  stagedItems?: WorkspaceInitializationStagedItem[];
  retryImageBlocks?: WorkspaceInitializationImageBlock[];
  /** Set on a failure whose request was retained for resume. */
  resumable?: boolean;
  /** Published on the pending outcome once a submission is prepared. */
  prepared?: WorkspaceInitializationPrepared;
}

export interface WorkspaceInitializationPrepared {
  pull: boolean;
  specialistId?: string | null;
  specialistName?: string;
}

export interface WorkspaceInitializerState {
  /** Transient probe lifetime; never part of the persisted form bag. */
  gitCheckRequest: number;
  gitCheck: { context: string; available: boolean | 'unknown' } | null;
  hydrated: boolean;
  compactFormState: CompactWorkspaceInitializerFormState | null;
  onboardingFormState: WorkspaceInitializerOnboardingFormState | null;
  lastSelectedRepo: WorkspaceInitializerRepoSelection | null;
  branchByRepo: Record<string, string>;
  defaultParentPath: string;
  recentRepos: Collection<WorkspaceInitializerRecentRepo, 'path'>;
  /** Uncapped source results awaiting initial settings hydration; never persisted. */
  pendingRecentRepos: Collection<WorkspaceInitializerRecentRepo, 'path'> | null;
  dismissedRecentRepoKeys: Record<string, true>;
  remoteSetups: Collection<WorkspaceInitializerRemoteSetup, 'id'>;
  lastSubmittedAgent: WorkspaceInitializerAgentSettings | null;
  /** Last created agent setup per repository (`agentSettingsRepoKey`), oldest first. */
  agentByRepo: Record<string, WorkspaceInitializerAgentSettings>;
  /** Specialist ids used to create workspaces, most recent first (single-agent mode only). */
  recentSpecialistIds: string[];
  /** Transient GitHub issue/PR prefill pending consumption by the initializer (not persisted). */
  pendingGitHubPrefill: WorkspaceInitializerPendingGitHubPrefill | null;
  recentRepoRefreshes: Collection<WorkspaceInitializerRecentRepoRefresh, 'id'>;
  directoryStatusChecks: Collection<WorkspaceInitializerDirectoryStatusCheck, 'id'>;
  repoConfigProbes: Collection<WorkspaceInitializerRepoConfigProbe, 'id'>;
  initializationOutcomes: Collection<WorkspaceInitializationOutcome, 'id'>;
  initializationResumes: Collection<WorkspaceInitializationResume, 'id'>;
  draftRestores: Collection<WorkspaceInitializerDraftRestore, 'id'>;
  draftClears: Collection<WorkspaceInitializerDraftClear, 'id'>;
}
