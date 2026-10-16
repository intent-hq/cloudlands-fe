import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { OnboardingStep } from '../onboarding/onboarding-types';
import type { RepositoryCheckoutDraft } from '../repository-checkout/repository-checkout-types';
import type { RepositoryTarget } from '$shared/types/repository-context';
import type { CreateWorkspaceRequest, Workspace } from '$shared/types';
import type { KnownRepo } from '$shared/types/known-repo';

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
  selectedPrNumber?: number;
  recentGitHubRepository?: { repository: string; name: string; owner: string; githubUrl: string };
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
  stage?: 'pull' | 'create' | 'post-create' | 'attachments' | 'first-message';
  workspaceId?: string;
  agentId?: string;
  workspacePath?: string;
  pullCompleted?: boolean;
  error?: string;
  errorCode?: string;
  stagedItems?: WorkspaceInitializationStagedItem[];
  retryImageBlocks?: WorkspaceInitializationImageBlock[];
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
  /** Transient GitHub issue/PR prefill pending consumption by the initializer (not persisted). */
  pendingGitHubPrefill: WorkspaceInitializerPendingGitHubPrefill | null;
  recentRepoRefreshes: Collection<WorkspaceInitializerRecentRepoRefresh, 'id'>;
  directoryStatusChecks: Collection<WorkspaceInitializerDirectoryStatusCheck, 'id'>;
  initializationOutcomes: Collection<WorkspaceInitializationOutcome, 'id'>;
  draftRestores: Collection<WorkspaceInitializerDraftRestore, 'id'>;
  draftClears: Collection<WorkspaceInitializerDraftClear, 'id'>;
}
