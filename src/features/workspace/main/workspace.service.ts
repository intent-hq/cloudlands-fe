/**
 * Workspace Service
 *
 * Pure business logic for workspace operations.
 * Uses repository pattern for data access and event bus for notifications.
 */

import { BrowserWindow } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';


import * as Errors from '../../../shared/errors';
import { Logger } from '../../../shared/logger';
import { WorkspaceConfig } from '../../../shared/main/config';
import { getChangeHistoryForWorkspace } from './change-history-persistence';
import { getBackendClient } from '../../backend/main/backend.ipc';

import type {
  DiffChunk,
  Result,
  UpdateWorkspaceRequest,
  Workspace,
  WorkspaceMetadata,
  WorkspaceUIContext,
} from '../../../shared/types';
import {
  PullRequestStatus,
  WorkspaceStatus,
} from '../../../shared/types';
import {
  CHIEF_WORKSPACE_ID,
  type WorkspaceId,
} from '../../../shared/types/branded-ids';


import { mainDispatch } from '../../../store/main/redux-store-bridge';
import {
  workspaceCreated,
  workspaceUpdated,
  workspaceDeleting,
  workspaceDeleted,
  workspaceArchived,
} from '../../../store/main/slices/workspace-lifecycle-events/workspace-lifecycle-events-slice';
import {
  isValidWorkspaceIdFormat,
} from '../../../main/utils/workspace-validation';
import type { WorkspaceRepository } from './workspace.repository';
import { DaemonWorkspaceRepository, getChiefWorkspace } from './workspace.repository';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { WorkspaceNotFoundError, WorkspaceValidationError } = Errors;

const logger = new Logger('WorkspaceService');



type BackgroundEnrichmentWorkspaceUpdates = Partial<
  Pick<
    Workspace,
    | 'repositoryOwner'
    | 'repositoryName'
    | 'activePullRequest'
    | 'prStatus'
    | 'prNumber'
    | 'prUrl'
    | 'pullRequests'
  >
>;

export class WorkspaceService {
  // Metadata/UI-only cache: current-context snapshots are not Workspace JSON and are bounded by LRU.
  private lastContextCache: Map<string, WorkspaceUIContext> = new Map();
  private contextCacheOrder: string[] = []; // Track access order for LRU
  // Background enrichment coordination only stores workspace IDs/timestamps, never full Workspace JSON.
  private readonly pendingBackgroundEnrichment = new Set<WorkspaceId>();
  private readonly MAX_CONTEXT_CACHE_SIZE = 25; // Limit cache size to prevent unbounded growth
  private readonly backgroundEnrichmentQueue: WorkspaceId[] = [];
  private readonly dirtyBackgroundEnrichment = new Set<WorkspaceId>();
  private backgroundEnrichmentTimer: NodeJS.Timeout | null = null;
  private activeBackgroundEnrichmentCount = 0;
  // Coalesce rapid summary invalidations (git/note/agent events) into a single
  // enrichment pass per burst. Stores workspaceId -> latest reason; flushed on a
  // fixed-window timer so a continuous event stream cannot starve enrichment.
  private readonly pendingSummaryInvalidations = new Map<WorkspaceId, string>();
  private summaryInvalidationTimer: NodeJS.Timeout | null = null;
  private readonly SUMMARY_INVALIDATION_DEBOUNCE_MS = 100;
  private disposed = false;
  private readonly LIST_ENRICHMENT_CONCURRENCY = 3;
  private readonly BACKGROUND_ENRICHMENT_CONCURRENCY = 3;
  // Domain event listeners (workspace:deleted, note:created, note:deleted, git:status-changed)
  // are now handled by sagas in domain-event-listener-sagas.ts.

  // PERF: Track recently deleted workspace IDs to guard against zombie agent events
  // When a workspace is deleted, streaming agents may still send updates for a brief period
  // We use a Set with TTL-based cleanup to prevent these zombie events from triggering
  // expensive operations like updateWorkspace and listWorkspaces
  private recentlyDeletedWorkspaces = new Set<string>();
  private recentlyDeletedCleanupTimers = new Map<string, NodeJS.Timeout>();
  private readonly RECENTLY_DELETED_TTL = 60000; // 60 seconds - long enough for zombie events to settle

  constructor(
    private readonly repository: WorkspaceRepository = new DaemonWorkspaceRepository(),
  ) {
    // Domain event listeners (including task:status-changed) are now handled
    // by sagas in domain-event-listener-sagas.ts.
  }

  /**
   * Fetch a single workspace from the daemon via `workspace.get` (PROTOCOL.md §5.1).
   * Chief is synthesized locally to preserve the FE-side pinned-epoch shape without a
   * daemon round-trip. Returns `null` when the daemon has no such workspace (parity
   * with the retired disk repository `findById`).
   */
  private async fetchWorkspaceFromDaemon(id: WorkspaceId): Promise<Workspace | null> {
    if (id === CHIEF_WORKSPACE_ID) {
      return getChiefWorkspace();
    }
    try {
      const response = (await getBackendClient().request('workspace.get', {
        workspaceId: id,
      })) as { workspace?: unknown } | unknown;
      const raw =
        response && typeof response === 'object' && 'workspace' in response
          ? (response as { workspace?: unknown }).workspace
          : response;
      if (!raw || typeof raw !== 'object') return null;
      return this.normalizeDaemonWorkspace(raw as Record<string, unknown>);
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      // Missing-workspace surfaces as a JSON-RPC error; fold to `null` so callers
      // preserve the legacy `findById` contract instead of throwing.
      if (/not\s*found/i.test(message)) return null;
      throw error;
    }
  }

  /**
   * Fetch every workspace from the daemon via `workspace.list` (PROTOCOL.md §5.1).
   * `includeArchived` is forwarded so the daemon does the filtering rather than the
   * FE having to load-and-drop archived rows. Chief is never surfaced by the daemon
   * `workspace.list` — parity with the retired `findAll()` which relied on
   * `getChiefWorkspace()` being fetched via `findById` on demand.
   */
  private async fetchWorkspacesFromDaemon(includeArchived: boolean): Promise<Workspace[]> {
    const response = (await getBackendClient().request('workspace.list', {
      includeArchived,
    })) as { workspaces?: unknown[] };
    const rows = Array.isArray(response?.workspaces) ? response.workspaces : [];
    return rows.map((raw) =>
      this.normalizeDaemonWorkspace(raw as Record<string, unknown>),
    );
  }

