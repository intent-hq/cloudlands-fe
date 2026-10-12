import type {
  Workspace,
  WorkspaceId,
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
  Result,
  WorkspaceDiffSummary,
  WorkspaceGitSummary,
  WorkspaceTask,
} from '$shared/types';
import type { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import type { WorkspacesClient } from '$lib/client/workspaces-client-types';
import type { WorkspaceAuthorityProjectionState } from '../workspace-authority-projections';

/** The configured renderer Store; getters retain dispatch and state identity. */
export interface WorkspaceDomainStore {
  readonly state: WorkspaceAuthorityProjectionState;
  readonly dispatch: (action: { type: string }) => unknown;
}

export type WorkspaceDeletion = {
  readonly workspaceId: Workspace['id'];
  begin(hide?: boolean): boolean;
  current(): boolean;
  /** Original-context removal receipt; a denied receipt permits only owned grace. */
  terminal(): 'removed' | 'denied' | null;
  restore(): void;
  expire(): void;
};

export interface WorkspaceDeletionRuntime {
  captureWorkspaceDeletion(workspace: Workspace): WorkspaceDeletion | null;
  currentWorkspaceDeletion(operation: WorkspaceDeletion, id: string): boolean;
  terminalWorkspaceDeletion(operation: WorkspaceDeletion, id: string): boolean;
  captureDeletionExpiry(id: string): () => void;
}

export type WorkspaceDomainReadChannel = (typeof WORKSPACE_CHANNELS)[
  'LIST' | 'OPEN' | 'GET_DIFF_SUMMARY' | 'GET_GIT_SUMMARY' | 'GET_TASKS'];

/**
 * All five main-handler contracts are required. Returns their original Result
 * or CommandResponse envelopes; the canonical client owns normalization.
 * LIST receives { lite }, OPEN { id }, and summaries/tasks { workspaceId }.
 * LIST must retain archived-inclusive completeness and main-owned freshness.
 * No generated/mock IPC or partial transport may stand in for these handlers.
 */
export interface WorkspaceDomainReadTransport {
  available(): boolean;
  invoke(channel: WorkspaceDomainReadChannel, data?: unknown): Promise<unknown>;
}

export interface WorkspaceDomainClientDependencies {
  store: WorkspaceDomainStore;
  workspaces: Pick<
    WorkspacesClient,
    'create' | 'update' | 'delete' | 'cancelDelete' | 'archive' | 'unarchive'
  >;
  deletions: Pick<
    WorkspaceDeletionRuntime,
    'currentWorkspaceDeletion' | 'terminalWorkspaceDeletion'
  >;
  transport: WorkspaceDomainReadTransport;
}

/** Public WorkspaceClient surface, preserved for both renderer bindings. */
export interface WorkspaceDomainClient {
  clearCache(workspaceId?: string): void;

  list(options?: { lite?: boolean }): Promise<Result<Workspace[], string> & { complete?: boolean }>;

  create(request: CreateWorkspaceRequest): Promise<
    | { ok: true; data: { workspace: Workspace; initialAgent?: { id: string } } }
    | {
        ok: false;
        error: string;
        /**
         * Machine-readable failure code from the transport error's
         * `data.code`. Only daemon-authored codes (e.g.
         * `"base-ref-unresolvable"`, monorepo#761) are a stable contract;
         * the FE bridge fills in mapped codes (`"INVALID_PARAMS"`, ...) when
         * the daemon sent none — consumers must exact-match daemon codes only.
         */
        errorCode?: string;
      }
  >;

  open(id: WorkspaceId): Promise<Result<Workspace, string>>;

  update(request: UpdateWorkspaceRequest): Promise<Result<Workspace, string>>;

  delete(
    id: WorkspaceId,
    options?: { undoDelayMs?: number },
    operation?: WorkspaceDeletion,
  ): Promise<
    | Result<{ scheduled?: boolean; deleteAt?: string } | void, string>
    | { ok: false; error: string; obsolete: true }
  >;

  cancelDelete(
    id: WorkspaceId,
    operation?: WorkspaceDeletion,
  ): Promise<Result<{ cancelled: boolean }, string> | { ok: false; error: string; obsolete: true }>;

  archive(id: WorkspaceId): Promise<Result<void, string>>;

  unarchive(id: WorkspaceId): Promise<Result<void, string>>;

  getDiffSummary(workspaceId: WorkspaceId): Promise<Result<WorkspaceDiffSummary | null, string>>;

  getGitSummary(workspaceId: WorkspaceId): Promise<Result<WorkspaceGitSummary | null, string>>;

  getTasks(workspaceId: WorkspaceId): Promise<Result<WorkspaceTask[], string>>;
}
