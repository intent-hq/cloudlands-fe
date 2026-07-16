/**
 * Workspace Service
 *
 * Pure business logic for workspace operations.
 * Uses repository pattern for data access and event bus for notifications.
 */

import { BrowserWindow } from 'electron';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as fsExtra from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { DEFAULT_AGENT_MODEL } from '../../../shared/constants/agent-services';
import {
  createCompoundModelId,
  getDefaultModelForProvider,
  getDefaultProviderId,
  PROVIDER_MODEL_TIERS,
} from '../../../shared/config/provider-config';
import * as Errors from '../../../shared/errors';
import {
  execAsync,
  execFileAsync,
  getConfiguredSshKeyPath,
} from '../../../shared/git/git-env';
import { findParentGitDir } from '../../../shared/git/git-utils';
import { Logger } from '../../../shared/logger';
import { WorkspaceConfig } from '../../../shared/main/config';
import { addRepo } from './repo-registry';
import { getChangeHistoryForWorkspace } from './change-history-persistence';
import { getBackendClient } from '../../backend/main/backend.ipc';
import type { JsonRpcNotification } from '../../backend/main/json-rpc-client';
import {
  unifiedIdService,
  type UnifiedIdService,
} from '../../../shared/services/unified-id.service';
import { matchesBaseRef } from '../../../shared/services/baseref-matching';
import type {
  CreateWorkspaceRequest,
  DiffChunk,
  Result,
  UpdateWorkspaceRequest,
  Workspace,
  WorkspaceMetadata,
  WorkspaceUIContext,
} from '../../../shared/types';
import {
  AgentStatus,
  PullRequestStatus,
  WorkspaceStatus,
} from '../../../shared/types';
import {
  CHIEF_WORKSPACE_ID,
  type WorkspaceId,
} from '../../../shared/types/branded-ids';
import {
  refreshSpecialistsFromFiles,
  resolveSpecialistForAgent,
} from '../../agent/main/specialists.service';
import { mainDispatch } from '../../../store/main/redux-store-bridge';
import {
  workspaceCreated,
  workspaceUpdated,
  workspaceDeleting,
  workspaceDeleted,
  workspaceArchived,
} from '../../../store/main/slices/workspace-lifecycle-events/workspace-lifecycle-events-slice';
import { createTerminalFromBackend } from '../../terminal/main/terminal.ipc';
import {
  appendSlugSuffix,
  extractBaseSlug,
} from '../../../shared/services/workspace-slug';
import {
  parseBranchName,
  parseRemoteBranchName,
  createSlugPattern,
  createSuffixCapturePattern,
} from './git-branch-utils';
import { generateLocalSlug } from './local-slug-generator';
import {
  isValidWorkspaceIdFormat,
  isValidWorkspaceTitle,
  validateBranchName,
  validateRepositoryPath,
} from '../../../main/utils/workspace-validation';
import type { WorkspaceRepository } from './workspace.repository';
import { DaemonWorkspaceRepository, getChiefWorkspace } from './workspace.repository';
import {
  getBranchPrefix,
  getWorktreesLocation,
} from './app-settings.service';
import {
  getRepoBranchPrefix,
  getRepoSetupScript,
} from './repo-config.service';
import {
  sshManager,
  type SSHConnectionConfig,
} from '../../../shared/main/ssh-manager';
import { trackMain } from '$lib/services/analytics/main';
import { githubService } from '../../git-tracking/main/github.service';

/**
 * Escape a value for safe inclusion in a POSIX shell command.
 * Uses single quotes and escapes any embedded single quotes.
 */
function escapeShellArg(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { WorkspaceNotFoundError, WorkspaceValidationError, GitWorktreeError } = Errors;

const logger = new Logger('WorkspaceService');

/**
 * Expand tilde (~) in paths to the actual home directory
 */
function expandHomePath(inputPath: string): string {
  if (inputPath.startsWith('~/')) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || require('os').homedir();
    return path.join(homeDir, inputPath.slice(2));
  }
  if (inputPath === '~') {
    return process.env.HOME || process.env.USERPROFILE || require('os').homedir();
  }
  return inputPath;
}

/** Map a PullRequest.state string to PullRequestStatus enum */
const PR_STATE_TO_STATUS: Record<string, PullRequestStatus> = {
  open: PullRequestStatus.Open,
  closed: PullRequestStatus.Closed,
  merged: PullRequestStatus.Merged,
  draft: PullRequestStatus.Draft,
};

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