  /**
   * Coerce a raw daemon workspace payload into the FE `Workspace` shape. The daemon
   * emits camelCase (per `intent-core::model::Workspace` serde config), so the spread
   * preserves every documented field verbatim; FE-only container arrays that the
   * daemon does not carry (`changesets`, `timeline`, `conversationInfo`) default to
   * empty so consumers can iterate without null checks. Renderer parity with
   * `src/lib/client/live/live-workspaces-client.ts::normalizeWorkspace`.
   */
  private normalizeDaemonWorkspace(raw: Record<string, unknown>): Workspace {
    const now = new Date().toISOString();
    const rawId = String(raw.id ?? raw.workspaceId ?? '');
    return {
      ...(raw as Partial<Workspace>),
      id: rawId as WorkspaceId,
      title: String(raw.title ?? raw.name ?? rawId),
      branch: String(raw.branch ?? ''),
      status: this.toWorkspaceStatus(raw.status),
      changesets: Array.isArray(raw.changesets)
        ? (raw.changesets as Workspace['changesets'])
        : [],
      timeline: Array.isArray(raw.timeline) ? (raw.timeline as Workspace['timeline']) : [],
      conversationInfo: Array.isArray(raw.conversationInfo)
        ? (raw.conversationInfo as Workspace['conversationInfo'])
        : [],
      createdAt: String(raw.createdAt ?? now),
      updatedAt: String(raw.updatedAt ?? now),
    } as Workspace;
  }

  private toWorkspaceStatus(value: unknown): WorkspaceStatus {
    switch (String(value).toLowerCase()) {
      case 'inactive':
        return WorkspaceStatus.Inactive;
      case 'archived':
        return WorkspaceStatus.Archived;
      case 'deleted':
        return WorkspaceStatus.Deleted;
      default:
        return WorkspaceStatus.Active;
    }
  }

  /**
   * Get diffs for a workspace from the changeHistory
   */
  private async getWorkspaceDiffs(workspaceId: string): Promise<DiffChunk[]> {
    try {
      return (await getChangeHistoryForWorkspace(workspaceId)) as unknown as DiffChunk[];
    } catch (error) {
      logger.error('Error loading diffs', error as Error, { workspaceId });
      return [];
    }
  }

