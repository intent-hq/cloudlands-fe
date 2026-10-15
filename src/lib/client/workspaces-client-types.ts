import type {
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
  Workspace,
  WorkspaceDiskUsage,
} from '$shared/types';
import type {
  NativeReviewOwner,
  NativeReviewInput,
  NativeReviewRetirement,
  NativeReviewSession,
} from '$shared/types/native-review-operation';
import type {
  RepositorySelectionEdit,
  RepositorySelectionSession,
  SelectionRetirement,
} from '$shared/types/repository-selection';
import type {
  RepositoryContextRequest,
  RepositoryContextResponse,
} from '$shared/types/repository-context';
import type { WorkspaceBrowserClient } from '$shared/types/browser-clients';
import type { TokenUsage } from '../../features/token-usage/token-usage-types';
import type { ContextItem } from '../../features/context/types';
import type { MutationResult, SubscriptionHandler, Unsubscribe } from './client-types';

/** `workspace.update` outcome — carries the daemon's updated workspace on success. */
export interface WorkspaceUpdateResult extends MutationResult {
  workspace?: Workspace;
  /** Opt-in title receipt only; unknown never proves a rollback or safe replay. */
  titleOutcome?: 'confirmed' | 'failed' | 'unknown';
}

export interface WorkspaceTitleUpdateOptions {
  requireTitleReceipt: true;
  /** Runs after transport preflight, immediately before the one update dispatch. */
  onDispatch: () => void;
}

/**
 * `workspace.create` outcome — carries the daemon's created workspace on
 * success plus, when the request included an `initialAgent`, the daemon's
 * created agent projection (`AgentLite` shape, same as the `agent.create`
 * result's `agent`). The daemon assigns the agent id; callers must adopt
 * `initialAgent.id` instead of pre-minting one.
 */
export interface WorkspaceCreateResult extends MutationResult {
  workspace?: Workspace;
  initialAgent?: { id: string } & Record<string, unknown>;
  /**
   * Machine-readable code for a failed create, surfaced from the transport
   * error's `data.code`. Only daemon-authored codes (e.g.
   * `"base-ref-unresolvable"` when the base ref cannot be resolved,
   * monorepo#761) are a stable contract (PROTOCOL §9); when the daemon sends
   * no explicit code, the FE transport bridge fills in a mapped string code
   * (`"INVALID_PARAMS"`, `"TRANSPORT_ERROR"`, ...) instead. Consumers must
   * exact-match the daemon codes they understand and never key behavior off
   * the bridge-mapped values.
   */
  errorCode?: string;
}

/**
 * Result of the on-demand `workspace.diskUsage` poll (PROTOCOL §5.1).
 * `diskUsage` is omitted until the daemon's first walk completes and for
 * rows without a daemon-managed directory; `refreshing: true` means a
 * background walk is in flight so callers may poll again shortly.
 */
export interface WorkspaceDiskUsageResult {
  diskUsage?: WorkspaceDiskUsage;
  refreshing: boolean;
}

/**
 * `workspace.delete` outcome (§5.1). When the request carried
 * `undoDelayMs > 0` the daemon registers an in-memory pending deletion
 * (the daemon-owned delete grace window) and returns
 * `{ success: true, scheduled: true, deleteAt }` — `deleteAt` is the ISO
 * commit deadline. An immediate delete (no `undoDelayMs`) keeps the plain
 * `{ success: true }` shape, so both fields are additive and optional.
 */
export interface WorkspaceDeleteResult extends MutationResult {
  scheduled?: boolean;
  deleteAt?: string;
}

/**
 * `workspace.cancelDelete` outcome (§5.1, delete grace window). The daemon
 * returns `{ cancelled: bool }` — `false` when nothing is pending (already
 * committed, or never scheduled): a non-error, race-safe outcome. Folded onto
 * MutationResult so transport failures surface uniformly via `success`.
 */
export interface WorkspaceCancelDeleteResult extends MutationResult {
  cancelled?: boolean;
}

export type RepositoryContextUpdate =
  | { type: 'received'; response: RepositoryContextResponse }
  | { type: 'unavailable' | 'retired'; request: RepositoryContextRequest };