function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
    .join(',')}}`;
}

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
  private periodicPRRefreshTimer: NodeJS.Timeout | null = null;
  private periodicPRRefreshInitialTimeout: NodeJS.Timeout | null = null;
  private periodicPRStaggeredTimeouts: NodeJS.Timeout[] = [];
  private disposed = false;
  private readonly PR_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
  private readonly LIST_ENRICHMENT_CONCURRENCY = 3;
  private readonly BACKGROUND_ENRICHMENT_CONCURRENCY = 3;
  // Domain event listeners (workspace:deleted, note:created, note:deleted, git:status-changed)
  // are now handled by sagas in domain-event-listener-sagas.ts.

  // PERF: Track when workspace creation is in progress to enable lite mode in listWorkspaces
  // This prevents heavy list operations from blocking workspace:create IPC responses
  // Using a counter instead of boolean to handle concurrent creations properly
  private creationInProgressCount = 0;
  // In-flight create dedupe only holds promises until they settle; it is not a request-read cache.
  private pendingWorkspaceCreates = new Map<string, Promise<Result<Workspace, string>>>();

  // FIX: Serialize git worktree operations per repository to prevent corruption
  // Git worktree add/remove operations on the same repo must not run concurrently
  // or they can corrupt the .git/worktrees directory
  private gitWorktreeLocks = new Map<string, Promise<void>>();

  // PERF: Track recently deleted workspace IDs to guard against zombie agent events
  // When a workspace is deleted, streaming agents may still send updates for a brief period
  // We use a Set with TTL-based cleanup to prevent these zombie events from triggering
  // expensive operations like updateWorkspace and listWorkspaces
  private recentlyDeletedWorkspaces = new Set<string>();
  private recentlyDeletedCleanupTimers = new Map<string, NodeJS.Timeout>();
  private readonly RECENTLY_DELETED_TTL = 60000; // 60 seconds - long enough for zombie events to settle

  constructor(
    private readonly repository: WorkspaceRepository = new DaemonWorkspaceRepository(),
    private readonly idService: UnifiedIdService = unifiedIdService,
  ) {
    // Domain event listeners (including task:status-changed) are now handled
    // by sagas in domain-event-listener-sagas.ts.

    // Start periodic PR refresh for non-active workspaces with open PRs
    this.startPeriodicPRRefresh();
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
   * Lightweight preflight check that verifies a GitHub URL is reachable and
   * that the user's git/SSH setup can authenticate against it. Runs
   * `git ls-remote --heads <httpsUrl>` with a short timeout — this is what
   * `git clone` does for auth but without transferring any repository data.
   *
   * Returns the same error-string shape as `cloneGitHubRepository` so the
   * renderer can feed the message into `diagnoseCloneError` and render the
   * same structured guidance.
   */
  async preflightCloneCheck(githubUrl: string): Promise<Result<null, string>> {
    const urlMatch = githubUrl.match(
      /(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/]+)\/([^\/\s#?]+)/i,
    );
    if (!urlMatch) {
      return { ok: false, error: `Invalid GitHub URL: ${githubUrl}` };
    }
    const owner = urlMatch[1];
    const repo = urlMatch[2].replace(/\.git$/, '');
    const httpsUrl = `https://github.com/${owner}/${repo}.git`;

    try {
      await execAsync(`git ls-remote --heads ${escapeShellArg(httpsUrl)}`, {
        timeout: 8000,
      });
      return { ok: true, data: null };
    } catch (error: any) {
      const stderr: string = error?.stderr || '';
      const message: string = error?.message || String(error);
      const combined = `${stderr}\n${message}`.toLowerCase();

      logger.info('Preflight clone check failed', {
        githubUrl,
        stderr: stderr.slice(0, 500),
      });

      // Mirror the classification used in cloneGitHubRepository so the
      // renderer sees the same surface strings for the same conditions.
      if (
        combined.includes('terminal prompts disabled') ||
        combined.includes('could not read username') ||
        combined.includes('could not read password') ||
        combined.includes('authentication failed')
      ) {
        return {
          ok: false,
          error:
            'This repository requires authentication. Please sign in to GitHub on your terminal first, or make sure the repository is public.',
        };
      }

      if (
        combined.includes('repository not found') ||
        combined.includes('the requested url returned error: 404') ||
        combined.includes('404: not found')
      ) {
        return {
          ok: false,
          error: `Repository not found: ${githubUrl}. The repository may not exist, or it may be private. Please verify the URL.`,
        };
      }

      if (combined.includes('the requested url returned error: 403')) {
        return {
          ok: false,
          error: `Access denied for ${githubUrl}. You may not have permission to access this repository.`,
        };
      }

      if (
        combined.includes('could not resolve host') ||
        combined.includes('network is unreachable') ||
        combined.includes('operation timed out')
      ) {
        return {
          ok: false,
          error: 'Network error: Unable to reach GitHub. Please check your internet connection.',
        };
      }

      const cleanError = stderr.trim() || message;
      return {
        ok: false,
        error: `Failed to check repository: ${cleanError}`,
      };
    }
  }

  /**
   * Clone a GitHub repository to the specified directory
   * Returns the local path to the cloned repository
   */
  private async cloneGitHubRepository(
    githubUrl: string,
    targetPath: string,
  ): Promise<Result<{ clonePath: string; owner: string; repo: string }, string>> {
    try {
      // Parse the GitHub URL to extract owner and repo
      const urlMatch = githubUrl.match(
        /(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/]+)\/([^\/\s#?]+)/i,
      );

      if (!urlMatch) {
        return {
          ok: false,
          error: `Invalid GitHub URL: ${githubUrl}`,
        };
      }

      const owner = urlMatch[1];
      // Remove .git suffix if present
      const repo = urlMatch[2].replace(/\.git$/, '');

      // Use the user-provided target path, expanding ~ to home directory
      const clonePath = expandHomePath(targetPath);
      const parentDir = path.dirname(clonePath);

      // Ensure the parent directory exists
      await fs.mkdir(parentDir, { recursive: true });

      // Check if the directory already exists
      try {
        await fs.access(clonePath);
        // Directory exists - check if it's a valid git repo with the same remote
        const existingRemote = await this.getExistingRemoteUrl(clonePath);

        // Accept both HTTPS and SSH URL formats for the same repo
        const expectedHttps = `https://github.com/${owner}/${repo}.git`;
        const expectedHttpsAlt = `https://github.com/${owner}/${repo}`;
        const expectedSsh = `git@github.com:${owner}/${repo}.git`;

        const isSameRepo =
          existingRemote === expectedHttps ||
          existingRemote === expectedHttpsAlt ||
          existingRemote === expectedSsh;

        if (isSameRepo) {
          // Same repo, we can reuse it - just fetch latest
          logger.info('Reusing existing clone, fetching latest', { clonePath, existingRemote });
          try {
            await execAsync('git fetch --all', { cwd: clonePath, timeout: 60000 });
          } catch (fetchError) {
            logger.warn('Failed to fetch latest, continuing with existing clone', {
              error: fetchError,
            });
          }
          return {
            ok: true,
            data: { clonePath, owner, repo },
          };
        }

        // Check if directory exists but has no remote (incomplete clone)
        if (!existingRemote) {
          logger.warn('Directory exists but has no remote configured, removing and re-cloning', {
            clonePath,
          });
          // Remove the incomplete clone directory
          await fs.rm(clonePath, { recursive: true, force: true });
          // Continue to clone below
        } else {
          // Different repo exists at this path - error
          return {
            ok: false,
            error: `Directory ${clonePath} already exists with a different repository (${existingRemote}). Please choose a different location.`,
          };
        }
      } catch {
        // Directory doesn't exist, proceed with clone
      }

      // Clone the repository - try SSH first (if available), fall back to HTTPS
      logger.info('Cloning GitHub repository', {
        githubUrl,
        clonePath,
        owner,
        repo,
      });

      const sshUrl = `git@github.com:${owner}/${repo}.git`;
      const httpsUrl = `https://github.com/${owner}/${repo}.git`;

      // Try SSH first - this works for both public and private repos if user has SSH keys
      const sshAvailable = await this.checkSSHKeyAvailable();
      let triedSSH = false;

      if (sshAvailable) {
        // SSH agent has a working key — try SSH clone directly
        triedSSH = true;
        logger.info('SSH key available in agent, trying SSH clone first', { sshUrl });
        try {
          await this.cloneWithProgress(sshUrl, clonePath, parentDir);

          logger.info('GitHub repository cloned successfully via SSH', { clonePath });

          return {
            ok: true,
            data: { clonePath, owner, repo },
          };
        } catch (sshError: any) {
          const sshStderr = sshError?.message || '';
          logger.warn('SSH clone failed (agent key), will try HTTPS', {
            sshUrl,
            error: sshStderr,
          });
          // Clean up any partial clone directory before retrying
          try {
            await fs.rm(clonePath, { recursive: true, force: true });
          } catch {
            // Ignore cleanup errors — directory may not exist
          }
          // Continue to try HTTPS below
        }
      } else {
        // SSH agent check failed — but the user may have passphrase-protected keys.
        // If key files exist on disk, try SSH clone anyway; SSH_ASKPASS (set in gitEnv)
        // will prompt for the passphrase via a native OS dialog.
        const keyFiles = this.findSSHKeyFiles();
        const configuredKeyPath = getConfiguredSshKeyPath();
        if (keyFiles.length > 0 || configuredKeyPath) {
          triedSSH = true;
          logger.info('SSH key files found on disk, trying SSH clone with ASKPASS', {
            sshUrl,
            keyFileCount: keyFiles.length,
            configuredKeyPath: configuredKeyPath || undefined,
          });
          try {
            await this.cloneWithProgress(sshUrl, clonePath, parentDir);

            logger.info('GitHub repository cloned successfully via SSH (ASKPASS)', { clonePath });

            return {
              ok: true,
              data: { clonePath, owner, repo },
            };
          } catch (sshError: any) {
            const sshStderr = sshError?.message || '';
            logger.warn('SSH clone with ASKPASS failed, will try HTTPS', {
              sshUrl,
              error: sshStderr,
            });
            // Clean up any partial clone directory before falling back to HTTPS
            try {
              await fs.rm(clonePath, { recursive: true, force: true });
            } catch {
              // Ignore cleanup errors — directory may not exist
            }
            // Continue to try HTTPS below
          }
        }
      }

      try {
        // Clone via HTTPS
        logger.info('Attempting HTTPS clone', { httpsUrl });
        await this.cloneWithProgress(httpsUrl, clonePath, parentDir);

        logger.info('GitHub repository cloned successfully via HTTPS', { clonePath });

        return {
          ok: true,
          data: { clonePath, owner, repo },
        };
      } catch (cloneError: any) {
        // Extract the actual error message - stderr contains the real git error
        const stderr = cloneError?.stderr || '';
        const message = cloneError?.message || String(cloneError);
        const combinedError = `${stderr}\n${message}`.toLowerCase();

        logger.error('Git clone failed', cloneError, {
          githubUrl,
          clonePath,
          stderr,
          message,
        });

        // Check for authentication/access errors (private repos, invalid credentials)
        if (
          combinedError.includes('terminal prompts disabled') ||
          combinedError.includes('could not read username') ||
          combinedError.includes('could not read password') ||
          combinedError.includes('authentication failed') ||
          combinedError.includes('permission denied')
        ) {
          const authHint = triedSSH
            ? 'SSH authentication failed (the passphrase may have been incorrect or the key may not be authorized). '
            : '';
          return {
            ok: false,
            error: `${authHint}This repository requires authentication. Please clone it manually in a terminal first, or make sure the repository is public.`,
          };
        }

        // Repository not found (could be private or doesn't exist)
        if (
          combinedError.includes('repository not found') ||
          combinedError.includes('the requested url returned error: 404')
        ) {
          return {
            ok: false,
            error: `Repository not found: ${githubUrl}. The repository may not exist, or it may be private. Please verify the URL.`,
          };
        }

        // Access denied (403)
        if (combinedError.includes('the requested url returned error: 403')) {
          return {
            ok: false,
            error: `Access denied for ${githubUrl}. You may not have permission to access this repository.`,
          };
        }

        // Directory already exists
        if (combinedError.includes('already exists and is not an empty directory')) {
          return {
            ok: false,
            error:
              'The destination folder already exists and is not empty. Please choose a different location.',
          };
        }

        // Network errors
        if (
          combinedError.includes('could not resolve host') ||
          combinedError.includes('network is unreachable')
        ) {
          return {
            ok: false,
            error: 'Network error: Unable to reach GitHub. Please check your internet connection.',
          };
        }

        // For other errors, show a cleaner message with the stderr if available
        const cleanError = stderr.trim() || message;
        return {
          ok: false,
          error: `Failed to clone repository: ${cleanError}`,
        };
      }
    } catch (error: any) {
      logger.error('Failed to clone GitHub repository', error, { githubUrl });
      return {
        ok: false,
        error: `Failed to clone GitHub repository: ${error?.message || String(error)}`,
      };
    }
  }

  /**
   * Get the remote origin URL from an existing git repository
   */
  private async getExistingRemoteUrl(repoPath: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync('git remote get-url origin', { cwd: repoPath });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * Check if SSH keys are available for GitHub authentication.
   * Tests if the SSH agent has keys loaded that can connect to GitHub.
   */
  private async checkSSHKeyAvailable(): Promise<boolean> {
    try {
      // Try to connect to GitHub's SSH server - this is a quick check
      // that tells us if SSH keys are configured and the agent is running
      const { stderr } = await execAsync(
        'ssh -T git@github.com -o BatchMode=yes -o StrictHostKeyChecking=accept-new',
        {
          timeout: 10000, // 10 second timeout
        },
      );

      // GitHub's SSH server returns "Hi username!" even for test connections
      // If we get any response that's not a permission denied, SSH is working
      const response = stderr.toLowerCase();
      if (response.includes('successfully authenticated') || response.includes('hi ')) {
        logger.info('SSH authentication to GitHub successful');
        return true;
      }

      return false;
    } catch (error: any) {
      // SSH to GitHub returns exit code 1 even on success (it's just a test)
      // but it prints "Hi username!" to stderr
      const stderr = error?.stderr || error?.message || '';
      if (stderr.includes('successfully authenticated') || stderr.includes('Hi ')) {
        logger.info('SSH authentication to GitHub confirmed');
        return true;
      }

      // Permission denied means no valid SSH key
      if (stderr.includes('Permission denied') || stderr.includes('publickey')) {
        logger.debug('No SSH key configured for GitHub');
        return false;
      }

      logger.debug('SSH check failed, will use HTTPS', { error: stderr });
      return false;
    }
  }

  /**
   * Check if common SSH key files exist in ~/.ssh/.
   * Returns the list of key file paths found (private keys only, not .pub).
   * This does NOT check if the keys are loaded in the agent or if they work —
   * it only checks for file existence.
   */
  private findSSHKeyFiles(): string[] {
    const sshDir = path.join(os.homedir(), '.ssh');
    const commonKeyNames = ['id_ed25519', 'id_rsa', 'id_ecdsa', 'id_dsa'];
    const found: string[] = [];

    for (const keyName of commonKeyNames) {
      const keyPath = path.join(sshDir, keyName);
      try {
        if (fsSync.existsSync(keyPath)) {
          found.push(keyPath);
        }
      } catch {
        // Ignore permission errors or other issues
      }
    }

    return found;
  }

  /**
   * Broadcast clone progress to all renderer windows
   */
  private broadcastCloneProgress(progress: {
    phase: string;
    percent: number;
    message: string;
  }): void {
    try {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('workspace:clone-progress', progress);
        }
      });
    } catch (error) {
      logger.debug('Failed to broadcast clone progress', { error });
    }
  }

  /**
   * Clone a git repository with progress streaming via the daemon's
   * `git.clone` method (PROTOCOL.md §5.6). The FE mints a `requestId`,
   * subscribes to `git:clone:progress`/`git:clone:done` (§6.5), and
   * translates each progress frame into the unchanged `workspace:clone-progress`
   * renderer broadcast — the previous local `spawn('git', 'clone', …)` +
   * stderr regex parser is retired. Rejects on RPC/stream failure with no
   * silent local fallback.
   *
   * Turn-scoped subscription (RESUB-1): the `events.subscribe` here lives for
   * the duration of a single clone RPC. If the daemon restarts mid-clone the
   * in-flight `git.clone` request rejects (the socket drops), the promise
   * cleans up, and the caller retries — no replay logic needed here.
   */
  private async cloneWithProgress(
    url: string,
    clonePath: string,
    parentDir: string,
  ): Promise<void> {
    const targetName = path.basename(clonePath);
    const requestId = randomUUID();
    const client = getBackendClient();

    await new Promise<void>((resolve, reject) => {
      // Immediate UX cue while the RPC round-trips; the daemon then drives
      // subsequent phases via `git:clone:progress`.
      this.broadcastCloneProgress({
        phase: 'starting',
        percent: 0,
        message: 'Starting clone...',
      });

      let subscriptionId: string | undefined;
      let settled = false;
      let sawComplete = false;
      let timeoutHandle: NodeJS.Timeout | null = null;
      let notificationHandler: ((n: JsonRpcNotification) => void) | null = null;

      const cleanup = (): void => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        if (notificationHandler) {
          client.off('notification', notificationHandler);
          notificationHandler = null;
        }
        if (subscriptionId) {
          const idToRelease = subscriptionId;
          subscriptionId = undefined;
          client.request('events.unsubscribe', { subscriptionId: idToRelease }).catch((err) => {
            logger.debug('events.unsubscribe after git.clone failed', {
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      };

      const settleOk = (): void => {
        if (settled) return;
        settled = true;
        if (!sawComplete) {
          this.broadcastCloneProgress({
            phase: 'complete',
            percent: 100,
            message: 'Clone complete!',
          });
        }
        cleanup();
        resolve();
      };

      const settleErr = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      notificationHandler = (n: JsonRpcNotification): void => {
        if (n.method !== 'events.event') return;
        const params = n.params as { event?: unknown } | undefined;
        const event = (params && typeof params === 'object' && 'event' in params
          ? (params as { event?: unknown }).event
          : params) as { type?: unknown; data?: unknown } | undefined;
        if (!event || typeof event !== 'object') return;
        const type = event.type;
        if (type !== 'git:clone:progress' && type !== 'git:clone:done') return;
        const data = event.data as
          | { requestId?: unknown; phase?: unknown; percent?: unknown; message?: unknown; ok?: unknown; error?: unknown }
          | undefined;
        if (!data || data.requestId !== requestId) return;

        if (type === 'git:clone:progress') {
          const phase = typeof data.phase === 'string' ? data.phase : '';
          const percent = typeof data.percent === 'number' ? data.percent : 0;
          const message = typeof data.message === 'string' ? data.message : '';
          if (phase === 'complete') sawComplete = true;
          this.broadcastCloneProgress({ phase, percent, message });
          return;
        }

        // git:clone:done
        if (data.ok === true) {
          settleOk();
        } else {
          const errMsg = typeof data.error === 'string' && data.error.length > 0
            ? data.error
            : 'Git clone failed';
          settleErr(new Error(errMsg));
        }
      };

      client.on('notification', notificationHandler);

      // Defensive FE-side ceiling slightly beyond the daemon's 5-min hard cap;
      // guards against the daemon dying mid-clone without a terminal `done`.
      timeoutHandle = setTimeout(() => {
        settleErr(new Error('Git clone timed out waiting for daemon'));
      }, 360_000);

      (async () => {
        try {
          const subResult = (await client.request('events.subscribe', {
            eventTypes: ['git:clone:progress', 'git:clone:done'],
          })) as { subscriptionId?: string } | undefined;
          if (typeof subResult?.subscriptionId === 'string' && subResult.subscriptionId.length > 0) {
            subscriptionId = subResult.subscriptionId;
          }

          await client.request<{ requestId: string; targetPath: string }>('git.clone', {
            url,
            parentDir,
            targetName,
            requestId,
          });
        } catch (rpcError) {
          const message =
            rpcError instanceof Error ? rpcError.message : String(rpcError);
          logger.error('git.clone RPC failed', { message });
          settleErr(rpcError instanceof Error ? rpcError : new Error(message));
        }
      })();
    });

    // Best-effort: attempt to pull LFS objects now that the clone exists.
    // If this fails (missing objects, no network, etc.), the clone is still
    // functional — files tracked by LFS will just contain pointer content.
    try {
      await execFileAsync('git', ['lfs', 'pull'], {
        cwd: clonePath,
        timeout: 60000, // 60s timeout to avoid blocking workspace creation
      });
      logger.info('Git LFS pull completed successfully after clone', { clonePath });
    } catch (lfsError) {
      logger.warn('Git LFS pull failed after clone (non-fatal, repo still usable)', {
        clonePath,
        error: lfsError instanceof Error ? lfsError.message : String(lfsError),
      });
    }
  }

  /**
   * Create a new workspace
   */
  async createWorkspace(request: CreateWorkspaceRequest): Promise<Result<Workspace, string>> {
    const inFlightKey = this.getWorkspaceCreateInFlightKey(request);
    if (!inFlightKey) return this.createWorkspaceUntracked(request);

    const pending = this.pendingWorkspaceCreates.get(inFlightKey);
    if (pending) {
      logger.info('Reusing pending workspace creation', {
        hasRepositoryPath: !!request.repositoryPath,
        hasGithubUrl: !!request.githubUrl,
        hasInitialAgent: !!request.initialAgent,
      });
      return pending;
    }

    const promise = this.createWorkspaceUntracked(request);
    this.pendingWorkspaceCreates.set(inFlightKey, promise);
    try {
      return await promise;
    } finally {
      if (this.pendingWorkspaceCreates.get(inFlightKey) === promise) {
        this.pendingWorkspaceCreates.delete(inFlightKey);
      }
    }
  }

  private getWorkspaceCreateInFlightKey(request: CreateWorkspaceRequest): string | undefined {
    const prompt = request.initialAgent?.prompt?.trim();
    const promptSlug = prompt ? generateLocalSlug(prompt) : null;
    const title = request.title?.trim().toLowerCase();
    const slug = promptSlug ?? title;
    if (!slug) return undefined;

    return stableStringify({
      slug,
      repositoryPath: request.repositoryPath ?? '',
      githubUrl: request.githubUrl ?? '',
      clonePath: request.clonePath ?? '',
      branch: request.baseRef ?? request.branch ?? '',
      remote: request.remote ?? '',
      scope: request.scope ?? '',
      isNewRepo: request.isNewRepo ?? false,
      skipWorktree: request.skipWorktree ?? false,
      environmentConfig: request.environmentConfig ?? null,
      linearIssueId: request.linearIssue?.id ?? request.linearIssue?.identifier ?? '',
      sentryIssueId: request.sentryIssue?.id ?? request.sentryIssue?.shortId ?? '',
    });
  }

  private async createWorkspaceUntracked(
    request: CreateWorkspaceRequest,
  ): Promise<Result<Workspace, string>> {
    // PERF: Increment counter to enable lite mode in concurrent listWorkspaces calls
    // This prevents heavy list operations from blocking this IPC response
    this.creationInProgressCount++;
    try {
      logger.info('Creating workspace', { title: request.title });

      // Validate inputs
      if (request.title && !isValidWorkspaceTitle(request.title)) {
        return {
          ok: false,
          error: 'Invalid workspace title. Title must be 100 characters or less.',
        };
      }

      if (request.branch && !validateBranchName(request.branch)) {
        return {
          ok: false,
          error:
            "Invalid branch name. Branch names cannot contain spaces, special characters, or start with '.' or end with '.lock'",
        };
      }

      // Skip repositoryPath validation when githubUrl is provided (path will be a GitHub shorthand)
      if (request.repositoryPath && !request.githubUrl) {
        const repoPathErrors = validateRepositoryPath(request.repositoryPath);
        if (repoPathErrors.length > 0) {
          return {
            ok: false,
            error: `Invalid repository path: ${repoPathErrors.join('. ')}`,
          };
        }
      }

      // Generate a friendly workspace ID FAST using local keyword extraction
      // This is instant - no LLM calls. We may update the title later in background.
      const initialPrompt = request.initialAgent?.prompt;
      let id: WorkspaceId;

      if (initialPrompt) {
        // Try fast local slug extraction first (instant)
        const localSlug = generateLocalSlug(initialPrompt);
        if (localSlug) {
          id = this.idService.registerWorkspaceId(localSlug);
          logger.info('Generated local workspace ID (fast)', {
            id,
            intent: initialPrompt.slice(0, 50),
          });
        } else {
          id = this.idService.generateWorkspaceId();
          logger.info('Using random workspace ID (local extraction failed)', { id });
        }
      } else {
        id = this.idService.generateWorkspaceId();
      }

      // SAFETY: Check if this ID was recently deleted (e.g., rapid workspace recreation with same intent).
      // If the same slug is generated for a new workspace while the old one was just deleted,
      // reusing the ID causes race conditions: the old agent's streams, IPC handlers, and
      // file paths collide with the new workspace's. Generate a suffixed ID instead.
      if (this.recentlyDeletedWorkspaces.has(id)) {
        const baseSlug = extractBaseSlug(id);
        let suffix = 2;
        let newId: WorkspaceId;
        do {
          newId = appendSlugSuffix(baseSlug, suffix) as WorkspaceId;
          suffix++;
        } while (
          this.recentlyDeletedWorkspaces.has(newId) ||
          (await this.repository.exists(newId))
        );

        logger.info('Workspace ID was recently deleted, using suffixed ID to avoid collision', {
          original: id,
          newId,
        });
        id = newId;
      }

      // Check if workspace already exists (handles orphaned workspaces from worktree prune)
      const workspaceExists = await this.repository.exists(id);
      if (workspaceExists) {
        logger.warn('Workspace directory already exists, checking if it is orphaned', {
          workspaceId: id,
        });

        // Try to load the existing workspace
        const existingWorkspace = await this.repository.findById(id);
        if (existingWorkspace) {
          // Valid workspace exists - this is a real collision
          logger.info('Valid workspace exists, generating new ID with suffix', {
            existingId: id,
          });
          // Generate a new ID with numeric suffix
          // Extract base slug first to avoid double-suffixing (e.g., test-task-2-2)
          const baseSlug = extractBaseSlug(id);
          let suffix = 2;
          let newId: WorkspaceId;
          do {
            newId = appendSlugSuffix(baseSlug, suffix) as WorkspaceId;
            suffix++;
          } while (await this.repository.exists(newId));

          logger.info('Generated new workspace ID to avoid collision', {
            original: id,
            baseSlug,
            new: newId,
          });
          id = newId;
        } else {
          // Directory exists but workspace.json is missing or corrupted - orphaned workspace
          logger.warn('Orphaned workspace directory detected, cleaning up', {
            workspaceId: id,
          });
          try {
            await this.repository.cleanup(id);
            logger.info('Orphaned workspace cleaned up successfully', { workspaceId: id });
          } catch (cleanupError) {
            logger.error('Failed to cleanup orphaned workspace', cleanupError as Error, {
              workspaceId: id,
            });
            // Generate new ID instead of failing
            // Extract base slug first to avoid double-suffixing (e.g., test-task-2-2)
            const baseSlug = extractBaseSlug(id);
            let suffix = 2;
            let newId: WorkspaceId;
            do {
              newId = appendSlugSuffix(baseSlug, suffix) as WorkspaceId;
              suffix++;
            } while (await this.repository.exists(newId));

            logger.info('Using new workspace ID after cleanup failure', {
              original: id,
              baseSlug,
              new: newId,
            });
            id = newId;
          }
        }
      }

      // Get branch prefix early so we can check for ref namespace conflicts
      // Check repo-level config first, then fall back to global app setting
      const repoBranchPrefix = request.repositoryPath
        ? await getRepoBranchPrefix(request.repositoryPath)
        : undefined;
      const branchPrefix = repoBranchPrefix ?? getBranchPrefix();

      // If we have a repository path, ensure the branch name (which is the workspace ID) doesn't already exist
      // This handles cases where an intent-based slug might conflict with an existing branch
      // Also checks for Git ref namespace conflicts when using branch prefixes
      if (request.repositoryPath) {
        logger.info('Checking branch name uniqueness', {
          workspaceId: id,
          repositoryPath: request.repositoryPath,
          branchPrefix: branchPrefix || '(none)',
        });
        const uniqueResult = await this.ensureUniqueBranchName(
          id,
          request.repositoryPath,
          branchPrefix || undefined,
        );
        if (!uniqueResult.ok) {
          logger.info('Branch name uniqueness check failed', {
            workspaceId: id,
            error: uniqueResult.error,
          });
          return {
            ok: false,
            error: uniqueResult.error,
          };
        }
        logger.info('Branch name uniqueness check complete', {
          workspaceId: id,
          wasUnique: uniqueResult.data === id,
        });
        if (uniqueResult.data !== id) {
          logger.info('Branch name conflict, using alternative workspace ID', {
            original: id,
            alternative: uniqueResult.data,
          });
          id = uniqueResult.data;
        }
      }

      // Get workspace path (will be created by repository)
      const workspacePath = WorkspaceConfig.paths.workspace(id);
      logger.info('Workspace path determined', { workspaceId: id, workspacePath });

      // After branch uniqueness check, verify the workspace ID doesn't collide with an existing workspace
      // This handles the case where branch uniqueness changes ID to one that matches an old workspace
      // whose branch was deleted (e.g., dark-add-58 workspace exists but aw/dark-add-58 branch was deleted)
      if (await this.repository.exists(id)) {
        logger.info('Workspace ID collision detected after branch check, finding unique ID', {
          collidingId: id,
        });
        const baseSlug = extractBaseSlug(id);
        // Start from the current suffix + 1 to avoid re-checking lower numbers
        const currentSuffixMatch = id.match(/-(\d+)$/);
        let suffix = currentSuffixMatch ? parseInt(currentSuffixMatch[1], 10) + 1 : 2;
        const maxSuffix = suffix + 100; // Safety limit to prevent infinite loops
        let newId: WorkspaceId;
        let workspaceExists: boolean;
        let branchExists: boolean;
        do {
          if (suffix > maxSuffix) {
            return {
              ok: false,
              error: `Failed to find unique workspace ID after ${maxSuffix - (currentSuffixMatch ? parseInt(currentSuffixMatch[1], 10) : 1)} attempts`,
            };
          }
          newId = appendSlugSuffix(baseSlug, suffix) as WorkspaceId;
          suffix++;
          // Check both workspace AND branch existence to find a truly unique ID
          // For branch check, include the prefix if configured
          workspaceExists = await this.repository.exists(newId);
          if (request.repositoryPath) {
            const branchToCheck = branchPrefix ? `${branchPrefix}${newId}` : newId;
            branchExists = await this.checkBranchExistsInRepo(
              request.repositoryPath,
              branchToCheck,
            );
          } else {
            branchExists = false;
          }
        } while (workspaceExists || branchExists);
        logger.info('Generated unique workspace ID after collision', {
          original: id,
          baseSlug,
          new: newId,
        });
        id = newId;
      }

      // Check for orphaned metadata (no workspace.json but metadata folder exists)
      const metadataPath = WorkspaceConfig.paths.metadata(id);
      let hasOrphanedMetadata = false;
      try {
        await fs.access(metadataPath);
        // Metadata folder exists but workspace doesn't (we checked above)
        // This is orphaned metadata from a partial deletion
        logger.warn('Orphaned metadata folder detected for workspace ID', {
          workspaceId: id,
          metadataPath,
        });
        hasOrphanedMetadata = true;
      } catch {
        // Metadata folder doesn't exist - this is expected for new workspaces
      }

      // Use workspace ID as branch name for simplicity and memorability
      // Format: auth-refactor or amber-forest (or with -N suffix if collision)
      const branch = branchPrefix ? `${branchPrefix}${id}` : id;
      let worktreePath: string | undefined;
      let gitRepoInfo: { owner?: string; name?: string } = {};
      let baseCommitSha: string | undefined;
      // Expand tilde (~) in repository path to absolute path early,
      // so all downstream code (git init, worktree creation, agent launch) uses a real path.
      // Without this, Node.js treats ~/foo as a relative path and joins it with CWD.
      let effectiveRepositoryPath = request.repositoryPath
        ? expandHomePath(request.repositoryPath)
        : request.repositoryPath;
      const scope = request.scope;

      // Check if this is a remote workspace
      const isRemote = request.environmentConfig?.type === 'remote';
      logger.info('Workspace configuration prepared', {
        workspaceId: id,
        branch,
        isRemote,
        hasRepositoryPath: !!request.repositoryPath,
      });

      // Handle GitHub URL: clone the repository first
      if (request.githubUrl) {
        // Require clonePath when using githubUrl
        if (!request.clonePath) {
          await this.repository.cleanup(id);
          return {
            ok: false,
            error: 'A destination folder is required when cloning from a GitHub URL.',
          };
        }

        logger.info('Cloning GitHub repository', {
          githubUrl: request.githubUrl,
          clonePath: request.clonePath,
        });

        const cloneResult = await this.cloneGitHubRepository(request.githubUrl, request.clonePath);
        if (!cloneResult.ok) {
          await this.repository.cleanup(id);
          return {
            ok: false,
            error: cloneResult.error,
          };
        }

        // Use the cloned repository path
        effectiveRepositoryPath = cloneResult.data.clonePath;
        gitRepoInfo = {
          owner: cloneResult.data.owner,
          name: cloneResult.data.repo,
        };

        logger.info('GitHub repository cloned successfully', {
          clonePath: effectiveRepositoryPath,
          owner: gitRepoInfo.owner,
          name: gitRepoInfo.name,
        });
      }

      // Handle scoped workspaces: if scope is provided, find parent git root
      // Skip this for GitHub URLs since we've already set effectiveRepositoryPath from the clone
      if (request.repositoryPath && !request.githubUrl && scope && scope !== '.') {
        logger.info('Handling scoped workspace', {
          selectedPath: request.repositoryPath,
          scope,
        });

        const parentGitRoot = effectiveRepositoryPath
          ? await findParentGitDir(effectiveRepositoryPath)
          : null;
        if (parentGitRoot) {
          logger.info('Found parent git root for scoped workspace', {
            parentGitRoot,
            selectedPath: request.repositoryPath,
            scope,
          });
          effectiveRepositoryPath = parentGitRoot;
        } else {
          logger.warn('Could not find parent git root for scoped workspace', {
            selectedPath: request.repositoryPath,
            scope,
          });
          // Fall back to using the provided path (already expanded above)
          // effectiveRepositoryPath is already set from the expanded request.repositoryPath
        }
      }

      if (effectiveRepositoryPath) {
        if (isRemote && request.environmentConfig?.ssh) {
          // Remote workspace creation retired in P3-5. The remote RPC / git
          // stack has been removed, so remote-configured workspaces can no
          // longer be created from this daemon.
          await this.repository.cleanup(id);
          return {
            ok: false,
            error: 'Remote workspaces are no longer supported',
          };
        } else {
          // Local workspace: use local git commands

          // Guard: when creating a new project, the target directory must be
          // absent or empty. Reject any existing non-empty directory — including
          // git repos, which should be selected via the Local tab instead.
          if (request.isNewRepo && effectiveRepositoryPath) {
            try {
              const stat = await fs.stat(effectiveRepositoryPath);
              if (stat.isDirectory()) {
                const entries = await fs.readdir(effectiveRepositoryPath);
                if (entries.length > 0) {
                  await this.repository.cleanup(id);
                  return {
                    ok: false,
                    error:
                      'Target directory already exists and is not empty. Please choose an empty or non-existent folder for a new project.',
                  };
                }
              }
            } catch {
              // Directory doesn't exist yet — that's fine for new project creation
            }
          }

          // If this is a new repo, or the path exists but isn't a git repo, initialize it
          let needsInit = request.isNewRepo;
          if (!needsInit && effectiveRepositoryPath) {
            try {
              await execFileAsync('git', ['rev-parse', '--git-dir'], {
                cwd: effectiveRepositoryPath,
              });
            } catch {
              // Not a git repo — auto-initialize
              logger.info('Path is not a git repository, auto-initializing', {
                repositoryPath: effectiveRepositoryPath,
              });
              needsInit = true;
            }
          }
          if (needsInit) {
            logger.info('Initializing new repository', { repositoryPath: effectiveRepositoryPath });
            const initResult = await this.initializeNewRepository(effectiveRepositoryPath);
            if (!initResult.ok) {
              await this.repository.cleanup(id);
              return {
                ok: false,
                error: initResult.error,
              };
            }
          }

          // Extract git repository info (skip if already set from GitHub clone)
          if (!gitRepoInfo.owner && !gitRepoInfo.name) {
            gitRepoInfo = await this.getGitRepoInfo(effectiveRepositoryPath, {
              isRemote: false,
              workspaceId: id as string,
            });
          }

          // Check if skipWorktree mode is enabled
          if (request.skipWorktree) {
            // Skip worktree creation - use repository path directly
            logger.info('Creating workspace in skipWorktree mode', {
              repositoryPath: effectiveRepositoryPath,
            });
            worktreePath = effectiveRepositoryPath;

            // Get the current HEAD commit SHA from the repository
            try {
              const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
                cwd: effectiveRepositoryPath,
              });
              baseCommitSha = stdout.trim();
              logger.debug('Base commit SHA from repository', { baseCommitSha });
            } catch (error) {
              logger.warn('Could not get base commit SHA', { error });
            }
          } else {
            // Standard worktree creation mode
            // Generate stable worktree folder name that won't change if workspace is renamed
            // Format: {repo-name} (e.g., "augment", "my-app")
            const customWorktreesBase = getWorktreesLocation() || undefined;
            worktreePath = WorkspaceConfig.paths.worktree(
              id,
              gitRepoInfo.name,
              request.title,
              customWorktreesBase,
            );

            // Ensure parent directories exist (e.g. ~/intent/workspaces/{id}/)
            await fs.mkdir(path.dirname(worktreePath), { recursive: true });

            // Create git worktree
            const gitResult = await this.createGitWorktree(
              effectiveRepositoryPath,
              worktreePath,
              branch,
              request.baseRef,
              request.remote,
            );

            if (!gitResult.ok) {
              // Cleanup on failure using repository
              await this.repository.cleanup(id);
              return {
                ok: false,
                error: 'error' in gitResult ? gitResult.error : 'Git initialization failed',
              };
            }

            // Get the current HEAD commit SHA to track what existed when workspace was created
            if (worktreePath) {
              try {
                const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
                  cwd: worktreePath,
                });
                baseCommitSha = stdout.trim();
                logger.debug('Base commit SHA', { baseCommitSha });
              } catch (error) {
                logger.warn('Could not get base commit SHA', { error });
              }
            }
          }
        }
      }

      // Create workspace object
      const workspace: Workspace = {
        id,
        title: request.title || '',
        statusMessage: request.statusMessage,
        branch,
        baseRef: request.baseRef,
        baseCommitSha,
        initialPrompt: request.initialAgent?.prompt, // Store initial user message for commit/PR generation
        changesets: [],
        timeline: [],
        conversationInfo: [],
        status: WorkspaceStatus.Active,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        path: workspacePath, // Store the workspace-specific path
        repositoryPath: effectiveRepositoryPath,
        repositoryOwner: gitRepoInfo.owner,
        repositoryName: gitRepoInfo.name,
        worktreePath,
        scope: scope && scope !== '.' ? scope : undefined, // Store scope if provided and not "."
        skipWorktree: request.skipWorktree, // Store skipWorktree flag in metadata
        setupScript: request.setupScript,
        isRemote, // Mark as remote workspace if applicable
        environmentConfig: request.environmentConfig, // Store environment config for remote workspaces
        tags: [],
        diffs: undefined,
      };

      // Clean up orphaned metadata if detected earlier
      // This must happen AFTER worktree creation succeeds but BEFORE saving new workspace data
      // Orphaned metadata = metadata folder exists but no workspace.json (from partial deletion)
      if (hasOrphanedMetadata) {
        logger.info('Cleaning up orphaned metadata folder before creating new workspace', {
          workspaceId: id,
          metadataPath,
        });
        try {
          await fs.rm(metadataPath, { recursive: true, force: true });
          logger.info('Orphaned metadata folder cleaned up successfully', { workspaceId: id });
        } catch (cleanupError) {
          logger.warn('Failed to clean up orphaned metadata folder, proceeding anyway', {
            workspaceId: id,
            error: cleanupError,
          });
        }
      }

      // Save workspace metadata. Default spec-note seeding is owned by the
      // daemon (`workspace.create` runs `ensure_spec_note`).
      await this.saveWorkspace(workspace);

      // Save initial agent config if provided
      if (request.initialAgent) {
        // Validate agent ID to prevent path traversal
        const agentId = request.initialAgent.agentId;
        if (!agentId || agentId.includes('..') || agentId.includes('/') || agentId.includes('\\')) {
          logger.warn('Invalid agent ID for initial agent config', { agentId });
          return {
            ok: false,
            error: 'Invalid agent ID format',
          };
        }

        // Note: the daemon (PROTOCOL.md §5.5 `agent.create`) owns the session
        // record, so we no longer manage the on-disk agents directory here.

        // Resolve specialist configuration if a specialist is specified
        // This allows the initial agent to inherit model and behavior from the specialist
        const specialist = (request.initialAgent as any).specialist;
        // Check for behaviorPrompt passed directly (from team coordinator or custom specialist)
        const passedBehaviorPrompt = (request.initialAgent as any).behaviorPrompt;
        // Get the explicitly selected provider (auggie, claude-code, codex)
        // Test-only: DEFAULT_PROVIDER_OVERRIDE forces the provider regardless of
        // what the renderer resolved (resolveOnboardingModel defaults to auggie).
        let providerOverride: string | undefined;
        if (process.env.TESTING === 'true' && process.env.DEFAULT_PROVIDER_OVERRIDE) {
          const { ACP_PROVIDERS } = await import('$shared/config/provider-config');
          if (process.env.DEFAULT_PROVIDER_OVERRIDE in ACP_PROVIDERS) {
            providerOverride = process.env.DEFAULT_PROVIDER_OVERRIDE;
          } else {
            logger.warn(`DEFAULT_PROVIDER_OVERRIDE '${process.env.DEFAULT_PROVIDER_OVERRIDE}' is not a known provider, ignoring`);
          }
        }
        const provider = providerOverride || (request.initialAgent as any).provider;

        const specialistPath = workspace.worktreePath || workspace.repositoryPath || workspace.path;
        if (specialist) {
          await refreshSpecialistsFromFiles(specialistPath);
        }

        // Use centralized resolver for specialist config (single source of truth)
        const resolved = specialist
          ? resolveSpecialistForAgent(specialist, provider, specialistPath)
          : null;

        // Use specialist defaults, but allow explicit overrides from the request
        // PRIORITY: passed behaviorPrompt > specialist config behaviorPrompt
        // Resolve model with provider-aware tier-based resolution.
        // Use the specialist's modelTier to resolve the correct model for the provider,
        // ensuring we never create invalid compound IDs like "codex:sonnet4.5".
        let effectiveModel = request.initialAgent.model;
        if (!effectiveModel && resolved) {
          const defaultProviderId = getDefaultProviderId();
          const effectiveProvider = provider || defaultProviderId;
          // Only resolve tiers for providers with known mappings — providers with
          // dynamic model lists (e.g. opencode) would produce invalid compound IDs.
          if (resolved.modelTier && effectiveProvider in PROVIDER_MODEL_TIERS) {
            // Tier-based resolution: always produces a valid model for the provider
            const providerModel = getDefaultModelForProvider(effectiveProvider, resolved.modelTier);
            effectiveModel =
              effectiveProvider !== defaultProviderId
                ? createCompoundModelId(effectiveProvider, providerModel)
                : providerModel;
          } else if (resolved.model) {
            // Legacy fallback: no tier available, use compound model prefixing (best-effort)
            effectiveModel =
              provider && provider !== defaultProviderId
                ? createCompoundModelId(provider, resolved.model)
                : resolved.model;
          }
        }
        if (!effectiveModel && provider && provider in PROVIDER_MODEL_TIERS) {
          // Use provider's balanced tier as default (only for providers with known mappings)
          const baseModel = getDefaultModelForProvider(provider, 'balanced');
          const defaultProviderId = getDefaultProviderId();
          // Prefix with provider ID for non-default providers (matches model store behavior)
          effectiveModel = provider !== defaultProviderId ? `${provider}:${baseModel}` : baseModel;
        }
        // Final fallback to DEFAULT_AGENT_MODEL (when no provider)
        if (!effectiveModel) {
          effectiveModel = DEFAULT_AGENT_MODEL;
        }
        // Prefer passed behaviorPrompt (from team coordinator) over specialist config
        const effectiveBehaviorPrompt =
          passedBehaviorPrompt || resolved?.behaviorPrompt || undefined;
        // roleReminder and specialistName come from centralized resolver
        const effectiveRoleReminder = resolved?.roleReminder || undefined;
        const effectiveSpecialistName = resolved?.specialistName || undefined;

        // Log final resolved config with inline values (not truncated)
        // This shows the FINAL effective values that will be saved to persistence
        logger.info(
          `Resolved initial agent config: specialist=${specialist}, specialistName=${effectiveSpecialistName}, model=${effectiveModel}, provider=${provider}, hasBehaviorPrompt=${!!effectiveBehaviorPrompt}, behaviorPromptLength=${effectiveBehaviorPrompt?.length || 0}, hasRoleReminder=${!!effectiveRoleReminder}, source=${passedBehaviorPrompt ? 'IPC' : resolved?.behaviorPrompt ? 'lookup' : 'none'}`,
        );

        // Save agent config with proper structure for persistence service
        // The persistence service expects either versioned data or legacy unversioned data
        const agentSession = {
          id: agentId,
          backendSessionId: null, // Pending session, no backendSessionId yet
          workspaceId: id,
          name: request.initialAgent.name || 'Coordinator',
          model: effectiveModel,
          provider, // Top-level ACP provider (auggie, claude-code, codex) — immutable after creation
          status: AgentStatus.Pending,
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          // Store config properly for activation handler
          config: {
            model: effectiveModel,
            agentType: (request.initialAgent as any).agentType || 'workspace',
            specialist, // Store specialist for reference
            provider, // Store ACP provider (auggie, claude-code, codex)
            behaviorPrompt: effectiveBehaviorPrompt, // Store behavior prompt from specialist
            roleReminder: effectiveRoleReminder, // Store role reminder for system prompt rebuilds
            specialistName: effectiveSpecialistName, // Store specialist name for prompt building
            contextReferences: (request.initialAgent as any).contextReferences, // Store context references from onboarding
            imageBlocks: (request.initialAgent as any).imageBlocks,
            metadata: {
              ...request.initialAgent.metadata,
              isInitialAgent: true,
              isFirstWorkspaceAgent: true,
              specialist, // Also in metadata for easy access
              provider, // Store provider in metadata for reference
              roleReminder: effectiveRoleReminder, // Store in metadata for handleSendMessage
              specialistName: effectiveSpecialistName, // Store in metadata for handleSendMessage
              // Store the initial prompt in metadata so it can be sent after activation
              initialMessage: request.initialAgent.prompt,
            },
          },
          metadata: {
            ...request.initialAgent.metadata,
            isInitialAgent: true,
            isFirstWorkspaceAgent: true,
            specialist, // Store specialist in metadata
            provider, // Store provider in metadata
            roleReminder: effectiveRoleReminder, // Store role reminder for system prompt rebuilds
            specialistName: effectiveSpecialistName, // Store specialist name for prompt building
            // Store the initial prompt in metadata so it can be sent after activation
            initialMessage: request.initialAgent.prompt,
          },
          // Store context references at top level for easy access
          contextReferences: (request.initialAgent as any).contextReferences,
          imageBlocks: (request.initialAgent as any).imageBlocks,
        };

        // Persist the initial-agent session on the daemon (PROTOCOL.md §5.5
        // `agent.create`). The daemon adopts the FE-supplied `agentId` verbatim
        // and harvests the persisted gap fields from `metadata`
        // (`contextReferences` / `imageBlocks` also passed top-level so they
        // win over the metadata copies).
        try {
          await getBackendClient().request('agent.create', {
            workspaceId: id,
            workspacePath: specialistPath,
            agentId,
            name: agentSession.name,
            model: effectiveModel,
            provider,
            agentType: (request.initialAgent as any).agentType || 'workspace',
            metadata: agentSession.metadata,
            contextReferences: (request.initialAgent as any).contextReferences,
            imageBlocks: (request.initialAgent as any).imageBlocks,
          });
          logger.info('Saved initial agent config', {
            workspaceId: id,
            agentId: request.initialAgent.agentId,
          });
        } catch (error) {
          logger.warn('Failed to save initial agent config via daemon agent.create', {
            workspaceId: id,
            agentId: request.initialAgent.agentId,
            error: (error as Error).message,
          });
        }
      }

      // Emit event
      mainDispatch(
        workspaceCreated({
          workspaceId: id,
          workspace,
          initialAgent: request.initialAgent,
        }),
      );

      // Resolve effective setup script: request > repo config > none
      const effectiveSetupScript =
        request.setupScript ??
        (effectiveRepositoryPath ? await getRepoSetupScript(effectiveRepositoryPath) : undefined);

      logger.info('Workspace created successfully', {
        id,
        title: workspace.title,
        branch: workspace.branch,
        hasInitialAgent: !!request.initialAgent,
        hasSetupScript: !!effectiveSetupScript,
        setupScriptSource: request.setupScript
          ? 'request'
          : effectiveSetupScript
            ? 'repo-config'
            : 'none',
      });

      // Execute setup script if provided or configured in repo config (in background, don't block creation)
      if (effectiveSetupScript && worktreePath) {
        // Fire-and-forget, but without arbitrary delays
        void (async () => {
          try {
            logger.info('Executing setup script', {
              workspaceId: id,
              worktreePath,
              scriptLength: effectiveSetupScript.length,
              source: request.setupScript ? 'request' : 'repo-config',
            });

            const setupEnv = {
              MAIN_CHECKOUT: effectiveRepositoryPath || '',
              WORKTREE_PATH: worktreePath,
              BRANCH_NAME: branch,
              SOURCE_BRANCH: request.baseRef || 'main',
            };

            const result = await createTerminalFromBackend({
              workspaceId: id,
              cwd: worktreePath,
              title: 'Setup',
              initialCommand: effectiveSetupScript,
              env: setupEnv,
            });

            if (result.success) {
              logger.info('Setup script terminal created', {
                workspaceId: id,
                terminalId: result.terminalId,
              });
            } else {
              logger.error('Failed to create setup script terminal', {
                workspaceId: id,
                error: result.error,
              });
            }
          } catch (error) {
            logger.error('Setup script execution failed', error as Error);
          }
        })();
      }

      // Register repo in persistent registry so it survives workspace deletion
      if (workspace.repositoryPath) {
        try {
          addRepo({
            path: workspace.repositoryPath,
            name:
              workspace.repositoryName || workspace.repositoryPath.split('/').pop() || 'Unknown',
            owner: workspace.repositoryOwner,
          });
        } catch (regErr) {
          logger.warn('Failed to register repo in registry', { error: regErr });
        }
      }

      return { ok: true, data: workspace };
    } catch (error) {
      logger.error('Workspace creation failed', error as Error);
      return {
        ok: false,
        error: this.extractErrorMessage(error),
      };
    } finally {
      // PERF: Decrement counter to allow full list operations when all creations complete
      this.creationInProgressCount = Math.max(0, this.creationInProgressCount - 1);
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
      const requestedLiteMode = options?.lite ?? true;
      // Automatically force lite mode when workspace creation is in progress to
      // avoid blocking create IPC responses.
      const useLiteMode = requestedLiteMode || this.creationInProgressCount > 0;
      if (useLiteMode) {
        // PERF: In lite mode, skip heavy buildListWorkspace() computations.
        // Workspace payloads are metadata-only; diff/git/task summaries are
        // fetched on demand via dedicated endpoints.
        if (this.creationInProgressCount > 0) {
          logger.debug(
            'Using lite mode for workspace list - creation in progress, skipping heavy computations',
          );
        } else {
          logger.debug('Using lite mode for workspace list - skipping heavy computations');
        }

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

    // Check if workspace has an open PR that's missing ciStatus or reviewDecision
    const needsPREnrichment = Boolean(
      workspace.activePullRequest?.status === PullRequestStatus.Open &&
      workspace.repositoryOwner &&
      workspace.repositoryName &&
      (workspace.activePullRequest.ciStatus == null ||
        workspace.activePullRequest.reviewDecision === undefined),
    );

    return missingGitInfo || hasPersistedDiffs || needsPREnrichment;
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

      let updatedWorkspace = workspace;
      const rendererUpdates: BackgroundEnrichmentWorkspaceUpdates = {};

      if (workspace.repositoryPath && (!workspace.repositoryOwner || !workspace.repositoryName)) {
        const gitInfo = await this.getGitRepoInfo(workspace.repositoryPath, {
          isRemote: !!workspace.isRemote,
          workspaceId: workspaceId as string,
        });

        const owner = workspace.repositoryOwner ?? gitInfo.owner;
        const name = workspace.repositoryName ?? gitInfo.name;

        if (owner !== workspace.repositoryOwner || name !== workspace.repositoryName) {
          updatedWorkspace = {
            ...updatedWorkspace,
            repositoryOwner: owner,
            repositoryName: name,
          };
          rendererUpdates.repositoryOwner = owner;
          rendererUpdates.repositoryName = name;
        }
      }

      if (Array.isArray(updatedWorkspace.diffs) && updatedWorkspace.diffs.length > 0) {
        updatedWorkspace = {
          ...updatedWorkspace,
          diffs: undefined,
        };
      }

      // Enrich PR status (ciStatus and reviewDecision) for open PRs
      if (
        updatedWorkspace.activePullRequest?.status === PullRequestStatus.Open &&
        updatedWorkspace.repositoryOwner &&
        updatedWorkspace.repositoryName &&
        (updatedWorkspace.activePullRequest.ciStatus == null ||
          updatedWorkspace.activePullRequest.reviewDecision === undefined)
      ) {
        const owner = updatedWorkspace.repositoryOwner;
        const repo = updatedWorkspace.repositoryName;
        const pr = updatedWorkspace.activePullRequest;

        try {
          // Fetch single PR details to get headSha and mergeableState
          // These are only available from the single PR endpoint
          const currentPR = { ...pr };
          try {
            const prDetail = await githubService.getPullRequest(owner, repo, pr.number);
            if (prDetail) {
              // Validate source branch matches workspace branch or baseRef before enriching.
              // Accept if PR source branch matches either:
              // - workspace.branch (workspace owns the PR)
              // - workspace.baseRef (workspace was created to review the PR)
              // Only clear on POSITIVE MISMATCH against both. If sourceBranch is empty
              // (YAML parsing issue), skip validation to avoid incorrectly clearing legitimate PR links.
              const branchMatches =
                !prDetail.sourceBranch ||
                !updatedWorkspace.branch ||
                prDetail.sourceBranch === updatedWorkspace.branch;
              // Also accept a baseRef match. baseRef may be plain ("main")
              // or remote-qualified ("origin/main"); only a conservative
              // remote-name allowlist is stripped so slashed local branches
              // aren't over-stripped.
              const baseRefMatches = matchesBaseRef(prDetail.sourceBranch, updatedWorkspace.baseRef);
              if (!branchMatches && !baseRefMatches) {
                logger.info(
                  'Background enrichment: PR source branch does not match workspace, clearing stale link',
                  {
                    workspaceId,
                    prNumber: pr.number,
                    prSourceBranch: prDetail.sourceBranch,
                    workspaceBranch: updatedWorkspace.branch,
                  },
                );
                const updatedPullRequests = (updatedWorkspace.pullRequests || []).filter(
                  (p) => p.number !== pr.number,
                );
                updatedWorkspace = {
                  ...updatedWorkspace,
                  prNumber: undefined,
                  prUrl: undefined,
                  prStatus: undefined,
                  activePullRequest: undefined,
                  pullRequests: updatedPullRequests,
                };
                // Persistence is owned by the daemon (PROTOCOL.md §5.1); the FE
                // no longer writes stale-PR-link clears back to disk. Daemon
                // gap: daemon should validate PR source-branch and clear stale
                // links itself. Broadcast keeps renderer state in sync until
                // the next daemon refresh.
                await this.broadcastBackgroundEnrichmentUpdate(workspaceId, {
                  ...rendererUpdates,
                  activePullRequest: undefined,
                  prNumber: undefined,
                  prUrl: undefined,
                  prStatus: undefined,
                  pullRequests: updatedPullRequests,
                });
                return;
              }

              if (prDetail.headSha) currentPR.headSha = prDetail.headSha;
              if (prDetail.mergeableState !== undefined)
                currentPR.mergeableState = prDetail.mergeableState;
              if (prDetail.mergeable !== undefined) currentPR.mergeable = prDetail.mergeable;
              // Sync PR status (merged/closed) from remote
              if (prDetail.state) {
                const mappedStatus = PR_STATE_TO_STATUS[prDetail.state];
                if (mappedStatus) currentPR.status = mappedStatus;
              }
            }
          } catch (err) {
            logger.warn('Background enrichment: failed to fetch PR details', {
              workspaceId,
              prNumber: pr.number,
              error: (err as Error).message,
            });
          }

          // Fetch check runs and reviews in parallel
          const [checkRunsResult, reviewsResult] = await Promise.all([
            currentPR.headSha
              ? githubService.getCheckRuns(owner, repo, currentPR.headSha)
              : Promise.resolve(null),
            githubService.getReviews(owner, repo, pr.number),
          ]);

          // Only update if we got new data
          // Note: We persist ciStatus even when total === 0 (no CI checks configured)
          // to ensure ciStatus != null after enrichment, preventing infinite enrichment loops
          const enrichedPR = {
            ...currentPR,
            ...(checkRunsResult &&
              currentPR.ciStatus == null && {
                ciStatus: checkRunsResult,
              }),
            // Always set reviewDecision if not already set, even when null.
            // This ensures "fetched but null" (explicit null) is distinguishable from
            // "never fetched" (undefined), preventing infinite enrichment loops.
            ...(currentPR.reviewDecision == null && {
              reviewDecision: reviewsResult.reviewDecision ?? null,
              approvedBy: reviewsResult.approvedBy,
              approvalCount: reviewsResult.approvalCount,
            }),
          };

          // Check if anything actually changed
          if (
            enrichedPR.ciStatus !== pr.ciStatus ||
            enrichedPR.reviewDecision !== pr.reviewDecision ||
            enrichedPR.headSha !== pr.headSha ||
            enrichedPR.mergeableState !== pr.mergeableState ||
            enrichedPR.status !== pr.status
          ) {
            // Update activePullRequest
            updatedWorkspace = {
              ...updatedWorkspace,
              activePullRequest: enrichedPR,
              ...(enrichedPR.status !== pr.status && { prStatus: enrichedPR.status }),
            };

            // Also update the matching entry in pullRequests[] if it exists
            if (updatedWorkspace.pullRequests) {
              updatedWorkspace = {
                ...updatedWorkspace,
                pullRequests: updatedWorkspace.pullRequests.map((existingPR) =>
                  existingPR.number === enrichedPR.number ? enrichedPR : existingPR,
                ),
              };
            }

            rendererUpdates.activePullRequest = enrichedPR;
            if (enrichedPR.status !== pr.status) {
              rendererUpdates.prStatus = enrichedPR.status;
            }
            if (updatedWorkspace.pullRequests) {
              rendererUpdates.pullRequests = updatedWorkspace.pullRequests;
            }
            logger.debug('Enriched PR status for workspace', {
              workspaceId,
              prNumber: pr.number,
              ciStatus: enrichedPR.ciStatus,
              reviewDecision: enrichedPR.reviewDecision,
            });
          }
        } catch (prError) {
          // Log but don't fail the entire enrichment
          logger.warn('Failed to enrich PR status', {
            workspaceId,
            prNumber: pr.number,
            error: (prError as Error).message,
          });
        }
      }

      // Persistence is owned by the daemon (PROTOCOL.md §5.1); the FE no
      // longer writes background enrichment (git repo info / PR CI + review /
      // stale-link clears) back to disk. Daemon gap: daemon should own PR
      // enrichment and stamp the workspace itself. Broadcast keeps renderer
      // state in sync until the next daemon refresh.
      await this.broadcastBackgroundEnrichmentUpdate(workspaceId, rendererUpdates);
    } catch (error) {
      logger.error('Background workspace enrichment failed', error as Error, { workspaceId });
    }
  }

  /**
   * Start periodic refresh of PR status for all workspaces with open PRs.
   * This ensures CI status and review data stay fresh for workspaces that aren't actively being viewed.
   */
  private startPeriodicPRRefresh(): void {
    // Randomize initial start to avoid all instances starting at the same time
    const initialDelay = Math.random() * 60_000; // 0-60 seconds

    this.periodicPRRefreshInitialTimeout = setTimeout(() => {
      if (this.disposed) return;

      // Run immediately on first tick, then every 5 minutes
      this.refreshAllOpenPRs();

      this.periodicPRRefreshTimer = setInterval(() => {
        if (this.disposed) return;
        this.refreshAllOpenPRs();
      }, this.PR_REFRESH_INTERVAL);
    }, initialDelay);
  }

  /**
   * Refresh CI and review status for all workspaces with open PRs.
   * Staggers fetches to avoid burst API calls.
   */
  private async refreshAllOpenPRs(): Promise<void> {
    try {
      const allWorkspaces = await this.repository.findAll();
      const candidates = allWorkspaces.filter(
        (ws) =>
          ws.activePullRequest &&
          (ws.activePullRequest.status === PullRequestStatus.Open ||
            ws.activePullRequest.status === PullRequestStatus.Draft) &&
          ws.repositoryOwner &&
          ws.repositoryName &&
          !this.pendingBackgroundEnrichment.has(ws.id),
      );

      if (candidates.length === 0) return;

      logger.debug('Periodic PR refresh: refreshing open PRs', { count: candidates.length });

      // Clear any previously scheduled staggered timeouts before scheduling new ones
      for (const timeout of this.periodicPRStaggeredTimeouts) {
        clearTimeout(timeout);
      }
      this.periodicPRStaggeredTimeouts = [];

      // Stagger fetches with random delays to avoid burst API calls
      for (let i = 0; i < candidates.length; i++) {
        const ws = candidates[i];
        const staggerDelay = i * 2000 + Math.random() * 1000; // 2-3 seconds between each

        const timeout = setTimeout(() => {
          if (this.disposed) return;
          this.performPRRefreshEnrichment(ws.id).catch((error) => {
            logger.warn('Periodic PR refresh failed', {
              workspaceId: ws.id,
              error: (error as Error).message,
            });
          });
        }, staggerDelay);
        this.periodicPRStaggeredTimeouts.push(timeout);
      }
    } catch (error) {
      logger.error('Failed to run periodic PR refresh', error as Error);
    }
  }

  /**
   * Perform PR status refresh for a single workspace.
   * Unlike performBackgroundEnrichment, this ALWAYS re-fetches CI and review data
   * (no guards on existing values) to ensure data stays fresh.
   */
  private async performPRRefreshEnrichment(workspaceId: WorkspaceId): Promise<void> {
    if (this.pendingBackgroundEnrichment.has(workspaceId)) return;
    this.pendingBackgroundEnrichment.add(workspaceId);

    try {
      const workspace = await this.repository.findById(workspaceId);
      if (
        !workspace?.activePullRequest ||
        !workspace.repositoryOwner ||
        !workspace.repositoryName
      ) {
        return;
      }

      const pr = workspace.activePullRequest;
      if (pr.status !== PullRequestStatus.Open && pr.status !== PullRequestStatus.Draft) {
        return;
      }

      const owner = workspace.repositoryOwner;
      const repo = workspace.repositoryName;

      // Validate: PR's source branch should match the workspace's own branch.
      // Previously, baseRef matching could incorrectly link a parent branch's PR.
      // Check headRef on stored PR, or fetch and validate.
      const currentPR = { ...pr };
      try {
        const prDetail = await githubService.getPullRequest(owner, repo, pr.number);
        if (prDetail) {
          // Validate source branch matches workspace branch or baseRef before using this PR.
          // Accept if PR source branch matches either:
          // - workspace.branch (workspace owns the PR)
          // - workspace.baseRef (workspace was created to review the PR)
          // Only clear on POSITIVE MISMATCH against both. If sourceBranch is empty
          // (YAML parsing issue), we can't validate, so we keep the PR.
          const branchMatches =
            !prDetail.sourceBranch ||
            !workspace.branch ||
            prDetail.sourceBranch === workspace.branch;
          // Also accept a baseRef match. baseRef may be plain ("main") or
          // remote-qualified ("origin/main"); only a conservative remote-name
          // allowlist is stripped so slashed local branches aren't over-stripped.
          const baseRefMatches = matchesBaseRef(prDetail.sourceBranch, workspace.baseRef);
          if (!branchMatches && !baseRefMatches) {
            logger.info(
              'Periodic PR refresh: PR source branch does not match workspace, clearing stale link',
              {
                workspaceId,
                prNumber: pr.number,
                prSourceBranch: prDetail.sourceBranch,
                workspaceBranch: workspace.branch,
              },
            );
            // Clear the stale PR association
            const updatedPullRequests = (workspace.pullRequests || []).filter(
              (p) => p.number !== pr.number,
            );
            // Persistence is owned by the daemon (PROTOCOL.md §5.1); the FE no
            // longer writes stale-PR-link clears back to disk during periodic
            // refresh. Daemon gap: daemon should validate PR source-branch and
            // clear stale links itself. Broadcast keeps renderer state in sync
            // until the next daemon refresh.
            await this.broadcastBackgroundEnrichmentUpdate(workspaceId, {
              activePullRequest: undefined,
              prNumber: undefined,
              prUrl: undefined,
              prStatus: undefined,
              pullRequests: updatedPullRequests,
            });
            return;
          }

          // Fetch single PR details to get headSha and mergeableState
          if (prDetail.headSha) currentPR.headSha = prDetail.headSha;
          if (prDetail.mergeableState !== undefined)
            currentPR.mergeableState = prDetail.mergeableState;
          if (prDetail.mergeable !== undefined) currentPR.mergeable = prDetail.mergeable;
          // Sync PR status (merged/closed) from remote
          if (prDetail.state) {
            const mappedStatus = PR_STATE_TO_STATUS[prDetail.state];
            if (mappedStatus) currentPR.status = mappedStatus;
          }
        }
      } catch (err) {
        logger.warn('Periodic PR refresh: failed to fetch PR details', {
          workspaceId,
          prNumber: pr.number,
          error: (err as Error).message,
        });
      }

      const [checkRunsResult, reviewsResult] = await Promise.all([
        currentPR.headSha
          ? githubService.getCheckRuns(owner, repo, currentPR.headSha)
          : Promise.resolve(null),
        githubService.getReviews(owner, repo, pr.number),
      ]);

      // Always update with fresh data (no guards on existing values - this is the key difference
      // from performBackgroundEnrichment which only fills in missing data)
      const enrichedPR = {
        ...currentPR,
        ...(checkRunsResult && { ciStatus: checkRunsResult }),
        ...(reviewsResult && {
          reviewDecision: reviewsResult.reviewDecision ?? null,
          approvedBy: reviewsResult.approvedBy,
          approvalCount: reviewsResult.approvalCount,
        }),
      };

      // Only save and broadcast if something changed (use JSON.stringify for ciStatus comparison)
      if (
        JSON.stringify(enrichedPR.ciStatus) !== JSON.stringify(pr.ciStatus) ||
        enrichedPR.reviewDecision !== pr.reviewDecision ||
        enrichedPR.headSha !== pr.headSha ||
        enrichedPR.mergeableState !== pr.mergeableState ||
        enrichedPR.status !== pr.status
      ) {
        let updatedWorkspace: Workspace = {
          ...workspace,
          activePullRequest: enrichedPR,
          ...(enrichedPR.status !== pr.status && { prStatus: enrichedPR.status }),
        };

        // Also update the matching entry in pullRequests[] if it exists
        if (updatedWorkspace.pullRequests) {
          updatedWorkspace = {
            ...updatedWorkspace,
            pullRequests: updatedWorkspace.pullRequests.map((existingPR) =>
              existingPR.number === enrichedPR.number ? enrichedPR : existingPR,
            ),
          };
        }

        // Persistence is owned by the daemon (PROTOCOL.md §5.1); the FE no
        // longer writes periodic-PR-refresh enrichment (CI status / reviews /
        // headSha) back to disk. Daemon gap: daemon should own PR enrichment
        // and stamp the workspace itself. Broadcast keeps renderer state in
        // sync until the next daemon refresh.
        const rendererUpdates: BackgroundEnrichmentWorkspaceUpdates = {
          activePullRequest: enrichedPR,
        };
        if (enrichedPR.status !== pr.status) {
          rendererUpdates.prStatus = enrichedPR.status;
        }
        if (updatedWorkspace.pullRequests) {
          rendererUpdates.pullRequests = updatedWorkspace.pullRequests;
        }

        await this.broadcastBackgroundEnrichmentUpdate(workspaceId, rendererUpdates);

        logger.info('Periodic PR refresh: updated workspace', {
          workspaceId,
          ciStatus: enrichedPR.ciStatus,
          reviewDecision: enrichedPR.reviewDecision,
        });
      }
    } finally {
      this.pendingBackgroundEnrichment.delete(workspaceId);
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

      // Get workspace info before deletion for tracking
      const trackingWorkspaceResult = await this.getWorkspace(id as WorkspaceId);
      let workspaceTitle: string | undefined;
      let ageInDays: number | undefined;
      if (trackingWorkspaceResult.ok) {
        workspaceTitle = trackingWorkspaceResult.data.title;
        ageInDays = Math.floor(
          (Date.now() - new Date(trackingWorkspaceResult.data.createdAt).getTime()) /
            (1000 * 60 * 60 * 24),
        );
      }

      // Emit pre-delete event to allow cleanup
      mainDispatch(
        workspaceDeleting({
          workspaceId: id,
        }),
      );

      // Remote-only worktree cleanup: the daemon `workspace.delete` sweeps
      // local worktrees itself (PROTOCOL.md §5.1), but has no SSH capability
      // for remote workspaces — the FE still opens a dedicated connection to
      // remove the remote worktree, its parent folder, and the remote
      // `.workspace/` metadata directory before the daemon persists the
      // delete.
      const worktreeWorkspaceResult = await this.getWorkspace(id as WorkspaceId);
      const workspaceRow = worktreeWorkspaceResult.ok ? worktreeWorkspaceResult.data : null;
      const ssh = workspaceRow?.environmentConfig?.ssh;
      const remoteWorktreePath = workspaceRow?.worktreePath;
      const remoteRepoPath = workspaceRow?.repositoryPath;
      if (
        workspaceRow &&
        remoteWorktreePath &&
        remoteRepoPath &&
        !workspaceRow.skipWorktree &&
        workspaceRow.isRemote &&
        ssh
      ) {
        const sshConfig: SSHConnectionConfig = {
          host: ssh.host,
          port: ssh.port || 22,
          username: ssh.user,
          password: ssh.password,
          privateKeyPath: ssh.key_path,
          useAgent: ssh.use_agent,
          transport: ssh.transport,
          wsUrl: ssh.ws_url,
        };
        const deleteConnectionId = `delete-${id}`;
        try {
          await sshManager.connect(deleteConnectionId, sshConfig);

          const worktreePathArg = escapeShellArg(remoteWorktreePath);
          const repoPathArg = escapeShellArg(remoteRepoPath);
          await sshManager.executeCommand(
            deleteConnectionId,
            `cd ${repoPathArg} && git worktree remove --force ${worktreePathArg} 2>/dev/null; cd ${repoPathArg} && git worktree prune 2>/dev/null; true`,
            { timeout: 15000 },
          );

          const workspaceFolder = path.posix.dirname(remoteWorktreePath);
          await sshManager.executeCommand(
            deleteConnectionId,
            `rmdir ${escapeShellArg(workspaceFolder)} 2>/dev/null || true`,
            { timeout: 5000 },
          );
          await sshManager.executeCommand(
            deleteConnectionId,
            `rm -rf ~/intent/workspaces/${escapeShellArg(id)}/.workspace`,
            { timeout: 5000 },
          );
        } catch (cleanupErr) {
          logger.warn('Failed to clean up remote workspace', {
            workspaceId: id,
            error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
          });
        } finally {
          await sshManager.disconnect(deleteConnectionId).catch(() => {});
        }
      } else if (worktreeWorkspaceResult.ok && worktreeWorkspaceResult.data.skipWorktree) {
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

      // Track workspace deletion
      trackMain('Deleted Workspace', {
        workspace_id: id,
        workspace_title: workspaceTitle,
        age_in_days: ageInDays,
      });

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

    // Clear periodic PR refresh initial timeout
    if (this.periodicPRRefreshInitialTimeout) {
      clearTimeout(this.periodicPRRefreshInitialTimeout);
      this.periodicPRRefreshInitialTimeout = null;
    }

    // Clear periodic PR refresh timer
    if (this.periodicPRRefreshTimer) {
      clearInterval(this.periodicPRRefreshTimer);
      this.periodicPRRefreshTimer = null;
    }

    // Clear all staggered PR refresh timeouts
    for (const timeout of this.periodicPRStaggeredTimeouts) {
      clearTimeout(timeout);
    }
    this.periodicPRStaggeredTimeouts = [];

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
   * Initialize a new git repository at the given path.
   *
   * Delegates to the daemon (`workspace.initializeRepository`, PROTOCOL.md
   * §5.1). The daemon creates the directory (if missing), runs `git init -b
   * main`, seeds `.gitignore`/`README.md`, and produces an initial commit;
   * the FE only forwards the path.
   */
  async initializeNewRepository(repoPath: string): Promise<Result<void, string>> {
    try {
      logger.info('Initializing new git repository', { repoPath });
      await getBackendClient().request('workspace.initializeRepository', { path: repoPath });
      logger.info('New git repository initialized successfully', { repoPath });
      return { ok: true, data: undefined };
    } catch (error) {
      logger.error('Failed to initialize new git repository', error as Error, { repoPath });
      return {
        ok: false,
        error: `Failed to initialize repository: ${this.extractErrorMessage(error)}`,
      };
    }
  }

  /**
   * Check if a branch already exists in the repository (local or remote)
   */
  private async checkBranchExistsInRepo(repoPath: string, branchName: string): Promise<boolean> {
    try {
      logger.debug('Checking local branches', { repoPath, branchName });
      // Check local branches
      // Use '--' to signal end of options, preventing branch names starting with '-' from being interpreted as options
      const { stdout: localBranches } = await execFileAsync(
        'git',
        ['branch', '--list', '--', branchName],
        { cwd: repoPath },
      );
      logger.debug('Local branch check complete', {
        branchName,
        found: localBranches.trim().length > 0,
      });
      if (localBranches.trim().length > 0) {
        return true;
      }

      logger.debug('Checking remote branches', { repoPath, branchName });
      // Check remote branches (origin/<branchName>)
      // Use '--' to signal end of options, preventing branch names starting with '-' from being interpreted as options
      const { stdout: remoteBranches } = await execFileAsync(
        'git',
        ['branch', '-r', '--list', '--', `origin/${branchName}`],
        { cwd: repoPath },
      );
      logger.debug('Remote branch check complete', {
        branchName,
        found: remoteBranches.trim().length > 0,
      });
      if (remoteBranches.trim().length > 0) {
        return true;
      }

      return false;
    } catch (error) {
      // If git command fails, assume branch doesn't exist
      logger.warn('Branch existence check failed, assuming branch does not exist', {
        repoPath,
        branchName,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Get all branches matching a base slug pattern (both local and remote).
   * Uses a single git command with wildcard to efficiently fetch all matching branches,
   * then filters to only include exact matches and numeric suffixes.
   *
   * For baseSlug "auth-fix", this matches:
   * - "auth-fix" (exact match)
   * - "auth-fix-2", "auth-fix-3", etc. (numeric suffixes)
   *
   * When branchPrefix is provided (e.g., "aw/"), also searches for prefixed branches
   * like "aw/auth-fix", "aw/auth-fix-2", etc. and strips the prefix before adding
   * to the result set. This ensures uniqueness checks account for branches created
   * with a configured prefix.
   *
   * But NOT:
   * - "auth-fixer" (different word)
   * - "auth-fix-feature" (non-numeric suffix)
   */
  private async getBranchesMatchingBaseSlug(
    repoPath: string,
    baseSlug: string,
    branchPrefix?: string,
  ): Promise<Set<string>> {
    const branches = new Set<string>();

    // Use the utility function to create a safe regex pattern
    const validBranchPattern = createSlugPattern(baseSlug);

    const remotePrefix = 'origin/';

    try {
      // Get all local branches matching the pattern in one call
      // Git wildcard "base-slug*" may match more than we want, so we filter after
      const { stdout: localBranches } = await execFileAsync(
        'git',
        ['branch', '--list', '--', `${baseSlug}*`],
        { cwd: repoPath },
      );

      for (const line of localBranches.split('\n')) {
        const branch = parseBranchName(line);
        if (branch && validBranchPattern.test(branch)) {
          branches.add(branch);
        }
      }

      // Get all remote branches matching the pattern in one call
      const { stdout: remoteBranches } = await execFileAsync(
        'git',
        ['branch', '-r', '--list', '--', `${remotePrefix}${baseSlug}*`],
        { cwd: repoPath },
      );

      for (const line of remoteBranches.split('\n')) {
        const localName = parseRemoteBranchName(line, remotePrefix);
        if (localName && validBranchPattern.test(localName)) {
          branches.add(localName);
        }
      }

      // Also search for prefixed branches (e.g., "aw/dark-add*") and strip the prefix.
      // This is critical: without this, the uniqueness check misses branches created with
      // a prefix, causing createGitWorktree to find an existing branch and reuse it
      // instead of creating a new one from the specified baseRef.
      if (branchPrefix) {
        try {
          const prefixedPattern = `${branchPrefix}${baseSlug}*`;

          // Local prefixed branches
          const { stdout: localPrefixed } = await execFileAsync(
            'git',
            ['branch', '--list', '--', prefixedPattern],
            { cwd: repoPath },
          );

          for (const line of localPrefixed.split('\n')) {
            const branch = parseBranchName(line);
            if (branch && branch.startsWith(branchPrefix)) {
              const unprefixed = branch.substring(branchPrefix.length);
              if (unprefixed && validBranchPattern.test(unprefixed)) {
                branches.add(unprefixed);
              }
            }
          }

          // Remote prefixed branches
          const { stdout: remotePrefixed } = await execFileAsync(
            'git',
            ['branch', '-r', '--list', '--', `${remotePrefix}${branchPrefix}${baseSlug}*`],
            { cwd: repoPath },
          );

          for (const line of remotePrefixed.split('\n')) {
            const remoteName = parseRemoteBranchName(line, remotePrefix);
            if (remoteName && remoteName.startsWith(branchPrefix)) {
              const unprefixed = remoteName.substring(branchPrefix.length);
              if (unprefixed && validBranchPattern.test(unprefixed)) {
                branches.add(unprefixed);
              }
            }
          }
        } catch (prefixError) {
          logger.warn('Failed to get prefixed branches matching base slug', {
            baseSlug,
            branchPrefix,
            error: prefixError instanceof Error ? prefixError.message : String(prefixError),
          });
        }
      }

      logger.debug('Found branches matching base slug', {
        baseSlug,
        branchPrefix: branchPrefix || '(none)',
        count: branches.size,
        branches: Array.from(branches).slice(0, 10), // Log first 10 for debugging
      });
    } catch (error) {
      logger.warn('Failed to get branches matching base slug', {
        baseSlug,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return branches;
  }

  /**
   * Ensure the workspace ID (used as branch name) is unique in the repository.
   * If the branch already exists, appends an incrementing numeric suffix.
   *
   * For example: auth-refactor -> auth-refactor-2 -> auth-refactor-3
   *
   * Also checks for Git ref namespace conflicts when a branch prefix is used.
   * Git stores refs hierarchically, so you can't create "intent/foo" if "intent" exists.
   * If there's a prefix conflict, returns an error with instructions to fix it.
   *
   * Optimized to fetch all matching branches in a single git call rather than
   * checking each suffix individually.
   *
   * @param originalId - The workspace ID to check
   * @param repoPath - Path to the git repository
   * @param branchPrefix - Optional branch prefix (e.g., "intent/")
   * @returns The unique workspace ID, or an error if there's a prefix conflict
   */
  private async ensureUniqueBranchName(
    originalId: WorkspaceId,
    repoPath: string,
    branchPrefix?: string,
  ): Promise<Result<WorkspaceId, string>> {
    const maxAttempts = 100; // Support up to 100 collisions
    const baseSlug = extractBaseSlug(originalId);

    logger.debug('Checking branch name uniqueness', {
      originalId,
      baseSlug,
      repoPath,
      branchPrefix,
    });

    // If there's a branch prefix, check if the prefix itself has a namespace conflict
    // e.g., prefix "intent/" conflicts if branch "intent" exists
    // Git stores refs as files, so you can't have both "intent" (file) and "intent/foo" (directory)
    if (branchPrefix) {
      const prefixWithoutTrailingSlash = branchPrefix.replace(/\/$/, '');
      const prefixParts = prefixWithoutTrailingSlash.split('/');

      for (let i = 1; i <= prefixParts.length; i++) {
        const parentPath = prefixParts.slice(0, i).join('/');
        try {
          const { stdout } = await execFileAsync('git', ['branch', '--list', '--', parentPath], {
            cwd: repoPath,
          });
          if (stdout.trim()) {
            logger.error('Branch prefix conflicts with existing branch', {
              branchPrefix,
              conflictingBranch: parentPath,
            });
            return {
              ok: false,
              error:
                `Cannot create workspace: branch "${parentPath}" conflicts with your branch prefix "${branchPrefix}". ` +
                `Git doesn't allow a branch and a prefix with the same name. ` +
                `Please rename the branch (git branch -m ${parentPath} ${parentPath}-old) or change your branch prefix in Settings → Interface & System.`,
            };
          }
        } catch {
          // Ignore errors, continue checking
        }
      }
    }

    // Fetch all branches matching the base slug pattern in a single call
    // This is much faster than checking each suffix individually
    // Pass branchPrefix so we also find prefixed branches (e.g., "aw/dark-add-58")
    // and treat them as taken workspace IDs
    const existingBranches = await this.getBranchesMatchingBaseSlug(
      repoPath,
      baseSlug,
      branchPrefix,
    );

    // If original ID doesn't exist, use it directly
    if (!existingBranches.has(originalId)) {
      logger.debug('Original branch name is unique', { branchName: originalId });
      return { ok: true, data: originalId };
    }

    logger.info('Branch already exists, finding next available suffix', {
      branchName: originalId,
      existingCount: existingBranches.size,
    });

    // Find the highest existing suffix number among branches like "base-slug-2", "base-slug-3", etc.
    // We start at 1 so that if only the base slug exists (no numbered suffixes),
    // the next suffix will be 2 (i.e., "base-slug-2"), not 1.
    let maxExistingSuffix = 1;
    const suffixPattern = createSuffixCapturePattern(baseSlug);

    for (const branch of existingBranches) {
      const match = branch.match(suffixPattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxExistingSuffix) {
          maxExistingSuffix = num;
        }
      }
    }

    // Use the next available suffix
    const nextSuffix = maxExistingSuffix + 1;

    if (nextSuffix > maxAttempts) {
      return {
        ok: false,
        error: `Failed to generate unique branch name: suffix ${nextSuffix} exceeds maximum ${maxAttempts}`,
      };
    }

    const candidateId = appendSlugSuffix(baseSlug, nextSuffix) as WorkspaceId;

    logger.info('Found unique branch name with suffix', {
      original: originalId,
      unique: candidateId,
      suffix: nextSuffix,
    });

    // Register this ID with the ID service
    this.idService.registerWorkspaceId(candidateId);
    return { ok: true, data: candidateId };
  }

  /**
   * Acquire a lock for git worktree operations on a specific repository.
   * This ensures that only one git worktree add/remove runs at a time per repo,
   * preventing corruption of the .git/worktrees directory.
   *
   * The lock works by chaining promises: each caller captures the current lock
   * and sets their own lock synchronously (before any await), then waits for
   * the previous lock. This ensures proper serialization even when multiple
   * callers arrive concurrently.
   */
  private async withGitWorktreeLock<T>(repoPath: string, operation: () => Promise<T>): Promise<T> {
    const startTime = Date.now();

    // Capture the current lock (if any) that we need to wait for
    const existingLock = this.gitWorktreeLocks.get(repoPath);

    // Create our lock promise that will resolve when our operation completes
    let resolve!: () => void;
    const newLock = new Promise<void>((r) => {
      resolve = r;
    });

    // IMPORTANT: Set our lock synchronously BEFORE any await.
    // This ensures that any concurrent callers will see our lock and chain after us.
    // If we set the lock after awaiting, multiple waiters could wake up simultaneously
    // and race to set their locks, breaking the chain.
    this.gitWorktreeLocks.set(repoPath, newLock);

    // Now wait for the previous operation if there was one
    if (existingLock) {
      logger.info('Waiting for existing git worktree lock', { repoPath });
      try {
        await existingLock;
      } catch {
        // Ignore errors from previous operation, we just need to wait for it
      }
      const waitTime = Date.now() - startTime;
      logger.info('Acquired git worktree lock after waiting', { repoPath, waitTimeMs: waitTime });
    }

    const operationStartTime = Date.now();
    try {
      return await operation();
    } finally {
      const operationTime = Date.now() - operationStartTime;
      logger.info('Git worktree operation completed', { repoPath, operationTimeMs: operationTime });
      resolve();
      // Clean up the lock only if no one else has chained after us
      if (this.gitWorktreeLocks.get(repoPath) === newLock) {
        this.gitWorktreeLocks.delete(repoPath);
      }
    }
  }

  private async createGitWorktree(
    repoPath: string,
    worktreePath: string,
    branch: string,
    baseRef?: string,
    remote: string = 'origin',
  ): Promise<Result<void, string>> {
    // FIX: Use lock to serialize git worktree operations per repository
    // This prevents corruption when multiple add/remove operations run concurrently
    const worktreeResult = await this.withGitWorktreeLock(repoPath, async () => {
      try {
        logger.info('Creating git worktree', {
          repoPath,
          worktreePath,
          branch,
          baseRef,
          remote,
        });

        // Prune stale worktree references before creating new ones
        // This cleans up any corrupted or orphaned entries in .git/worktrees
        // that could cause creation to fail
        try {
          await execFileAsync('git', ['worktree', 'prune'], { cwd: repoPath });
          logger.debug('Pruned stale worktree references before creation');
        } catch {
          // Prune is best-effort, continue if it fails
          logger.debug('Worktree prune before creation failed, continuing');
        }

        // Check if the worktree directory already exists
        // This can happen if a previous workspace creation failed or if there's a stale directory
        if (await fsExtra.pathExists(worktreePath)) {
          logger.info('Worktree path already exists, checking if it is a valid worktree', {
            worktreePath,
          });

          // Check if this directory is registered as a worktree
          try {
            const { stdout: worktreeList } = await execFileAsync(
              'git',
              ['worktree', 'list', '--porcelain'],
              { cwd: repoPath },
            );

            // Parse the worktree list to see if our path is registered
            // Format: "worktree /absolute/path/to/worktree"
            const lines = worktreeList.split('\n');
            let isRegisteredWorktree = false;
            for (const line of lines) {
              if (line.startsWith('worktree ')) {
                const registeredPath = line.substring('worktree '.length);
                // Exact match to avoid matching /foo/bar when looking for /foo/bar-2
                if (registeredPath === worktreePath) {
                  isRegisteredWorktree = true;
                  break;
                }
              }
            }

            if (isRegisteredWorktree) {
              // The directory is a valid worktree - this is an unexpected state
              // The branch uniqueness check should have prevented this
              // Don't silently return success - this could mask bugs
              // Instead, try to remove and recreate to ensure clean state
              logger.warn(
                'Worktree path is already registered, attempting to remove and recreate',
                {
                  worktreePath,
                  branch,
                },
              );
              try {
                await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], {
                  cwd: repoPath,
                });
                logger.info('Removed existing registered worktree', { worktreePath });
              } catch (removeError) {
                logger.error(
                  'Failed to remove existing registered worktree',
                  removeError as Error,
                  {
                    worktreePath,
                  },
                );
                return {
                  ok: false as const,
                  error: `Worktree already exists at ${worktreePath} and could not be removed`,
                };
              }
            } else {
              // Directory exists but is not a registered worktree - it's orphaned
              // Remove it so we can create a fresh worktree
              logger.info('Removing orphaned worktree directory', { worktreePath });
              await fsExtra.remove(worktreePath);
            }
          } catch (listError) {
            // If we can't list worktrees, try to remove the directory anyway
            logger.warn('Could not list worktrees, removing existing directory', {
              worktreePath,
              error: (listError as Error).message,
            });
            try {
              await fsExtra.remove(worktreePath);
            } catch (removeError) {
              logger.error('Failed to remove existing worktree directory', removeError as Error, {
                worktreePath,
              });
              return {
                ok: false as const,
                error: `Worktree path already exists and could not be removed: ${worktreePath}`,
              };
            }
          }
        }

        // Skip LFS smudge filter during worktree checkout to prevent failures when
        // LFS objects are missing from the server (e.g., expired demo repos, forks without
        // LFS transfer, or unreachable LFS servers). LFS pointer files will remain in place
        // and we'll attempt to pull LFS objects afterward as a best-effort operation.
        const lfsSkipEnv = { GIT_LFS_SKIP_SMUDGE: '1' };

        // Check if branch exists (use execFile to prevent injection)
        const { stdout: branches } = await execFileAsync('git', ['branch', '--list', branch], {
          cwd: repoPath,
        });
        const branchExists = branches.trim().length > 0;

        // Determine the target ref for fetching and resolution
        // If branch exists, we still want to fetch to ensure we have latest remote state
        const targetRef = baseRef || 'HEAD';

        // Determine what kind of ref we're dealing with
        const refInfo = await this.analyzeGitRef(repoPath, targetRef, remote);
        logger.debug('Analyzed git ref', { targetRef, refInfo, branchExists, remote });

        // Step 1: Try to fetch from remote if this is a branch ref
        // Skip fetch for: HEAD, tags, SHAs, or if the specified remote doesn't exist
        // Always fetch, even if branch exists locally, to ensure we have latest remote state
        if (refInfo.type === 'branch' && refInfo.remoteBranchName) {
          const hasRemoteConfigured = await this.hasRemote(repoPath, remote);
          if (hasRemoteConfigured) {
            try {
              // Surgical fetch: only fetch the specific branch we need
              // Use '+' prefix to allow non-fast-forward updates (handles force pushes)
              await execFileAsync(
                'git',
                [
                  'fetch',
                  remote,
                  `+refs/heads/${refInfo.remoteBranchName}:refs/remotes/${remote}/${refInfo.remoteBranchName}`,
                ],
                { cwd: repoPath, timeout: 30_000 },
              );
              logger.debug('Fetched latest from remote', {
                remote,
                branch: refInfo.remoteBranchName,
              });
            } catch (fetchError) {
              // Fetch failed - log at info level so users know they might be on stale state
              const errMsg = (fetchError as Error).message;
              if (
                errMsg.includes('Could not read from remote') ||
                errMsg.includes('Permission denied')
              ) {
                logger.info('Fetch failed (auth/network issue), using local state', {
                  remote,
                  branch: refInfo.remoteBranchName,
                  error: errMsg,
                });
              } else if (errMsg.includes("couldn't find remote ref")) {
                logger.debug('Branch does not exist on remote, using local state', {
                  remote,
                  branch: refInfo.remoteBranchName,
                });
              } else {
                logger.debug('Fetch failed, using local state', {
                  remote,
                  branch: refInfo.remoteBranchName,
                  error: errMsg,
                });
              }
            }
          } else {
            logger.debug('Specified remote not configured, skipping fetch', { remote });
          }
        }

        if (branchExists) {
          // Branch already exists locally
          // We've already fetched above, so remote-tracking refs are up-to-date
          // Try to fast-forward the local branch to its upstream before creating worktree
          // This ensures the worktree starts with the latest code
          try {
            // Check if the branch has an upstream and if we can fast-forward
            const { stdout: upstream } = await execFileAsync(
              'git',
              ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`],
              { cwd: repoPath },
            );
            const upstreamBranch = upstream.trim();
            if (upstreamBranch) {
              // Check if we can fast-forward (local is ancestor of upstream)
              const { stdout: mergeBase } = await execFileAsync(
                'git',
                ['merge-base', branch, upstreamBranch],
                { cwd: repoPath },
              );
              const { stdout: localSha } = await execFileAsync('git', ['rev-parse', branch], {
                cwd: repoPath,
              });
              if (mergeBase.trim() === localSha.trim()) {
                // Can fast-forward - update the branch ref directly
                const { stdout: upstreamSha } = await execFileAsync(
                  'git',
                  ['rev-parse', upstreamBranch],
                  { cwd: repoPath },
                );
                await execFileAsync(
                  'git',
                  ['update-ref', `refs/heads/${branch}`, upstreamSha.trim()],
                  { cwd: repoPath },
                );
                logger.info('Fast-forwarded existing branch to upstream', {
                  branch,
                  upstreamBranch,
                  newSha: upstreamSha.trim().slice(0, 8),
                });
              } else {
                logger.debug('Branch has local commits, not fast-forwarding', { branch });
              }
            }
          } catch {
            // No upstream or other issue - that's fine, use branch as-is
            logger.debug('Could not check upstream for existing branch', { branch });
          }

          logger.debug('Creating worktree from existing branch', { branch });
          await execFileAsync('git', ['worktree', 'add', worktreePath, branch], {
            cwd: repoPath,
            env: lfsSkipEnv,
          });
        } else {
          // Create new branch from baseRef
          // Best practice: resolve to SHA -> create worktree from SHA -> set upstream
          let baseSha: string | undefined;
          let upstreamBranch: string | null = null;

          // Step 2: Resolve the ref to a SHA
          // Try refs in order of freshness: <remote>/<branch> -> original ref -> HEAD
          const refsToTry: Array<{ ref: string; setUpstream: boolean; upstreamName?: string }> = [];
          const addedRefs = new Set<string>(); // Avoid duplicates

          // If it's a branch, try <remote>/<branch> first (freshest after fetch)
          if (refInfo.type === 'branch' && refInfo.remoteBranchName) {
            const remoteTrackingRef = `${remote}/${refInfo.remoteBranchName}`;
            refsToTry.push({
              ref: remoteTrackingRef,
              setUpstream: true,
              upstreamName: remoteTrackingRef,
            });
            addedRefs.add(remoteTrackingRef);
          }

          // Try the original ref (if not already added)
          if (!addedRefs.has(targetRef)) {
            // Only set upstream for local branches, not for <remote>/* refs
            const isLocalBranch = refInfo.type === 'branch' && !targetRef.includes('/');
            refsToTry.push({ ref: targetRef, setUpstream: isLocalBranch });
            addedRefs.add(targetRef);
          }

          // HEAD as final fallback
          if (targetRef !== 'HEAD' && !addedRefs.has('HEAD')) {
            refsToTry.push({ ref: 'HEAD', setUpstream: false });
          }

          // Try each ref until one resolves
          for (const { ref, setUpstream, upstreamName } of refsToTry) {
            try {
              const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', ref], {
                cwd: repoPath,
              });
              baseSha = stdout.trim();

              // Set upstream if this is a branch ref
              if (setUpstream) {
                if (upstreamName) {
                  upstreamBranch = upstreamName;
                } else {
                  // Check if local branch has an upstream configured
                  try {
                    const { stdout: upstream } = await execFileAsync(
                      'git',
                      ['rev-parse', '--abbrev-ref', `${ref}@{upstream}`],
                      { cwd: repoPath },
                    );
                    upstreamBranch = upstream.trim();
                  } catch {
                    // No upstream configured - that's fine
                  }
                }
              }

              logger.debug('Resolved ref to SHA', { ref, baseSha, upstreamBranch });
              break;
            } catch {
              // This ref doesn't exist, try next
              logger.debug('Ref not found, trying next', { ref });
            }
          }

          if (!baseSha) {
            // This shouldn't happen since HEAD should always exist
            throw new Error(
              `Could not resolve any ref to create worktree. Tried: ${refsToTry.map((r) => r.ref).join(', ')}`,
            );
          }

          // Step 3: Create worktree from the resolved SHA
          // Using SHA ensures we get exactly the commit we resolved, even if refs move
          logger.info('Creating new branch from SHA', { branch, baseSha, upstreamBranch });
          await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreePath, baseSha], {
            cwd: repoPath,
            env: lfsSkipEnv,
          });

          // Step 4: Set upstream tracking if we have one
          // This allows `git pull` and `git push` to work correctly in the worktree
          if (upstreamBranch) {
            try {
              await execFileAsync('git', ['branch', '--set-upstream-to', upstreamBranch, branch], {
                cwd: repoPath,
              });
              logger.debug('Set upstream tracking', { branch, upstreamBranch });
            } catch (upstreamError) {
              // Non-fatal: upstream tracking is nice-to-have
              logger.debug('Could not set upstream tracking', {
                branch,
                upstreamBranch,
                error: (upstreamError as Error).message,
              });
            }
          }
        }

        logger.info('Git worktree created successfully', { worktreePath });
        return { ok: true as const, data: undefined };
      } catch (error) {
        logger.error('Git worktree creation failed', error as Error, {
          repoPath,
          worktreePath,
          branch,
        });
        return {
          ok: false as const,
          error: this.extractErrorMessage(error),
        };
      }
    });

    // Best-effort: attempt to pull LFS objects now that the worktree exists.
    // Done outside the worktree lock to avoid holding it during potentially slow
    // LFS downloads. If this fails (missing objects, no network, etc.), the workspace
    // is still functional — files tracked by LFS will just contain pointer content.
    if (worktreeResult.ok) {
      try {
        await execFileAsync('git', ['lfs', 'pull'], {
          cwd: worktreePath,
          timeout: 60000, // 60s timeout to avoid blocking workspace creation
        });
        logger.info('Git LFS pull completed successfully', { worktreePath });
      } catch (lfsError) {
        logger.warn('Git LFS pull failed (non-fatal, workspace still usable)', {
          worktreePath,
          error: lfsError instanceof Error ? lfsError.message : String(lfsError),
        });
      }
    }

    return worktreeResult;
  }

  /**
   * Analyze a git ref to determine its type and extract useful information.
   * This helps us decide whether to fetch and how to resolve the ref.
   */
  private async analyzeGitRef(
    repoPath: string,
    ref: string,
    remote: string = 'origin',
  ): Promise<{
    type: 'head' | 'branch' | 'tag' | 'sha' | 'unknown';
    remoteBranchName?: string; // The branch name to use for fetching (without remote/ prefix)
  }> {
    // HEAD is special
    if (ref === 'HEAD') {
      return { type: 'head' };
    }

    // Check if it looks like a SHA (40 hex chars or abbreviated)
    if (/^[0-9a-f]{7,40}$/i.test(ref)) {
      return { type: 'sha' };
    }

    // Check if it's a remote ref matching the selected remote (e.g., origin/main, upstream/main)
    // We only strip the prefix if it matches the selected remote to avoid ambiguity
    // with branch names that contain slashes (e.g., feature/auth/login)
    const remotePrefix = `${remote}/`;
    if (ref.startsWith(remotePrefix)) {
      return {
        type: 'branch',
        remoteBranchName: ref.slice(remotePrefix.length),
      };
    }

    // Also check for common remote prefixes (origin/, upstream/) even if they don't match
    // the selected remote - user might pass origin/main when remote is upstream
    // But only for these well-known remotes to avoid false positives with branch names
    const wellKnownRemotes = ['origin', 'upstream'];
    for (const knownRemote of wellKnownRemotes) {
      if (knownRemote !== remote && ref.startsWith(`${knownRemote}/`)) {
        return {
          type: 'branch',
          remoteBranchName: ref.slice(knownRemote.length + 1),
        };
      }
    }

    // Check if it's a tag
    try {
      const { stdout } = await execFileAsync('git', ['cat-file', '-t', `refs/tags/${ref}`], {
        cwd: repoPath,
      });
      if (stdout.trim() === 'tag' || stdout.trim() === 'commit') {
        return { type: 'tag' };
      }
    } catch {
      // Not a tag, continue
    }

    // Check if it's a local branch
    try {
      await execFileAsync('git', ['show-ref', '--verify', `refs/heads/${ref}`], {
        cwd: repoPath,
      });
      return { type: 'branch', remoteBranchName: ref };
    } catch {
      // Not a local branch
    }

    // Check if it's a remote-tracking branch (without remote/ prefix)
    try {
      await execFileAsync('git', ['show-ref', '--verify', `refs/remotes/${remote}/${ref}`], {
        cwd: repoPath,
      });
      return { type: 'branch', remoteBranchName: ref };
    } catch {
      // Not a remote branch either
    }

    // Unknown ref type - might be a branch that doesn't exist yet locally
    // Assume it's a branch name for fetching purposes
    return { type: 'branch', remoteBranchName: ref };
  }

  /**
   * Check if a remote exists in the repository.
   */
  private async hasRemote(repoPath: string, remoteName: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('git', ['remote'], { cwd: repoPath });
      const remotes = stdout.trim().split('\n').filter(Boolean);
      return remotes.includes(remoteName);
    } catch {
      return false;
    }
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