  /**
   * Parse a git URL to extract owner and repository name
   */
  private parseGitUrl(url: string): {
    owner?: string;
    name?: string;
    url: string;
  } {
    try {
      // Handle SSH URLs: git@github.com:owner/repo.git (allow dots in repo name)
      const sshMatch = url.match(/git@([^:]+):([^\/]+)\/([^\/]+?)(?:\.git)?$/);
      if (sshMatch) {
        return {
          owner: sshMatch[2],
          name: sshMatch[3],
          url,
        };
      }

      // Handle HTTPS URLs: https://github.com/owner/repo.git (allow dots in repo name)
      const httpsMatch = url.match(/https?:\/\/([^\/]+)\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
      if (httpsMatch) {
        return {
          owner: httpsMatch[2],
          name: httpsMatch[3],
          url,
        };
      }

      return { url };
    } catch (error) {
      logger.error('Failed to parse git URL', error as Error, { url });
      return { url };
    }
  }

  /**
   * Extract git repository information from a directory path.
   * For remote workspaces, reads the git config via RPC instead of local filesystem.
   */
  private async getGitRepoInfo(
    repoPath: string,
    remoteContext?: {
      isRemote: boolean;
      workspaceId?: string;
    },
  ): Promise<{ owner?: string; name?: string; url?: string }> {
    try {
      // Use git.getConfig RPC when workspaceId is available (STAB-10b, intentd#159)
      const workspaceId = remoteContext?.workspaceId as WorkspaceId | undefined;
      const configContent = await this.repository.readGitConfig(repoPath, workspaceId);

      // Empty/missing config is the normal "no remote configured" case — not an error
      if (configContent === '' || configContent == null) {
        return {};
      }

      // Non-string content indicates a contract violation upstream
      if (typeof configContent !== 'string') {
        logger.warn('Invalid git config content', { repoPath, type: typeof configContent });
        return {};
      }

      const lines = configContent.split(/\r?\n/);
      const originIndex = lines.findIndex(
        (line: string) => typeof line === 'string' && line.includes('[remote "origin"]'),
      );

      if (originIndex === -1) {
        return {};
      }

      // Look for the URL in the next few lines
      for (let i = originIndex + 1; i < Math.min(originIndex + 5, lines.length); i++) {
        const line = lines[i];
        if (typeof line !== 'string') continue;

        const urlMatch = line.match(/^\s*url\s*=\s*(.+)$/);
        if (urlMatch) {
          const url = urlMatch[1].trim();
          return this.parseGitUrl(url);
        }
      }

      return {};
    } catch {
      // This is expected for non-git directories (e.g. temp paths, build-smoke repos)
      // so log at debug level rather than error to avoid log spam
      logger.debug('Failed to read git config', { repoPath });
      return {};
    }
  }

  /**
   * List all workspaces with optional pagination
   */
  async listWorkspaces(options?: {
    limit?: number;
    offset?: number;
    includeArchived?: boolean;
    lite?: boolean; // Defaults to true; pass false to opt into bounded list enrichment
  }): Promise<
    Result<{ workspaces: WorkspaceMetadata[]; total: number; hasMore: boolean }, string>
  > {
    try {
      // Daemon `workspace.list` (PROTOCOL.md §5.1) is the source of truth; the retired
      // disk repository `findAll()` is no longer consulted here. `includeArchived`
      // is forwarded so the daemon does the archive filtering server-side.
      const includeArchived = options?.includeArchived === true;
      const allWorkspaces = await this.fetchWorkspacesFromDaemon(includeArchived);

      // Deleted workspaces are never returned; the daemon already excludes them but
      // filter defensively so a future protocol change cannot leak tombstones. The
      // archived filter mirrors the daemon's `includeArchived` so callers that
      // request only active workspaces get the same rows either way.
      const filteredWorkspaces = allWorkspaces.filter((w) => {
        if (w.status === WorkspaceStatus.Deleted) {
          return false;
        }
        if (w.status === WorkspaceStatus.Archived && !includeArchived) {
          return false;
        }
        return true;
      });
      // `lastActivity` is now daemon-authoritative on every path that
      // returns a `Workspace` on the wire (PROTOCOL.md §5.1 / §9.1); the FE
      // no longer derives it here.
      const offset = options?.offset || 0;
      const limit = options?.limit || filteredWorkspaces.length;
      const paginatedWorkspaces = filteredWorkspaces.slice(offset, offset + limit);

      let sanitizedWorkspaces: WorkspaceMetadata[];
      // PERF: Default workspace lists to lite mode so startup and validation flows
      // never trigger unbounded per-workspace enrichment. Callers must opt into
      // full enrichment explicitly, and even then we cap concurrency.
      const useLiteMode = options?.lite ?? true;
      if (useLiteMode) {
        // PERF: In lite mode, skip heavy buildListWorkspace() computations.
        // Workspace payloads are metadata-only; diff/git/task summaries are
        // fetched on demand via dedicated endpoints.
        logger.debug('Using lite mode for workspace list - skipping heavy computations');

        // Fetch agent IDs with bounded concurrency — it's cheap (directory listings)
        // but we still don't want 200 concurrent reads.
        const AGENT_IDS_CONCURRENCY = 10;
        const agentIdsResults = new Array<string[]>(paginatedWorkspaces.length);
        let agentIdsNextIndex = 0;
        await Promise.all(
          Array.from(
            { length: Math.min(AGENT_IDS_CONCURRENCY, paginatedWorkspaces.length) },
            async () => {
              while (true) {
                const idx = agentIdsNextIndex++;
                if (idx >= paginatedWorkspaces.length) return;
                const paginatedWorkspace = paginatedWorkspaces[idx];
                if (!paginatedWorkspace) continue;
                agentIdsResults[idx] = await this.getWorkspaceAgentIds(
                  paginatedWorkspace.id,
                );
              }
            },
          ),
        );

        sanitizedWorkspaces = paginatedWorkspaces.map((workspace, i) =>
          this.toWorkspaceMetadata(workspace, agentIdsResults[i]),
        );
      } else {
        sanitizedWorkspaces = await this.buildListWorkspacesWithConcurrency(
          paginatedWorkspaces,
          this.LIST_ENRICHMENT_CONCURRENCY,
        );
      }

      // Hydrate repo/PR data incrementally in the background.
      // This keeps the bulk list response cheap while still filling in richer data.
      this.scheduleBackgroundEnrichment(sanitizedWorkspaces);

      return {
        ok: true,
        data: {
          workspaces: sanitizedWorkspaces,
          total: filteredWorkspaces.length,
          hasMore: offset + limit < filteredWorkspaces.length,
        },
      };
    } catch (error) {
      logger.error('Failed to list workspaces', error as Error);
      return {
        ok: false,
        error: this.extractErrorMessage(error),
      };
    }
  }

  /**
   * List all workspaces (backward compatibility)
   * Note: Returns ALL workspaces including archived ones.
   * The frontend is responsible for filtering based on the "Show archived" toggle.
   * @param options.lite When true, skip heavy computations to avoid blocking other IPC operations
   */
  async listAllWorkspaces(options?: {
    lite?: boolean;
  }): Promise<Result<WorkspaceMetadata[], string>> {
    const result = await this.listWorkspaces({ includeArchived: true, lite: options?.lite });
    if (result.ok) {
      return { ok: true, data: result.data.workspaces };
    }
    return { ok: false, error: (result as any).error };
  }

  private async buildListWorkspace(workspace: Workspace): Promise<WorkspaceMetadata> {
    // Workspace payloads are metadata-only: agent summary carries IDs only, and
    // diff/git/task summaries are served by dedicated on-demand endpoints.
    const agentIds = await this.getWorkspaceAgentIds(workspace.id);
    return this.toWorkspaceMetadata(workspace, agentIds);
  }

  private async buildListWorkspacesWithConcurrency(
    workspaces: Workspace[],
    concurrency: number,
  ): Promise<WorkspaceMetadata[]> {
    if (workspaces.length === 0) {
      return [];
    }

    const results = new Array<WorkspaceMetadata>(workspaces.length);
    let nextIndex = 0;
    const workerCount = Math.max(1, Math.min(concurrency, workspaces.length));

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (true) {
          const currentIndex = nextIndex++;
          if (currentIndex >= workspaces.length) {
            return;
          }

          const workspace = workspaces[currentIndex];
          if (!workspace) continue;
          results[currentIndex] = await this.buildListWorkspace(workspace);
        }
      }),
    );

    return results;
  }

  /**
   * Get the agent IDs for a workspace. Workspace payloads carry agent IDs only;
   * detailed agent state is served by agent endpoints.
   */
  private async getWorkspaceAgentIds(workspaceId: WorkspaceId): Promise<string[]> {
    try {
      // Route through the daemon (PROTOCOL.md §5.5 `agent.list`) and project
      // to the ids the workspace payload carries.
      const result = (await getBackendClient().request('agent.list', {
        workspaceId,
      })) as { agents?: Array<{ id: string }> };
      return (result?.agents ?? []).map((a) => a.id);
    } catch (error) {
      logger.warn('Failed to list agent IDs for workspace', {
        workspaceId,
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Convert a workspace to its metadata-only payload shape: high-frequency
   * summary fields are stripped and agent summary carries IDs only.
   */
  private toWorkspaceMetadata(workspace: Workspace, agentIds?: string[]): WorkspaceMetadata {
    const {
      diffs: _diffs,
      diffSummary: _diffSummary,
      agentSummary: _agentSummary,
      taskStats: _taskStats,
      gitSummary: _gitSummary,
      ...metadata
    } = workspace;

    return {
      ...metadata,
      ...(agentIds && agentIds.length > 0 ? { agentSummary: { agentIds } } : {}),
    };
  }

  /**
   * Strip high-frequency summary fields from a workspace so returned payloads
   * stay metadata-only. Fetch summaries on demand via dedicated endpoints.
   */
  private stripWorkspaceSummaries(workspace: Workspace): Workspace {
    const {
      diffs: _diffs,
      diffSummary: _diffSummary,
      agentSummary: _agentSummary,
      taskStats: _taskStats,
      gitSummary: _gitSummary,
      ...metadata
    } = workspace;

    return metadata;
  }

  private scheduleBackgroundEnrichment(workspaces: WorkspaceMetadata[]): void {
    const candidates = workspaces.filter((workspace) => this.workspaceNeedsEnrichment(workspace));

    if (candidates.length === 0) {
      return;
    }

    const candidateIds = candidates.map((workspace) => workspace.id);

    // Clear any existing timer to prevent multiple scheduled enrichments
    if (this.backgroundEnrichmentTimer) {
      clearTimeout(this.backgroundEnrichmentTimer);
    }

    this.backgroundEnrichmentTimer = setTimeout(() => {
      this.backgroundEnrichmentTimer = null;

      for (const workspaceId of candidateIds) {
        this.queueBackgroundEnrichment(workspaceId, 'list-load');
      }

      this.processBackgroundEnrichmentQueue();
    }, 0);
  }

  private invalidateWorkspaceSummaries(workspaceId: WorkspaceId, reason: string): void {
    if (this.disposed || this.recentlyDeletedWorkspaces.has(workspaceId)) {
      return;
    }

    // Coalesce rapid invalidations into one enrichment pass per burst. Keep the
    // latest reason for the workspace and arm a fixed-window timer (not reset on
    // subsequent calls) so a steady event stream still flushes regularly.
    this.pendingSummaryInvalidations.set(workspaceId, reason);
    if (!this.summaryInvalidationTimer) {
      this.summaryInvalidationTimer = setTimeout(
        () => this.flushPendingSummaryInvalidations(),
        this.SUMMARY_INVALIDATION_DEBOUNCE_MS,
      );
    }
  }

  private flushPendingSummaryInvalidations(): void {
    this.summaryInvalidationTimer = null;
    if (this.disposed) {
      this.pendingSummaryInvalidations.clear();
      return;
    }

    if (this.pendingSummaryInvalidations.size === 0) {
      return;
    }

    const pending = Array.from(this.pendingSummaryInvalidations.entries());
    this.pendingSummaryInvalidations.clear();

    for (const [workspaceId, reason] of pending) {
      if (this.recentlyDeletedWorkspaces.has(workspaceId)) {
        continue;
      }
      this.queueBackgroundEnrichment(workspaceId, reason);
    }

    this.processBackgroundEnrichmentQueue();
  }

  private queueBackgroundEnrichment(workspaceId: WorkspaceId, reason: string): void {
    if (this.disposed || this.recentlyDeletedWorkspaces.has(workspaceId)) {
      return;
    }

    if (this.pendingBackgroundEnrichment.has(workspaceId)) {
      this.dirtyBackgroundEnrichment.add(workspaceId);
      logger.debug('Marked workspace enrichment dirty while pending', { workspaceId, reason });
      return;
    }

    this.pendingBackgroundEnrichment.add(workspaceId);
    this.backgroundEnrichmentQueue.push(workspaceId);
    logger.debug('Queued background enrichment', { workspaceId, reason });
  }

  private workspaceNeedsEnrichment(workspace: WorkspaceMetadata): boolean {
    if (workspace.status === WorkspaceStatus.Archived) {
      return false;
    }

    const missingGitInfo =
      Boolean(workspace.repositoryPath) &&
      (!workspace.repositoryOwner || !workspace.repositoryName);

    const hasPersistedDiffs = false;

    return missingGitInfo || hasPersistedDiffs;
  }

  private processBackgroundEnrichmentQueue(): void {
    if (this.disposed) {
      this.backgroundEnrichmentQueue.length = 0;
      this.pendingBackgroundEnrichment.clear();
      return;
    }

    while (
      this.activeBackgroundEnrichmentCount < this.BACKGROUND_ENRICHMENT_CONCURRENCY &&
      this.backgroundEnrichmentQueue.length > 0
    ) {
      const workspaceId = this.backgroundEnrichmentQueue.shift();
      if (!workspaceId) {
        return;
      }

      this.activeBackgroundEnrichmentCount += 1;

      this.performBackgroundEnrichment(workspaceId)
        .catch((error) => {
          logger.error('Background workspace enrichment failed', error as Error, {
            workspaceId,
          });
        })
        .finally(() => {
          const shouldRequeue = this.dirtyBackgroundEnrichment.delete(workspaceId);
          this.pendingBackgroundEnrichment.delete(workspaceId);
          this.activeBackgroundEnrichmentCount = Math.max(
            0,
            this.activeBackgroundEnrichmentCount - 1,
          );
          if (shouldRequeue) {
            this.queueBackgroundEnrichment(workspaceId, 'dirty-rerun');
          }
          this.processBackgroundEnrichmentQueue();
        });
    }
  }

  private async broadcastBackgroundEnrichmentUpdate(
    workspaceId: WorkspaceId,
    updates: BackgroundEnrichmentWorkspaceUpdates,
  ): Promise<void> {
    if (this.disposed || Object.keys(updates).length === 0) {
      return;
    }

    try {
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send('workspace:background-enrichment-complete', {
            workspaceId,
            updates,
          });
        }
      }
    } catch (broadcastError) {
      logger.debug('Failed to broadcast enrichment update', {
        error: (broadcastError as Error).message,
      });
    }
  }

  private async performBackgroundEnrichment(workspaceId: WorkspaceId): Promise<void> {
    try {
      const workspace = await this.repository.findById(workspaceId);
      if (!workspace) {
        return;
      }

      const rendererUpdates: BackgroundEnrichmentWorkspaceUpdates = {};

      if (workspace.repositoryPath && (!workspace.repositoryOwner || !workspace.repositoryName)) {
        const gitInfo = await this.getGitRepoInfo(workspace.repositoryPath, {
          isRemote: !!workspace.isRemote,
          workspaceId: workspaceId as string,
        });

        const owner = workspace.repositoryOwner ?? gitInfo.owner;
        const name = workspace.repositoryName ?? gitInfo.name;

        if (owner !== workspace.repositoryOwner || name !== workspace.repositoryName) {
          rendererUpdates.repositoryOwner = owner;
          rendererUpdates.repositoryName = name;
        }
      }

      // Persistence is owned by the daemon (PROTOCOL.md §5.1); the FE no
      // longer writes background enrichment (git repo info) back to disk.
      // Broadcast keeps renderer state in sync until the next daemon refresh.
      await this.broadcastBackgroundEnrichmentUpdate(workspaceId, rendererUpdates);
    } catch (error) {
      logger.error('Background workspace enrichment failed', error as Error, { workspaceId });
    }
  }

  /**
   * Get the effective workspace path (worktree if exists, otherwise repository)
   */
  getEffectiveWorkspacePath(workspace: Workspace): string | undefined {
    // Return worktree path if it exists, otherwise fall back to repository path
    return workspace.worktreePath || workspace.repositoryPath;
  }

  /**
   * Get a single workspace
   */
  async getWorkspace(id: WorkspaceId): Promise<Result<Workspace, string>> {
    try {
      // Validate id parameter
      if (!id) {
        logger.error('getWorkspace called with undefined or null id');
        return {
          ok: false,
          error: 'Workspace ID is required',
        };
      }

      // Validate workspace ID format
      if (!isValidWorkspaceIdFormat(id)) {
        logger.error('Invalid workspace ID format', { id });
        return {
          ok: false,
          error: 'Invalid workspace ID format',
        };
      }

      if (id === CHIEF_WORKSPACE_ID) {
        const workspace = getChiefWorkspace();
        return { ok: true, data: workspace };
      }

      // Daemon `workspace.get` (PROTOCOL.md §5.1) is the source of truth; the
      // retired disk repository `findById()` is no longer consulted here.
      let workspace = await this.fetchWorkspaceFromDaemon(id);

      if (!workspace) {
        return {
          ok: false,
          error: 'Workspace not found',
        };
      }

      // Validate worktree path exists, clear it if not
      // Skip validation for remote workspaces — their worktree paths only exist on the SSH host
      if (
        workspace.worktreePath &&
        !workspace.isRemote &&
        workspace.environmentConfig?.type !== 'remote'
      ) {
        try {
          await fs.access(workspace.worktreePath);
          logger.debug('Worktree path exists', { worktreePath: workspace.worktreePath });
        } catch {
          logger.warn('Worktree path does not exist, clearing it', {
            workspaceId: id,
            worktreePath: workspace.worktreePath,
          });
          workspace = {
            ...workspace,
            worktreePath: undefined,
          };
        }
      } else if (
        workspace.worktreePath &&
        (workspace.isRemote || workspace.environmentConfig?.type === 'remote')
      ) {
        logger.debug('Skipping worktree path validation for remote workspace', {
          workspaceId: id,
          worktreePath: workspace.worktreePath,
        });
      }

      // Enrich with git info if missing and repositoryPath exists
      if (workspace.repositoryPath && (!workspace.repositoryOwner || !workspace.repositoryName)) {
        const gitInfo = await this.getGitRepoInfo(workspace.repositoryPath, {
          isRemote: !!workspace.isRemote,
          workspaceId: id as string,
        });
        if (gitInfo.owner || gitInfo.name) {
          const newOwner = workspace.repositoryOwner || gitInfo.owner;
          const newName = workspace.repositoryName || gitInfo.name;

          // Only update if values actually changed
          if (newOwner !== workspace.repositoryOwner || newName !== workspace.repositoryName) {
            workspace = {
              ...workspace,
              repositoryOwner: newOwner,
              repositoryName: newName,
            };
          }
        }
      }

      // Load diffs from changeHistory
      const diffs = await this.getWorkspaceDiffs(workspace.id);

      // Only update if diffs have actually changed
      const existingDiffsLength = workspace.diffs?.length || 0;
      const newDiffsLength = diffs.length;

      // Check if diffs are different (simple length check for now)
      // We could do a deeper comparison if needed
      if (newDiffsLength > 0 && newDiffsLength !== existingDiffsLength) {
        workspace = { ...workspace, diffs };
      } else if (newDiffsLength === 0 && existingDiffsLength > 0) {
        // Clear diffs if they were removed
        workspace = { ...workspace, diffs: [] };
      }

      // Enrichment is in-memory only. Persistence is owned by the daemon
      // (PROTOCOL.md §5.1); the FE no longer writes worktree/git/diffs
      // enrichment back to disk from a read path. Daemon gap: daemon should
      // validate worktree paths and own git repo info. Workspace payloads are
      // metadata-only; diff/git/task summaries are fetched on demand via
      // dedicated endpoints.
      return { ok: true, data: this.stripWorkspaceSummaries(workspace) };
    } catch (error) {
      logger.error('Failed to get workspace', error as Error, { workspaceId: id });
      return {
        ok: false,
        error: this.extractErrorMessage(error),
      };
    }
  }

  /**
   * Update a workspace
   *
   * Delegates persistence to the daemon (`workspace.update`, PROTOCOL.md §5.1);
   * the daemon owns `updatedAt` stamping and returns the canonical workspace.
   * FE-only request fields the daemon `WorkspaceUpdate` shape does not accept
   * (`prStatus`, `activePullRequest`, `pullRequests`) are stripped before the
   * wire call and re-applied to the returned merged workspace as a best-effort
   * so callers keep seeing them. Follow-up: extend daemon `WorkspaceUpdate`
   * (Audit E daemon gap).
   */
  async updateWorkspace(request: UpdateWorkspaceRequest): Promise<Result<Workspace, string>> {
    try {
      // PERF: Guard against zombie agent events trying to update recently deleted workspaces
      // This can happen when streaming agents continue to send updates after workspace deletion
      if (this.recentlyDeletedWorkspaces.has(request.id as string)) {
        logger.debug('Ignoring update for recently deleted workspace (zombie event)', {
          workspaceId: request.id,
        });
        return {
          ok: false,
          error: 'Workspace was recently deleted',
        };
      }

      // Get existing workspace (used for merge + PR-status/PR-link normalization)
      const existingResult = await this.getWorkspace(request.id as WorkspaceId);
      if (!existingResult.ok) {
        return existingResult;
      }

      const {
        id: _idIgnored,
        prStatus: requestedPrStatus,
        prUrl: requestedPrUrl,
        activePullRequest: requestedActivePr,
        pullRequests: requestedPullRequests,
        ...rest
      } = request as UpdateWorkspaceRequest & { [k: string]: unknown };

      // Normalize PR URL (convert empty string to null so daemon clears it)
      let normalizedPrUrl: string | null | undefined;
      if (requestedPrUrl !== undefined) {
        normalizedPrUrl =
          requestedPrUrl === null || requestedPrUrl === '' ? null : requestedPrUrl;
      }

      // Build daemon payload. `updatedAt` is stamped daemon-side; do NOT send it.
      // Fields not present in daemon `WorkspaceUpdate` are omitted here.
      const daemonParams: Record<string, unknown> = {
        workspaceId: request.id,
        ...(rest as Record<string, unknown>),
      };
      if (requestedPrUrl !== undefined) {
        daemonParams.prUrl = normalizedPrUrl;
      }

      const response = (await getBackendClient().request('workspace.update', daemonParams)) as
        | { workspace?: unknown }
        | undefined;
      const rawWorkspace = response && typeof response === 'object' ? response.workspace : undefined;
      if (!rawWorkspace || typeof rawWorkspace !== 'object') {
        return {
          ok: false,
          error: 'Workspace not found',
        };
      }
      const daemonWorkspace = this.normalizeDaemonWorkspace(
        rawWorkspace as Record<string, unknown>,
      );

      // Merge: daemon response is authoritative for fields it owns; FE-only
      // request fields (prStatus, activePullRequest, pullRequests) are applied
      // on top so callers see them. Existing data provides fallback for any
      // fields the daemon may drop from its `workspace.update` response.
      const merged: Workspace = this.stripWorkspaceSummaries({
        ...existingResult.data,
        ...daemonWorkspace,
      });

      // The daemon may echo cleared optional fields as `null` on the wire; the
      // FE `Workspace` type expects `string | undefined` / `number | undefined`
      // for these, so coerce nulls back to `undefined` before returning.
      if ((merged.prUrl as unknown) === null) merged.prUrl = undefined;
      if ((merged.prNumber as unknown) === null) merged.prNumber = undefined;

      if (requestedPrStatus !== undefined) {
        if (requestedPrStatus === null) {
          merged.prStatus = undefined;
        } else if (typeof requestedPrStatus === 'string') {
          const s = requestedPrStatus.toLowerCase();
          if (s === 'open') merged.prStatus = PullRequestStatus.Open;
          else if (s === 'closed') merged.prStatus = PullRequestStatus.Closed;
          else if (s === 'merged') merged.prStatus = PullRequestStatus.Merged;
          else if (s === 'draft') merged.prStatus = PullRequestStatus.Draft;
        } else {
          merged.prStatus = requestedPrStatus as PullRequestStatus;
        }
      }
      if (requestedActivePr !== undefined) {
        merged.activePullRequest = requestedActivePr === null ? undefined : requestedActivePr;
      }
      if (requestedPullRequests !== undefined) {
        merged.pullRequests = requestedPullRequests ?? [];
      }

      // Emit event
      mainDispatch(
        workspaceUpdated({
          workspaceId: merged.id,
          changes: request,
        }),
      );

      logger.info('Workspace updated', {
        workspaceId: merged.id,
        changedFields: Object.keys(rest).filter((k) => k !== 'id'),
        ...(request.title !== undefined ? { newTitle: request.title } : {}),
      });

      return { ok: true, data: merged };
    } catch (error) {
      logger.error('Failed to update workspace', error as Error, { workspaceId: request.id });
      return {
        ok: false,
        error: this.extractErrorMessage(error),
      };
    }
  }

  /**
   * Duplicate a workspace
   *
   * Delegates to the daemon (`workspace.duplicate`, PROTOCOL.md §5.1). The
   * daemon owns fresh-id allocation, worktree provisioning, spec seeding, and
   * non-spec note copy; the FE only forwards the request and emits its local
   * lifecycle event so redux consumers observe the new row.
   */
  async duplicateWorkspace(id: WorkspaceId, newTitle?: string): Promise<Result<Workspace, string>> {
    try {
      logger.info('Starting duplication of workspace', { workspaceId: id });

      const response = (await getBackendClient().request('workspace.duplicate', {
        workspaceId: id,
        ...(newTitle ? { newTitle } : {}),
      })) as { workspace?: unknown } | unknown;
      const raw =
        response && typeof response === 'object' && 'workspace' in response
          ? (response as { workspace?: unknown }).workspace
          : response;
      if (!raw || typeof raw !== 'object') {
        return { ok: false, error: 'Daemon returned an invalid workspace payload' };
      }
      const newWorkspace = this.normalizeDaemonWorkspace(raw as Record<string, unknown>);

      mainDispatch(
        workspaceCreated({
          workspaceId: newWorkspace.id,
          workspace: newWorkspace,
        }),
      );

      logger.info('Workspace duplicated successfully', {
        sourceId: id,
        newId: newWorkspace.id,
        title: newWorkspace.title,
      });

      return { ok: true, data: newWorkspace };
    } catch (error) {
      logger.error('Error duplicating workspace', error as Error, { workspaceId: id });
      return { ok: false, error: this.extractErrorMessage(error) };
    }
  }

  /**
   * Delete a workspace
   */
  async deleteWorkspace(id: WorkspaceId): Promise<Result<void, string>> {
    try {
      // Validate workspace ID
      if (!id || !isValidWorkspaceIdFormat(id)) {
        logger.error('Invalid workspace ID for deletion', { id });
        return {
          ok: false,
          error: 'Invalid workspace ID',
        };
      }

      logger.info('Starting deletion of workspace', { workspaceId: id });

      // Emit pre-delete event to allow cleanup
      mainDispatch(
        workspaceDeleting({
          workspaceId: id,
        }),
      );

      // Worktree removal is owned by the daemon: `workspace.delete` sweeps
      // local worktrees itself (PROTOCOL.md §5.1).
      const worktreeWorkspaceResult = await this.getWorkspace(id as WorkspaceId);
      if (worktreeWorkspaceResult.ok && worktreeWorkspaceResult.data.skipWorktree) {
        logger.info('Skipping git worktree removal for direct-branch mode workspace', {
          workspaceId: id,
        });
      }

      // Daemon `workspace.delete` (PROTOCOL.md §5.1) is authoritative for the
      // workspace row and now owns local git-worktree removal alongside the
      // cascade over agents/notes. The daemon treats a missing row as
      // idempotent success.
      await getBackendClient().request('workspace.delete', { workspaceId: id });

      // Emit event
      mainDispatch(
        workspaceDeleted({
          workspaceId: id,
        }),
      );

      logger.info('Workspace deleted successfully', { workspaceId: id });

      return { ok: true, data: undefined };
    } catch (error) {
      logger.error('Error deleting workspace', error as Error, { workspaceId: id });
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error);
      return {
        ok: false,
        error: errorMessage || 'Failed to delete workspace',
      };
    }
  }

  /**
   * Archive a workspace (mark as archived)
   *
   * Delegates to the daemon (`workspace.archive`, PROTOCOL.md §5.1). The daemon
   * flips `status`/`archived`/`archivedAt`/`updatedAt` server-side and emits
   * `workspace:updated`. The current router returns `{ success: true }` and
   * discards the daemon-service `Workspace` return value; the FE refetches via
   * `workspace.get` so callers still receive the canonical workspace payload.
   * Follow-up: return the workspace from the archive/unarchive router arms
   * (Audit E daemon gap).
   */
  async archiveWorkspace(id: WorkspaceId): Promise<Result<Workspace, string>> {
    try {
      const workspaceResult = await this.getWorkspace(id as WorkspaceId);
      if (!workspaceResult.ok) {
        return workspaceResult;
      }

      await getBackendClient().request('workspace.archive', { workspaceId: id });

      // Refetch to get the daemon-canonical workspace (server-stamped timestamps
      // and archived flags). Fall back to a locally-derived shape if the refetch
      // fails so the FE contract still holds.
      let workspace = await this.fetchWorkspaceFromDaemon(id);
      if (!workspace) {
        const now = new Date().toISOString();
        workspace = {
          ...workspaceResult.data,
          status: WorkspaceStatus.Archived,
          archived: true,
          archivedAt: now,
          updatedAt: now,
        };
      }

      // Emit event
      mainDispatch(
        workspaceArchived({
          workspaceId: id,
        }),
      );

      logger.info('Workspace archived', { workspaceId: id });

      return { ok: true, data: workspace };
    } catch (error) {
      logger.error('Failed to archive workspace', error as Error, { workspaceId: id });
      return {
        ok: false,
        error: this.extractErrorMessage(error),
      };
    }
  }

  /**
   * Unarchive a workspace
   *
   * Delegates to the daemon (`workspace.unarchive`, PROTOCOL.md §5.1). Same
   * refetch pattern as `archiveWorkspace`; see the doc comment there for the
   * router-return daemon gap.
   */
  async unarchiveWorkspace(id: WorkspaceId): Promise<Result<Workspace, string>> {
    try {
      const workspaceResult = await this.getWorkspace(id as WorkspaceId);
      if (!workspaceResult.ok) {
        return workspaceResult;
      }

      await getBackendClient().request('workspace.unarchive', { workspaceId: id });

      let workspace = await this.fetchWorkspaceFromDaemon(id);
      if (!workspace) {
        workspace = {
          ...workspaceResult.data,
          status: WorkspaceStatus.Active,
          archived: false,
          archivedAt: undefined,
          updatedAt: new Date().toISOString(),
        };
      }

      // Emit event
      mainDispatch(
        workspaceUpdated({
          workspaceId: id,
          changes: { archived: false },
        }),
      );

      logger.info('Workspace unarchived', { workspaceId: id });

      return { ok: true, data: workspace };
    } catch (error) {
      logger.error('Failed to unarchive workspace', error as Error, { workspaceId: id });
      return {
        ok: false,
        error: this.extractErrorMessage(error),
      };
    }
  }

  /**
   * Restore an archived workspace.
   *
   * Delegates to the daemon (`workspace.restore`, PROTOCOL.md §5.1), which is
   * a semantic alias of `workspace.unarchive` returning the refreshed
   * `Workspace`. The FE emits `workspaceUpdated` so redux consumers observe
   * the archived → active transition.
   */
  async restoreWorkspace(id: WorkspaceId): Promise<Result<Workspace, string>> {
    try {
      const response = (await getBackendClient().request('workspace.restore', {
        workspaceId: id,
      })) as { workspace?: unknown } | unknown;
      const raw =
        response && typeof response === 'object' && 'workspace' in response
          ? (response as { workspace?: unknown }).workspace
          : response;
      if (!raw || typeof raw !== 'object') {
        return { ok: false, error: 'Daemon returned an invalid workspace payload' };
      }
      const workspace = this.normalizeDaemonWorkspace(raw as Record<string, unknown>);

      mainDispatch(
        workspaceUpdated({
          workspaceId: id,
          changes: { archived: false, status: WorkspaceStatus.Active },
        }),
      );

      logger.info('Workspace restored', { workspaceId: id });

      return { ok: true, data: workspace };
    } catch (error) {
      logger.error('Failed to restore workspace', error as Error, { workspaceId: id });
      return { ok: false, error: this.extractErrorMessage(error) };
    }
  }

  /**
   * Cleanup workspace (remove temporary files, cache, etc.)
   *
   * Delegates to the daemon (`workspace.cleanup`, PROTOCOL.md §5.1). The
   * daemon sweeps the workspace cache directory and runs `git gc` on the
   * local worktree; the FE no longer touches disk or shells out to git here.
   */
  async cleanupWorkspace(id: WorkspaceId): Promise<Result<void, string>> {
    try {
      logger.info('Cleaning up workspace', { workspaceId: id });
      await getBackendClient().request('workspace.cleanup', { workspaceId: id });
      logger.info('Workspace cleanup completed', { workspaceId: id });
      return { ok: true, data: undefined };
    } catch (error) {
      logger.error('Failed to cleanup workspace', error as Error, { workspaceId: id });
      return {
        ok: false,
        error: this.extractErrorMessage(error),
      };
    }
  }

  /**
   * Migrate workspaces from ~/intent/{id} to ~/intent/workspaces/{id}.
   * For workspaces that exist in both locations, merges the .workspace/ metadata
   * (~/intent/{id}/.workspace/ is authoritative) and removes the old location.
   * Should be called once at startup.
   */
  async migrateWorkspacesToCanonicalLocation(): Promise<{
    migrated: number;
    errors: number;
  }> {
    let migrated = 0;
    let errors = 0;

    const workspaceRoot = WorkspaceConfig.WORKSPACE_ROOT;
    const workspacesBase = WorkspaceConfig.WORKSPACES_BASE;

    // Ensure canonical target directory exists
    await fs.mkdir(workspacesBase, { recursive: true });

    let entries: { name: string; isDirectory: () => boolean }[];
    try {
      entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
    } catch {
      return { migrated, errors };
    }

    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        !WorkspaceConfig.isValidWorkspaceId(entry.name) ||
        WorkspaceConfig.isVirtualWorkspace(entry.name)
      ) {
        continue;
      }

      const id = entry.name;
      const sourcePath = path.join(workspaceRoot, id);
      const targetPath = path.join(workspacesBase, id);

      try {
        const targetExists = await fs
          .access(targetPath)
          .then(() => true)
          .catch(() => false);

        if (targetExists) {
          // Target already exists -- merge .workspace/ metadata from source to target.
          // Source (~/intent/{id}/.workspace/) is authoritative.
          const sourceMetadata = path.join(sourcePath, WorkspaceConfig.METADATA_FOLDER);
          const sourceMetadataExists = await fs
            .access(sourceMetadata)
            .then(() => true)
            .catch(() => false);

          if (sourceMetadataExists) {
            const targetMetadata = path.join(targetPath, WorkspaceConfig.METADATA_FOLDER);
            await this.mergeDirectoryRecursive(sourceMetadata, targetMetadata);
          }

          // Remove the old location
          await fs.rm(sourcePath, { recursive: true, force: true });
          migrated++;
          logger.info('Migrated workspace (merged)', { id, from: sourcePath, to: targetPath });
        } else {
          // Target doesn't exist -- move the whole directory
          await fs.rename(sourcePath, targetPath);
          migrated++;
          logger.info('Migrated workspace (moved)', { id, from: sourcePath, to: targetPath });
        }
      } catch (err) {
        errors++;
        logger.warn('Failed to migrate workspace', { id, error: err });
      }
    }

    if (migrated > 0 || errors > 0) {
      logger.info('Workspace migration completed', { migrated, errors });
    }

    return { migrated, errors };
  }

  /**
   * Recursively copy contents of source directory into target directory.
   * Files in source overwrite files in target (source is authoritative).
   */
  private async mergeDirectoryRecursive(source: string, target: string): Promise<void> {
    await fs.mkdir(target, { recursive: true });
    const entries = await fs.readdir(source, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(source, entry.name);
      const tgtPath = path.join(target, entry.name);

      if (entry.isDirectory()) {
        await this.mergeDirectoryRecursive(srcPath, tgtPath);
      } else {
        await fs.copyFile(srcPath, tgtPath);
      }
    }
  }

  /**
   * Find repositories in a directory
   *
   * Delegates to the daemon (`workspace.findRepositories`, PROTOCOL.md §5.1).
   * The daemon performs the recursive git-repository scan; the FE only
   * forwards the request.
   */
  async findRepositories(directory: string): Promise<Result<string[], string>> {
    try {
      const response = (await getBackendClient().request('workspace.findRepositories', {
        directory,
      })) as { repositories?: unknown };
      const repositories = Array.isArray(response?.repositories)
        ? (response.repositories as unknown[]).filter(
            (r): r is string => typeof r === 'string',
          )
        : [];
      return { ok: true, data: repositories };
    } catch (error) {
      return {
        ok: false,
        error: this.extractErrorMessage(error),
      };
    }
  }

  // Private helper methods

  /**
   * Extract error message consistently from various error types
   */
  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    if (error && typeof error === 'object' && 'message' in error) {
      return String(error.message);
    }
    return 'Unknown error occurred';
  }

  /**
   * Update context cache with proper LRU eviction
   */
  private updateContextCache(workspaceId: string, context: WorkspaceUIContext): void {
    // Remove from current position if exists
    const index = this.contextCacheOrder.indexOf(workspaceId);
    if (index > -1) {
      this.contextCacheOrder.splice(index, 1);
    }

    // Add to end (most recently used)
    this.contextCacheOrder.push(workspaceId);
    this.lastContextCache.set(workspaceId, context);

    // Enforce cache size limit with LRU eviction
    while (
      this.lastContextCache.size > this.MAX_CONTEXT_CACHE_SIZE &&
      this.contextCacheOrder.length > 0
    ) {
      const lruId = this.contextCacheOrder.shift();
      if (lruId && this.lastContextCache.has(lruId)) {
        this.lastContextCache.delete(lruId);
        logger.debug('Evicted context from cache (LRU)', { workspaceId: lruId });
      }
    }
  }

  /**
   * Clear cache entries for a deleted workspace
   */
  private clearWorkspaceCache(workspaceId: WorkspaceId): void {
    // Remove from cache
    this.lastContextCache.delete(workspaceId);
    this.dirtyBackgroundEnrichment.delete(workspaceId);

    // Remove from order tracking
    const index = this.contextCacheOrder.indexOf(workspaceId);
    if (index > -1) {
      this.contextCacheOrder.splice(index, 1);
    }

    let queueIndex = this.backgroundEnrichmentQueue.indexOf(workspaceId);
    while (queueIndex > -1) {
      this.backgroundEnrichmentQueue.splice(queueIndex, 1);
      queueIndex = this.backgroundEnrichmentQueue.indexOf(workspaceId);
    }

    // Cancel any pending background enrichment for this workspace
    this.pendingBackgroundEnrichment.delete(workspaceId);
    this.pendingSummaryInvalidations.delete(workspaceId);

    logger.debug('Cleared workspace cache', { workspaceId });
  }

  /**
   * Drop heavyweight in-memory caches for workspaces that no window/tab reports as open.
   * Persisted workspace data is untouched; closed workspaces will be re-read on demand.
   */
  public trimCachesToOpenWorkspaces(openWorkspaceIds: Iterable<string>): void {
    const openWorkspaceIdSet = new Set(openWorkspaceIds);
    let evictedContexts = 0;

    for (const workspaceId of Array.from(this.lastContextCache.keys())) {
      if (!openWorkspaceIdSet.has(workspaceId)) {
        this.clearWorkspaceCache(workspaceId as WorkspaceId);
        evictedContexts += 1;
      }
    }

    if (evictedContexts > 0) {
      logger.debug('Trimmed workspace metadata caches to open workspaces', {
        evictedContexts,
        openWorkspaceCount: openWorkspaceIdSet.size,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Public handlers for domain event sagas (replaces onDomainEvent listeners)
  // ---------------------------------------------------------------------------

  /** Handle workspace:deleted domain event (saga entry point). */
  public onWorkspaceDeleted({ workspaceId }: { workspaceId: WorkspaceId }): void {
    this.clearWorkspaceCache(workspaceId);
    this.recentlyDeletedWorkspaces.add(workspaceId);
    const existingTimer = this.recentlyDeletedCleanupTimers.get(workspaceId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const cleanupTimer = setTimeout(() => {
      this.recentlyDeletedWorkspaces.delete(workspaceId);
      this.recentlyDeletedCleanupTimers.delete(workspaceId);
      logger.debug('Cleared workspace from recently deleted tracking', { workspaceId });
    }, this.RECENTLY_DELETED_TTL);
    this.recentlyDeletedCleanupTimers.set(workspaceId, cleanupTimer);
  }

  /** Handle note:created domain event (saga entry point). */
  public onNoteCreated({
    workspaceId,
    note,
  }: {
    workspaceId: WorkspaceId;
    note?: { metadata?: any };
  }): void {
    if (!workspaceId) return;
    if (note?.metadata?.task || note == null) {
      this.invalidateWorkspaceSummaries(workspaceId, 'note-created');
    }
  }

  /** Handle note:deleted domain event (saga entry point). */
  public onNoteDeleted({ workspaceId }: { workspaceId: WorkspaceId }): void {
    if (!workspaceId) return;
    this.invalidateWorkspaceSummaries(workspaceId, 'note-deleted');
  }

  /** Handle git:status-changed domain event (saga entry point). */
  public onGitStatusChanged({ workspaceId }: { workspaceId: WorkspaceId }): void {
    if (!workspaceId) return;
    this.invalidateWorkspaceSummaries(workspaceId, 'git-status-changed');
  }

  /** Handle agent lifecycle events (created/deleted/idle/status-changed/completed/failed). */
  public onAgentLifecycleChanged({ workspaceId }: { workspaceId: WorkspaceId }): void {
    if (!workspaceId) return;
    this.invalidateWorkspaceSummaries(workspaceId, 'agent-lifecycle-changed');
  }

  /**
   * Cleanup service resources (timers, listeners, etc.)
   */
  public cleanup(): void {
    this.disposed = true;

    // Remove event listeners
    // Domain event listeners (workspace:deleted, note:created, note:deleted, git:status-changed)
    // are now handled by sagas — no offDomainEvent cleanup needed here.

    // Clear background enrichment timer
    if (this.backgroundEnrichmentTimer) {
      clearTimeout(this.backgroundEnrichmentTimer);
      this.backgroundEnrichmentTimer = null;
    }

    // Clear pending summary invalidation debounce
    if (this.summaryInvalidationTimer) {
      clearTimeout(this.summaryInvalidationTimer);
      this.summaryInvalidationTimer = null;
    }
    this.pendingSummaryInvalidations.clear();

    // Clear all pending background enrichments
    this.pendingBackgroundEnrichment.clear();
    this.backgroundEnrichmentQueue.length = 0;
    this.activeBackgroundEnrichmentCount = 0;
    this.dirtyBackgroundEnrichment.clear();
    for (const timeout of this.recentlyDeletedCleanupTimers.values()) {
      clearTimeout(timeout);
    }
    this.recentlyDeletedCleanupTimers.clear();
    this.recentlyDeletedWorkspaces.clear();

    // Clear metadata/UI-only caches.
    this.lastContextCache.clear();
    this.contextCacheOrder = [];

    logger.debug('WorkspaceService cleaned up');
  }

  private async saveWorkspace(workspace: Workspace): Promise<void> {
    const sanitizedWorkspace: Workspace = {
      ...workspace,
      diffs: undefined,
      diffSummary: undefined,
    };

    await this.repository.save(sanitizedWorkspace);
  }

  /**
   * Update the current UI context for a workspace
   * This should be called whenever the user navigates to a different file/note/diff
   */
  async updateCurrentContext(
    workspaceId: WorkspaceId,
    context: WorkspaceUIContext,
  ): Promise<Result<void, string>> {
    try {
      // Check if context has actually changed (excluding lastUpdated timestamp)
      const lastContext = this.lastContextCache.get(workspaceId);
      if (lastContext) {
        const contextWithoutTimestamp = { ...context, lastUpdated: '' };
        const lastContextWithoutTimestamp = { ...lastContext, lastUpdated: '' };

        if (
          JSON.stringify(contextWithoutTimestamp) === JSON.stringify(lastContextWithoutTimestamp)
        ) {
          // Removed debug log - too frequent
          return { ok: true, data: undefined };
        }
      }

      // Save context using repository
      await this.repository.saveContext(workspaceId, context);

      // Update cache with proper LRU eviction
      this.updateContextCache(workspaceId, context);

      logger.debug('Updated current context', { workspaceId, context });

      return { ok: true, data: undefined };
    } catch (error) {
      logger.error('Failed to update current context', error as Error, { workspaceId });
      const message = `Failed to update current context for workspace ${workspaceId}: ${this.extractErrorMessage(error)}`;
      return { ok: false, error: message };
    }
  }

  /**
   * Get the current UI context for a workspace
   * Returns cached context if available, otherwise reads from disk
   */
  async getCurrentContext(workspaceId: WorkspaceId): Promise<WorkspaceUIContext | null> {
    try {
      // Check in-memory cache first (fast path)
      const cached = this.lastContextCache.get(workspaceId);
      if (cached) {
        logger.debug('Returning cached current context', { workspaceId });
        return cached;
      }

      // Fallback to reading from disk (e.g., after app restart)
      logger.debug('Reading current context from disk', { workspaceId });
      const context = await this.repository.readContext(workspaceId);

      // Update cache if we found context on disk
      if (context) {
        this.updateContextCache(workspaceId, context);
      }

      return context;
    } catch (error) {
      logger.error('Failed to get current context', error as Error, { workspaceId });
      return null;
    }
  }
}

// Export singleton instance
export const workspaceService = new WorkspaceService();
