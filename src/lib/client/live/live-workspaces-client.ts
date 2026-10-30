import { AgentPlacementRequestSchema } from '$shared/types/agent-node';
import type {
  NativeReviewOwner,
  NativeReviewInput,
  NativeReviewRetirement,
  NativeReviewSession,
} from '$shared/types/native-review-operation';
import { createNativeReviewTransport } from './native-review-transport';
import type {
  RepositorySelectionEdit,
  SelectionRetirement,
} from '$shared/types/repository-selection';
import { createRepositorySelectionTransport } from './repository-selection-transport';
import type { RepositoryContextRequest } from '$shared/types/repository-context';
import type { RepositoryContextUpdate } from '../app-client';
import { createRepositoryContextTransport } from './repository-context-transport';
/**
 * Live workspaces domain backed by the intentd daemon.
 *
 * Reads resolve via `workspace.list` / `workspace.get` over the JSON-RPC bridge.
 * `subscribe` converges via the typed global `workspace.subscribe` channel
 * (PROTOCOL §6.9) — snapshot/delta `subscription.push` frames, archived-
 * INCLUSIVE — the sole data path (intent-hq/monorepo#1697); there is no
 * legacy `workspace:*` events-driven refetch. Mutations
 * (`workspace.create/update/delete/archive/unarchive`, §5.1) forward to the
 * daemon and fold outcomes into `MutationResult`.
 */
import { WorkspaceStatus, createWorkspaceId } from '$shared/types';
import type {
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
  Workspace,
  WorkspaceCreateProposalOutcome,
  WorkspaceDiskUsage,
} from '$shared/types';
import type { TokenUsage } from '$features/token-usage/token-usage-types';
import { parseTokenUsage } from '$features/token-usage/token-usage-schema';
import type { ContextItem } from '$features/context/types';
import {
  isWorkspaceBrowserClient,
  type WorkspaceBrowserClient,
} from '$shared/types/browser-clients';
import type {
  MutationResult,
  PullRequestWorkspace,
  SubscriptionHandler,
  Unsubscribe,
  WorkspaceCancelDeleteResult,
  WorkspaceRetireResult,
  WorkspaceCreateResult,
  WorkspaceDeleteResult,
  WorkspaceDiskUsageResult,
  WorkspacesClient,
  WorkspaceUpdateResult,
} from '../app-client';
import { BackendError } from './backend-transport-types';
import { backendRequest } from './backend-transport';
import { createDeltaSubscription } from './delta-subscription';
import {
  extractConflict,
  mutationErrorMessage,
  newIdempotencyKey,
  runMutation,
} from './live-support';

/**
 * Transport timeout for `workspace.delete` (PROTOCOL §5.1). Longer than the
 * daemon's per-workspace cleanup bound (measured ~5–15s per workspace in
 * production) so deletes of large checkouts (multi-GB worktrees) and bulk
 * operations under the per-repo lock don't falsely time out client-side while
 * the daemon is still working. Matches the `git.pull`-style override pattern.
 */
const DELETE_TIMEOUT_MS = 120_000;

/**
 * Transport timeout for `workspace.create` (PROTOCOL §5.1). Cold Claude Code
 * ACP session opens run under the daemon's own NPX budgets (45s initialize +
 * 20s session/new, 70s overall — see intent-services provider_models/probe.rs)
 * plus first-turn overhead, which exceeds the flat 30s transport default.
 * Mirrors the `git.pull` rationale in the shared `backendRequest` JSDoc: the
 * daemon's structured `{ok:false}` / success result must win over a
 * client-side transport timeout.
 */
const CREATE_TIMEOUT_MS = 120_000;

/** Daemon status strings → renderer WorkspaceStatus enum. */
function toWorkspaceStatus(value: unknown): WorkspaceStatus {
  switch (String(value).toLowerCase()) {
    case 'inactive':
      return WorkspaceStatus.Inactive;
    case 'archived':
      return WorkspaceStatus.Archived;
    case 'retired':
      return WorkspaceStatus.Retired;
    case 'deleted':
      return WorkspaceStatus.Deleted;
    default:
      return WorkspaceStatus.Active;
  }
}