export interface WorkspacesClient {
  beginNativeReview(
    owner: NativeReviewOwner,
    input: NativeReviewInput,
    handler: (kind: NativeReviewRetirement) => void,
  ): Promise<NativeReviewSession>;
  beginRepositorySelectionEdit(
    request: RepositorySelectionEdit,
    handler: (kind: SelectionRetirement) => void,
  ): Promise<RepositorySelectionSession>;
  /** One inventory read, retaining its resource until retirement or unsubscribe. */
  observeRepositoryContext(
    request: RepositoryContextRequest,
    handler: (update: RepositoryContextUpdate) => void,
  ): Promise<Unsubscribe>;
  list(options?: { includeArchived?: boolean }): Promise<Workspace[]>;
  get(id: string): Promise<Workspace | null>;
  /**
   * Open a workspace by id (route loader entry point). Returns the matching
   * workspace, or `null` when it cannot be resolved. The daemon exposes no
   * separate `workspace.open` RPC today — implementations resolve the workspace
   * via `workspace.get` and let the daemon own any side effects (watchers,
   * monitoring) that the legacy main-process handler used to start.
   */
  open(id: string): Promise<Workspace | null>;
  /**
   * Create a workspace (`workspace.create`, §5.1). The daemon returns
   * `{ workspace }` — surfaced as `workspace` so the legacy `workspace:create`
   * bridge can hand callers the created entity without a follow-up read.
   */
  create(request: CreateWorkspaceRequest): Promise<WorkspaceCreateResult>;
  /**
   * Update workspace fields (`workspace.update`, §5.1). The FE request `id`
   * maps to the wire `workspaceId`. On success the daemon's authoritative
   * updated `Workspace` is surfaced as `workspace` so callers can upsert it
   * without a follow-up `workspace.get`.
   */
  update(
    request: UpdateWorkspaceRequest,
    options?: WorkspaceTitleUpdateOptions,
  ): Promise<WorkspaceUpdateResult>;
  /**
   * Delete a workspace (`workspace.delete`, §5.1). Optional
   * `options.undoDelayMs > 0` requests the daemon-owned delete grace window:
   * the daemon schedules the commit at `now + undoDelayMs`
   * and returns `{ success: true, scheduled: true, deleteAt }`; the FE cancels
   * it via `cancelDelete`. Omitted/0 keeps the immediate-delete behavior.
   */
  delete(id: string, options?: { undoDelayMs?: number }): Promise<WorkspaceDeleteResult>;
  /**
   * Cancel a pending grace-window deletion (`workspace.cancelDelete`, §5.1).
   * `{ cancelled: false }` means nothing was pending (already committed, or
   * never scheduled) — a non-error, race-safe outcome.
   */
  cancelDelete(id: string): Promise<WorkspaceCancelDeleteResult>;
  /** Archive a workspace (`workspace.archive`, §5.1). */
  archive(id: string): Promise<MutationResult>;
  /** Unarchive a workspace (`workspace.unarchive`, §5.1) — the archive-undo path. */
  unarchive(id: string): Promise<MutationResult>;
  /**
   * Mark a workspace seen (`workspace.markSeen`, §5.1) — clears the unread
   * `attention` flag only (unlike `workspace.dismissAttention`, which also
   * clears `review_required`). The daemon returns `{ workspace }` and emits
   * `workspace:attention-changed`, which drives the reactive UI clear.
   */
  markSeen(id: string): Promise<MutationResult>;
  setActive(id: string): Promise<MutationResult>;
  recentViews(): Promise<Record<string, number>>;
  /**
   * `workspace.getTokenUsage` (PROTOCOL §5.23): the daemon-owned usage rollup
   * for one workspace (the scan job itself is daemon-internal). Returns `null`
   * when the workspace is unknown. Updated rollups are pushed via the
   * `workspace:tokenUsage-changed` event (§6.5).
   */
  getTokenUsage(workspaceId: string): Promise<TokenUsage | null>;
  /**
   * `workspace.diskUsage` (PROTOCOL §5.1): on-demand cached footprint of the
   * workspace's daemon-managed directory — `{ diskUsage?, refreshing }`.
   * Never populated on list/get rows (monorepo#1396); clients fetch it here
   * when needed. Returns `null` when the daemon predates the method
   * (-32601 METHOD_NOT_FOUND) so callers can fall back gracefully.
   */
  diskUsage(workspaceId: string): Promise<WorkspaceDiskUsageResult | null>;
  /**
   * `workspace.getContext` (PROTOCOL §5.1): the daemon-owned chat-context
   * attachment list for one workspace (notes, linear / github / sentry issues,
   * browser URLs — the `ContextItem` union). Returns the items in the order
   * the daemon persists them, or an empty array when the workspace has none.
   * Updates are pushed via the `workspace:context-changed` event (§6.5).
   */
  getContext(workspaceId: string): Promise<ContextItem[]>;
  /**
   * `workspace.updateContext` (PROTOCOL §5.1): full-list replacement of the
   * workspace's chat-context items. The daemon returns the persisted list
   * verbatim so callers can reconcile without a follow-up `getContext`, and
   * emits a self-sufficient `workspace:context-changed { workspaceId, items }`
   * that the bridge folds into the context slice.
   */
  updateContext(workspaceId: string, items: ContextItem[]): Promise<ContextItem[]>;
  /**
   * `workspace.getBrowserClient` (REV-2, PROTOCOL §5.1): the workspace's
   * effective browser client — the persisted pin (`clientId` + `source:
   * "workspace"`, else `source: "default"`) plus `resolved`, the client an
   * agent `browser.exec` would reach right now (`null` when none).
   */
  getBrowserClient(workspaceId: string): Promise<WorkspaceBrowserClient>;
  /**
   * `workspace.setBrowserClient` (REV-2, PROTOCOL §5.1): persist (`clientId`)
   * or clear (`null`) the per-workspace browser-client pin. The daemon emits
   * `workspace:updated { changes: { browserClientId } }` and echoes the
   * `getBrowserClient` shape.
   */
  setBrowserClient(workspaceId: string, clientId: string | null): Promise<WorkspaceBrowserClient>;
  subscribe(handler: SubscriptionHandler<Workspace[]>): Unsubscribe;
}