/** Coerce a raw daemon workspace object into the renderer `Workspace` shape. */
function normalizeWorkspace(raw: Record<string, unknown>): Workspace {
  const now = new Date().toISOString();
  const id = String(raw.id ?? raw.workspaceId ?? '');
  const { defaultAgentPlacement, ...fields } = raw;
  return {
    ...(fields as Partial<Workspace>),
    ...(defaultAgentPlacement === undefined
      ? {}
      : { defaultAgentPlacement: AgentPlacementRequestSchema.parse(defaultAgentPlacement) }),
    id: createWorkspaceId(id),
    title: String(raw.title ?? raw.name ?? id),
    branch: String(raw.branch ?? ''),
    status: toWorkspaceStatus(raw.status),
    changesets: Array.isArray(raw.changesets) ? (raw.changesets as Workspace['changesets']) : [],
    timeline: Array.isArray(raw.timeline) ? (raw.timeline as Workspace['timeline']) : [],
    conversationInfo: Array.isArray(raw.conversationInfo)
      ? (raw.conversationInfo as Workspace['conversationInfo'])
      : [],
    createdAt: String(raw.createdAt ?? now),
    updatedAt: String(raw.updatedAt ?? now),
  } as Workspace;
}

/**
 * Extract the daemon's structured string error code from a transport error
 * (`error.data.code`, mirrored onto the thrown error by the main-process
 * bridge's `json-rpc-errors.ts`). Duck-typed like `extractConflict` so it
 * works regardless of how the transport layer is mocked in tests. Used by
 * `create` to surface codes such as `"base-ref-unresolvable"` (monorepo#761).
 */
function extractErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return undefined;
  const code = (data as { code?: unknown }).code;
  return typeof code === 'string' && code.length > 0 ? code : undefined;
}

/**
 * Structural type guard for a wire `ContextItem`. Every variant of the union
 * requires `ContextItemBase` (`id`, `type`, `title`, `provider`, `createdAt`,
 * `updatedAt`), and the context slice keys its Collection by `id` while
 * consumers discriminate on `type`, so a row missing either would silently
 * corrupt state. We keep the check minimal — id/type as non-empty strings —
 * and let provider-specific fields round-trip verbatim per §5.1.
 */
function isContextItem(item: unknown): item is ContextItem {
  if (!item || typeof item !== 'object') return false;
  const record = item as { id?: unknown; type?: unknown };
  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.type === 'string' &&
    record.type.length > 0
  );
}

/** The `browserClient` envelope field must be the documented shape; anything else is a wire bug. */
function requireBrowserClient(value: unknown, method: string): WorkspaceBrowserClient {
  if (!isWorkspaceBrowserClient(value)) {
    throw new Error(`Invalid ${method} response shape`);
  }
  return value;
}

/** One documented `workspace.findByPullRequest` row (§5.1); anything else is a contract violation. */
function isPullRequestWorkspace(row: unknown): row is PullRequestWorkspace {
  if (row === null || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    typeof r.title === 'string' &&
    typeof r.archived === 'boolean' &&
    typeof r.linkedAt === 'string'
  );
}

const PROPOSAL_ORIGIN_OUTCOMES: readonly string[] = ['applied', 'dismissed', 'notResolved'];

/**
 * `workspace.create` result `proposalOrigin` (PROTOCOL §5.1), accepted only in
 * its documented shape: its presence turns off the client-side resolve
 * fallback, so a malformed value must not be mistaken for a daemon report.
 */
function parseProposalOrigin(value: unknown): WorkspaceCreateProposalOutcome | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { proposalId, outcome } = value as Record<string, unknown>;
  if (typeof proposalId !== 'string' || typeof outcome !== 'string') return undefined;
  if (!PROPOSAL_ORIGIN_OUTCOMES.includes(outcome)) return undefined;
  return { proposalId, outcome: outcome as WorkspaceCreateProposalOutcome['outcome'] };
}

export class LiveWorkspacesClient implements WorkspacesClient {
  beginNativeReview(
    owner: NativeReviewOwner,
    input: NativeReviewInput,
    handler: (kind: NativeReviewRetirement) => void,
  ): Promise<NativeReviewSession> {
    return createNativeReviewTransport().begin(owner, input, handler);
  }
  beginRepositorySelectionEdit(
    request: RepositorySelectionEdit,
    handler: (kind: SelectionRetirement) => void,
  ) {
    return createRepositorySelectionTransport().begin(request, handler);
  }
  observeRepositoryContext(
    request: RepositoryContextRequest,
    handler: (update: RepositoryContextUpdate) => void,
  ) {
    return createRepositoryContextTransport().observe(request, handler);
  }

  private readonly listRequests = new Map<string, Promise<Workspace[]>>();
  private readonly getRequests = new Map<string, Promise<Workspace | null>>();

  /**
   * `workspace.list` (§5.1). Retired rows are returned only when the caller
   * opts in with `includeRetired: true` (strict opt-in, §5.1 Retired
   * workspaces); `includeArchived` alone never includes them.
   */
  list(options?: { includeArchived?: boolean; includeRetired?: boolean }): Promise<Workspace[]> {
    const includeArchived = options?.includeArchived === true;
    const includeRetired = options?.includeRetired === true;
    const key = `${includeArchived}:${includeRetired}`;
    // Retired reads are never shared: a reader that reloads after a restore,
    // delete or identity change must observe a request started after it, not
    // an older in-flight snapshot whose changes it never journaled.
    const existing = includeRetired ? undefined : this.listRequests.get(key);
    if (existing) return existing;

    const params = {
      ...(includeArchived ? { includeArchived: true } : {}),
      ...(includeRetired ? { includeRetired: true } : {}),
    };
    const request = backendRequest<{ workspaces?: unknown[] }>(
      'workspace.list',
      Object.keys(params).length > 0 ? params : undefined,
    ).then((result) => {
      const workspaces = Array.isArray(result?.workspaces) ? result.workspaces : [];
      return workspaces.map((workspace) =>
        normalizeWorkspace(workspace as Record<string, unknown>),
      );
    });
    if (includeRetired) return request;
    this.listRequests.set(key, request);
    const clearRequest = () => {
      if (this.listRequests.get(key) === request) {
        this.listRequests.delete(key);
      }
    };
    void request.then(clearRequest, clearRequest);
    return request;
  }

  /**
   * `workspace.get` (§5.1), single-flighted per workspace id: every caller —
   * `open`, the workspace-load saga, and the on-demand detail hydration
   * helpers — shares one in-flight request, so overlapping reads never fan
   * out into duplicate RPCs. The entry clears once the request settles either
   * way, so a rejected read never poisons later ones.
   */
  get(id: string): Promise<Workspace | null> {
    const existing = this.getRequests.get(id);
    if (existing) return existing;

    const request = backendRequest<{ workspace?: unknown } | unknown>('workspace.get', {
      workspaceId: id,
    }).then((result) => {
      const raw =
        result && typeof result === 'object' && 'workspace' in result
          ? (result as { workspace?: unknown }).workspace
          : result;
      if (!raw || typeof raw !== 'object') return null;
      return normalizeWorkspace(raw as Record<string, unknown>);
    });
    this.getRequests.set(id, request);
    const clearRequest = () => {
      if (this.getRequests.get(id) === request) {
        this.getRequests.delete(id);
      }
    };
    void request.then(clearRequest, clearRequest);
    return request;
  }

  // The daemon owns watcher/monitoring start-up that the legacy main-process
  // `workspace:open` handler used to drive (see ~/src/intent .../workspace.ipc.ts
  // → protocolAdapter.getWorkspace), so resolving the workspace via `workspace.get`
  // is the parity-preserving wire shape; side effects are intentionally not
  // ported here per FE Iteration #1 scope.
  async open(id: string): Promise<Workspace | null> {
    return this.get(id);
  }

  // Mutations forward to the daemon (§7.1) and fold the outcome into a
  // MutationResult; daemon `workspace:*` events drive the reactive refresh.
  /**
   * `workspace.create` (§5.1): requires an idempotencyKey (§5.6); the daemon
   * ignores unknown params, so the full request is forwarded for
   * forward-compatibility. The daemon returns `{ workspace, initialAgent? }` —
   * the workspace is normalized and surfaced on the result so the creation
   * flow can hand callers the created entity without a follow-up read, and
   * `initialAgent` (the daemon-assigned agent projection, present when the
   * request carried an `initialAgent`) is surfaced verbatim so callers adopt
   * the daemon-assigned agent id instead of pre-minting one.
   */
  async create(request: CreateWorkspaceRequest): Promise<WorkspaceCreateResult> {
    try {
      const result = await backendRequest<{
        workspace?: unknown;
        initialAgent?: unknown;
        proposalOrigin?: unknown;
      }>(
        'workspace.create',
        {
          ...request,
          idempotencyKey: request.idempotencyKey ?? newIdempotencyKey(),
        },
        { timeoutMs: CREATE_TIMEOUT_MS },
      );
      const raw = result?.workspace;
      const rawAgent = result?.initialAgent;
      const proposalOrigin = parseProposalOrigin(result?.proposalOrigin);
      let initialAgent: ({ id: string } & Record<string, unknown>) | undefined;
      if (rawAgent !== undefined && rawAgent !== null) {
        // The daemon-assigned `initialAgent.id` is the only way callers can
        // address the created agent (no client id is sent). A present-but-
        // malformed projection is a wire divergence — fail loudly instead of
        // masking it as "no initialAgent".
        if (
          typeof rawAgent !== 'object' ||
          typeof (rawAgent as { id?: unknown }).id !== 'string' ||
          (rawAgent as { id: string }).id.length === 0
        ) {
          return {
            success: false,
            error: 'workspace.create returned an initialAgent without a valid daemon-assigned id',
          };
        }
        initialAgent = rawAgent as { id: string } & Record<string, unknown>;
      }
      return raw && typeof raw === 'object'
        ? {
            success: true,
            workspace: normalizeWorkspace(raw as Record<string, unknown>),
            ...(initialAgent ? { initialAgent } : {}),
            ...(proposalOrigin ? { proposalOrigin } : {}),
          }
        : { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const conflict = extractConflict(error);
      if (conflict) return { success: false, error: message, conflict };
      const errorCode = extractErrorCode(error);
      return errorCode
        ? { success: false, error: message, errorCode }
        : { success: false, error: message };
    }
  }

  /**
   * `workspace.update` (§5.1): the FE request `id` maps to the wire
   * `workspaceId`; the remaining fields are forwarded verbatim. The daemon
   * returns `{ workspace }` — normalized and surfaced on the result so callers
   * can upsert the authoritative entity without a follow-up `workspace.get`.
   */
  async update(request: UpdateWorkspaceRequest): Promise<WorkspaceUpdateResult> {
    const { id, ...fields } = request;
    try {
      const result = await backendRequest<{ workspace?: unknown }>('workspace.update', {
        workspaceId: id,
        ...fields,
      });
      const raw = result?.workspace;
      return raw && typeof raw === 'object'
        ? { success: true, workspace: normalizeWorkspace(raw as Record<string, unknown>) }
        : { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const conflict = extractConflict(error);
      if (conflict) return { success: false, error: message, conflict };
      return { success: false, error: message };
    }
  }

  /** Schedule or immediately commit a workspace deletion (§5.1). */
  async delete(id: string, options?: { undoDelayMs?: number }): Promise<WorkspaceDeleteResult> {
    const undoDelayMs = options?.undoDelayMs;
    try {
      const result = await backendRequest<{ scheduled?: unknown; deleteAt?: unknown }>(
        'workspace.delete',
        undoDelayMs && undoDelayMs > 0 ? { workspaceId: id, undoDelayMs } : { workspaceId: id },
        { timeoutMs: DELETE_TIMEOUT_MS },
      );
      const scheduled = result?.scheduled === true;
      const deleteAt = typeof result?.deleteAt === 'string' ? result.deleteAt : undefined;
      return scheduled && deleteAt
        ? { success: true, scheduled: true, deleteAt }
        : { success: true };
    } catch (error) {
      return { success: false, error: mutationErrorMessage(error) };
    }
  }

  /** Workspaces linked to a PR URL (`workspace.findByPullRequest`, §5.1). */
  async findByPullRequest(url: string): Promise<PullRequestWorkspace[]> {
    const result = await backendRequest<{ workspaces?: unknown }>('workspace.findByPullRequest', {
      url,
    });
    const rows = result?.workspaces;
    if (!Array.isArray(rows) || !rows.every(isPullRequestWorkspace)) {
      throw new Error('Invalid workspace.findByPullRequest response shape');
    }
    return rows;
  }

  /** Cancel a daemon-owned workspace delete grace window (§5.1). */
  async cancelDelete(id: string): Promise<WorkspaceCancelDeleteResult> {
    try {
      const result = await backendRequest<{ cancelled?: unknown }>('workspace.cancelDelete', {
        workspaceId: id,
      });
      return { success: true, cancelled: result?.cancelled === true };
    } catch (error) {
      return { success: false, error: mutationErrorMessage(error) };
    }
  }

  async archive(id: string): Promise<MutationResult> {
    return runMutation('workspace.archive', { workspaceId: id });
  }

  async unarchive(id: string): Promise<MutationResult> {
    return runMutation('workspace.unarchive', { workspaceId: id });
  }

  /** `workspace.retire` (§5.1): delete the folder, keep the rows read-only. */
  async retire(id: string): Promise<WorkspaceRetireResult> {
    try {
      const result = await backendRequest<{ workspace?: unknown }>('workspace.retire', {
        workspaceId: id,
      });
      const raw = result?.workspace;
      return {
        success: true,
        ...(raw && typeof raw === 'object'
          ? { workspace: normalizeWorkspace(raw as Record<string, unknown>) }
          : {}),
      };
    } catch (error) {
      const errorCode = extractErrorCode(error);
      return {
        success: false,
        error: mutationErrorMessage(error),
        ...(errorCode ? { errorCode } : {}),
      };
    }
  }

  // `workspace.markSeen` (§5.1) clears the unread `attention` flag only; the
  // daemon's `workspace:attention-changed` event drives the reactive clear.
  async markSeen(id: string): Promise<MutationResult> {
    return runMutation('workspace.markSeen', { workspaceId: id });
  }

  async setActive(id: string): Promise<MutationResult> {
    return runMutation('workspace.setActive', { workspaceId: id });
  }

  // Recency is renderer/daemon state not yet exposed by the daemon; empty for now.
  async recentViews(): Promise<Record<string, number>> {
    return {};
  }

  /**
   * `workspace.getTokenUsage` (PROTOCOL §5.23): the daemon-owned usage rollup
   * written by its internal scan job. `null` when the workspace is unknown or
   * the result shape is unexpected; updated rollups arrive via the
   * `workspace:tokenUsage-changed` event handled in `daemon-events-bridge`.
   */
  async getTokenUsage(workspaceId: string): Promise<TokenUsage | null> {
    const result = await backendRequest<{ tokenUsage?: unknown }>('workspace.getTokenUsage', {
      workspaceId,
    });
    const usage = result?.tokenUsage;
    return usage && typeof usage === 'object' ? parseTokenUsage(usage) : null;
  }

  /**
   * `workspace.diskUsage` (PROTOCOL §5.1): on-demand cached footprint of the
   * workspace's daemon-managed directory — `{ diskUsage?, refreshing }`.
   * `null` when the daemon predates the method (-32601 METHOD_NOT_FOUND) so
   * callers can fall back; every other error propagates.
   */
  async diskUsage(workspaceId: string): Promise<WorkspaceDiskUsageResult | null> {
    try {
      const result = await backendRequest<{
        diskUsage?: WorkspaceDiskUsage;
        refreshing?: boolean;
      }>('workspace.diskUsage', { workspaceId });
      const usage = result?.diskUsage;
      const poll: WorkspaceDiskUsageResult = { refreshing: result?.refreshing === true };
      if (usage && typeof usage === 'object') poll.diskUsage = usage;
      return poll;
    } catch (error) {
      if (
        error instanceof BackendError &&
        (error.rpcCode === -32601 || error.code === 'METHOD_NOT_FOUND')
      ) {
        return null;
      }
      throw error;
    }
  }

  /**
   * `workspace.getContext` (PROTOCOL §5.1): returns `{ items: ContextItem[] }`.
   * The daemon treats each item as an opaque blob (`{ id, ...extras }`) so
   * provider-specific fields (`identifier`, `number`, `favicon`, …) round-trip
   * verbatim; the FE keeps its `ContextItem` union as the source of truth.
   */
  async getContext(workspaceId: string): Promise<ContextItem[]> {
    const result = await backendRequest<{ items?: unknown[] }>('workspace.getContext', {
      workspaceId,
    });
    const items = Array.isArray(result?.items) ? result.items : [];
    return items.filter(isContextItem);
  }

  /**
   * `workspace.updateContext` (PROTOCOL §5.1): full-list replacement of the
   * workspace's chat-context items. Returns the persisted list verbatim.
   * The self-sufficient `workspace:context-changed` event is the primary
   * convergence path; the return value is surfaced for callers that need it.
   */
  async updateContext(workspaceId: string, items: ContextItem[]): Promise<ContextItem[]> {
    const result = await backendRequest<{ items?: unknown[] }>('workspace.updateContext', {
      workspaceId,
      items,
    });
    const next = Array.isArray(result?.items) ? result.items : [];
    return next.filter(isContextItem);
  }

  /** `workspace.getBrowserClient { workspaceId }` → `{ browserClient }` (REV-2). */
  async getBrowserClient(workspaceId: string): Promise<WorkspaceBrowserClient> {
    const result = await backendRequest<{ browserClient?: unknown }>('workspace.getBrowserClient', {
      workspaceId,
    });
    return requireBrowserClient(result?.browserClient, 'workspace.getBrowserClient');
  }

  /**
   * `workspace.setBrowserClient { workspaceId, clientId: string | null }` →
   * `{ browserClient }` (REV-2). `null` clears the pin; the daemon rejects a
   * `clientId` that never completed `client.hello` with -32602.
   */
  async setBrowserClient(
    workspaceId: string,
    clientId: string | null,
  ): Promise<WorkspaceBrowserClient> {
    const result = await backendRequest<{ browserClient?: unknown }>('workspace.setBrowserClient', {
      workspaceId,
      clientId,
    });
    return requireBrowserClient(result?.browserClient, 'workspace.setBrowserClient');
  }

  subscribe(handler: SubscriptionHandler<Workspace[]>): Unsubscribe {
    return createDeltaSubscription<Workspace>({
      // Typed §6.9 channel — the one GLOBAL channel (no workspaceId). Its
      // seq-0 snapshot includes archived workspaces (intentd#521).
      channel: {
        subscribeMethod: 'workspace.subscribe',
        unsubscribeMethod: 'workspace.unsubscribe',
      },
      getId: (raw) => String(raw.id ?? raw.workspaceId ?? ''),
      normalize: (raw) => normalizeWorkspace(raw),
      handler,
    });
  }
}
