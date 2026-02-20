/**
 * PR Status Service - Client-side service for refreshing pull request status
 * Provides manual refresh, automatic polling, and window focus refresh functionality
 */
import { invoke } from '$lib/electron-bridge';
import { workspaceStore } from '$features/workspace/workspace.store.svelte';
import { logger } from '$lib/utils/client-logger';
import type { WorkspaceId } from '$shared/types/branded-ids';
import { PullRequestStatus, type PullRequestInfo, type Workspace } from '$shared/types';

// Polling interval in milliseconds (30 seconds)
const POLLING_INTERVAL_MS = 30_000;

// Minimum time between refreshes to avoid rate limiting (5 seconds)
const MIN_REFRESH_INTERVAL_MS = 5_000;

// Track last refresh time per workspace to avoid excessive API calls
const lastRefreshTime = new Map<string, number>();

// Track active polling intervals per workspace
const pollingIntervals = new Map<string, ReturnType<typeof setInterval>>();

// Track window focus/visibility listeners
let windowFocusListenerRegistered = false;
let windowVisibilityListenerRegistered = false;
const windowFocusCallbacks = new Map<WorkspaceId, () => void>();

function handleWindowFocus() {
  for (const callback of windowFocusCallbacks.values()) {
    callback();
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    handleWindowFocus();
  }
}


/**
 * Sanitize data for IPC by converting any Svelte reactive proxies to plain objects.
 * This prevents "An object could not be cloned" errors from structured clone.
 * 
 * Returns undefined on serialization failure rather than an empty object,
 * to avoid creating malformed objects that could violate type expectations.
 */
function sanitizeForIpc<T>(data: T): T | undefined {
  if (data === null || data === undefined) {
    return data;
  }
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    // Return undefined on failure - safer than returning {} which could
    // create a malformed object missing required fields
    return undefined;
  }
}



function normalizePullRequestStatus(pr: any): PullRequestStatus {
  const isMerged = Boolean(pr?.merged ?? pr?.merged_at ?? pr?.mergedAt);
  if (isMerged) return PullRequestStatus.Merged;

  const state = String(pr?.state ?? pr?.status ?? '').toLowerCase();
  if (pr?.draft === true || pr?.isDraft === true || state === 'draft') {
    return PullRequestStatus.Draft;
  }

  if (state === 'closed') return PullRequestStatus.Closed;
  return PullRequestStatus.Open;
}

function normalizePullRequestInfo(
  pr: any,
  existing: PullRequestInfo | null,
  status: PullRequestStatus,
): PullRequestInfo {
  const number = pr?.number ?? existing?.number ?? 0;
  const url = pr?.html_url ?? pr?.htmlUrl ?? pr?.url ?? existing?.url ?? '';
  const createdAt = pr?.created_at ?? pr?.createdAt ?? existing?.createdAt ?? new Date().toISOString();
  const updatedAt = pr?.updated_at ?? pr?.updatedAt ?? existing?.updatedAt ?? new Date().toISOString();

  // Don't spread the raw pr object as it may have a different 'url' field
  // that would overwrite our computed url
  return {
    ...(existing ?? {}),
    id: String(pr?.id ?? existing?.id ?? number),
    number,
    url,
    title: pr?.title || existing?.title || `PR #${number}`,
    status,
    createdAt,
    updatedAt,
    mergedAt: pr?.merged_at ?? pr?.mergedAt ?? existing?.mergedAt,
    closedAt: pr?.closed_at ?? pr?.closedAt ?? existing?.closedAt,
    isDraft: pr?.draft ?? pr?.isDraft ?? existing?.isDraft,
  };
}

/**
 * Merge two arrays of pull requests by PR number.
 * - Discovered PRs take precedence for existing entries (updated data)
 * - Existing PRs not in discovered are preserved (historical data)
 */
function mergePullRequestArrays(
  existing: PullRequestInfo[],
  discovered: PullRequestInfo[],
): PullRequestInfo[] {
  const merged = new Map<number, PullRequestInfo>();

  // Add existing PRs first
  for (const pr of existing) {
    merged.set(pr.number, pr);
  }

  // Discovered PRs override existing (fresher data)
  for (const pr of discovered) {
    merged.set(pr.number, pr);
  }

  // Sort by createdAt descending (most recent first)
  return Array.from(merged.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/**
 * Find the most recent open PR from an array.
 */
function findMostRecentOpenPR(pullRequests: PullRequestInfo[]): PullRequestInfo | null {
  const openPRs = pullRequests.filter(
    (pr) => pr.status === PullRequestStatus.Open || pr.status === PullRequestStatus.Draft,
  );

  if (openPRs.length === 0) {
    return null;
  }

  // Sort by createdAt descending and return the first (most recent)
  return openPRs.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
}

/**
 * Discover all PRs for the workspace branch.
 * Queries GitHub with state: 'all' to get open, closed, and merged PRs.
 */
async function discoverPRsForBranch(
  workspaceId: WorkspaceId,
  workspace: Workspace,
  options: { force?: boolean } = {},
): Promise<{ success: boolean; prs?: PullRequestInfo[]; error?: string }> {
  if (!workspace.branch) {
    return { success: true, prs: [] };
  }

  try {
    logger.debug('[PRStatusService] Discovering PRs for branch', {
      workspaceId,
      branch: workspace.branch,
      owner: workspace.repositoryOwner,
      repo: workspace.repositoryName,
    });

    // Query GitHub for ALL PRs matching this branch (open, closed, merged)
    const response = (await invoke('git-tracking:get-pull-requests', {
      owner: workspace.repositoryOwner,
      repo: workspace.repositoryName,
      options: {
        state: 'all',
        head: `${workspace.repositoryOwner}:${workspace.branch}`,
      },
      force: options.force,
    })) as { success?: boolean; data?: any[]; error?: string };

    if (!response.success) {
      logger.warn('[PRStatusService] Failed to query PRs for branch', {
        workspaceId,
        error: response.error,
      });
      return { success: false, error: response.error || 'Failed to query PRs' };
    }

    const prs = response.data || [];
    const normalizedPRs: PullRequestInfo[] = prs.map((pr) => {
      const status = normalizePullRequestStatus(pr);
      return normalizePullRequestInfo(pr, null, status);
    });

    logger.debug('[PRStatusService] Discovered PRs for branch', {
      workspaceId,
      branch: workspace.branch,
      count: normalizedPRs.length,
    });

    return { success: true, prs: normalizedPRs };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    logger.error('[PRStatusService] Failed to discover PRs for branch', err as Error);
    return { success: false, error };
  }
}

export interface RefreshPRStatusOptions {
  /** Force refresh even if recently refreshed */
  force?: boolean;
}

export interface RefreshPRStatusResult {
  success: boolean;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
  discovered?: boolean;
}

/**
 * Refresh the PR status for a specific workspace.
 * Always queries GitHub for PRs matching the branch, merges with existing PRs,
 * and sets activePullRequest to the most recent open PR.
 */
export async function refreshPRStatus(
  workspaceId: WorkspaceId,
  options: RefreshPRStatusOptions = {},
): Promise<RefreshPRStatusResult> {
  const { force = false } = options;

  // Check if we should skip due to rate limiting
  if (!force) {
    const lastRefresh = lastRefreshTime.get(workspaceId);
    if (lastRefresh && Date.now() - lastRefresh < MIN_REFRESH_INTERVAL_MS) {
      return {
        success: true,
        skipped: true,
        skipReason: 'Rate limited - refreshed recently',
      };
    }
  }

  const workspace = workspaceStore.findById(workspaceId);
  if (!workspace) {
    return { success: false, error: 'Workspace not found' };
  }

  if (!workspace.repositoryOwner || !workspace.repositoryName) {
    return { success: false, error: 'Missing repository info' };
  }

  try {
    logger.debug('[PRStatusService] Refreshing PR status', {
      workspaceId,
      hasActivePR: !!workspace.activePullRequest,
      existingPRCount: workspace.pullRequests?.length ?? 0,
    });

    // Step 1: Refresh the active PR if it exists (to get latest status)
    let refreshedActivePR: PullRequestInfo | null = null;
    if (workspace.activePullRequest) {
      const response = (await invoke('git-tracking:get-pull-request', {
        owner: workspace.repositoryOwner,
        repo: workspace.repositoryName,
        number: workspace.activePullRequest.number,
        force,
      })) as { success?: boolean; data?: any; error?: string };

      if (response.success && response.data) {
        const normalizedStatus = normalizePullRequestStatus(response.data);
        refreshedActivePR = normalizePullRequestInfo(
          response.data,
          workspace.activePullRequest,
          normalizedStatus,
        );
      }
    }

    // Step 2: Refresh ALL existing PRs by their PR number (to get latest title/status)
    const existingPRs = workspace.pullRequests || [];
    const refreshedExistingPRs: PullRequestInfo[] = [];
    for (const existingPR of existingPRs) {
      try {
        const response = (await invoke('git-tracking:get-pull-request', {
          owner: workspace.repositoryOwner,
          repo: workspace.repositoryName,
          number: existingPR.number,
          force,
        })) as { success?: boolean; data?: any; error?: string };

        if (response.success && response.data) {
          const normalizedStatus = normalizePullRequestStatus(response.data);
          const refreshedPR = normalizePullRequestInfo(
            response.data,
            existingPR,
            normalizedStatus,
          );
          refreshedExistingPRs.push(refreshedPR);
        } else {
          // Keep the existing PR if we could not refresh it
          refreshedExistingPRs.push(existingPR);
        }
      } catch {
        // Keep the existing PR on error
        refreshedExistingPRs.push(existingPR);
      }
    }


    // Step 3: Discover all PRs for the branch (open, closed, merged)
    const discoveryResult = await discoverPRsForBranch(workspaceId, workspace, { force });
    if (!discoveryResult.success) {
      return { success: false, error: discoveryResult.error };
    }

    const discoveredPRs = discoveryResult.prs || [];

    // Step 4: Merge refreshed existing PRs with discovered PRs
    // If we refreshed the active PR, merge it last so its data takes precedence
    const discoveredWithRefreshed = refreshedActivePR
      ? mergePullRequestArrays(discoveredPRs, [refreshedActivePR])
      : discoveredPRs;

    const mergedPRs = mergePullRequestArrays(refreshedExistingPRs, discoveredWithRefreshed);

    // Step 5: Determine the active PR (most recent open PR, or null)
    const newActivePR = findMostRecentOpenPR(mergedPRs);

    // Compute legacy fields from active PR
    const prStatus = newActivePR?.status ?? null;
    const prNumber = newActivePR?.number ?? null;
    const prUrl = newActivePR?.url ?? null;

    logger.info('[PRStatusService] PR refresh complete', {
      workspaceId,
      totalPRs: mergedPRs.length,
      discoveredPRs: discoveredPRs.length,
      activePRNumber: newActivePR?.number ?? null,
      activePRStatus: prStatus,
    });

    // Step 6: Update workspace with merged PRs and active PR
    const updateResult = (await invoke('workspace:update', {
      id: workspaceId,
      prStatus,
      prNumber,
      prUrl,
      activePullRequest: sanitizeForIpc(newActivePR),
      pullRequests: sanitizeForIpc(mergedPRs),
    })) as { success?: boolean; ok?: boolean; error?: any };

    // Check if the update failed and log a warning
    if (!updateResult.success && !updateResult.ok) {
      logger.warn('[PRStatusService] workspace:update failed', {
        workspaceId,
        error: updateResult.error,
        prStatus,
        prNumber,
        prUrl,
      });
    }


    // Validate workspace before updating local store to prevent race conditions.
    // Check if the current workspace matches the workspace we're updating.
    const currentWorkspaceId = workspaceStore.current?.id;
    const workspaceMatches = currentWorkspaceId === workspaceId;

    // Always update the store since updateLocalWorkspace is scoped by ID,
    // but log a debug message if workspace doesn't match (helps debug race conditions)
    if (!workspaceMatches) {
      logger.debug('[PRStatusService] Workspace mismatch during PR refresh', {
        targetWorkspaceId: workspaceId,
        currentWorkspaceId,
        activePRNumber: newActivePR?.number ?? null,
      });
    }

    // Update local store immediately (use undefined instead of null for optional fields)
    workspaceStore.updateLocalWorkspace(workspaceId, {
      prStatus: prStatus ?? undefined,
      prNumber: prNumber ?? undefined,
      prUrl: prUrl ?? undefined,
      activePullRequest: sanitizeForIpc(newActivePR) ?? undefined,
      pullRequests: sanitizeForIpc(mergedPRs),
    });

    // Update last refresh time
    lastRefreshTime.set(workspaceId, Date.now());

    return {
      success: true,
      discovered: discoveredPRs.length > 0 && !workspace.activePullRequest,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    logger.error('[PRStatusService] Failed to refresh PR status', err as Error);
    return { success: false, error };
  }
}

/**
 * Start automatic polling for PR status updates
 * Returns a cleanup function to stop polling
 */
export function startPRStatusPolling(workspaceId: WorkspaceId): () => void {
  // Stop any existing polling for this workspace
  stopPRStatusPolling(workspaceId);

  const workspace = workspaceStore.findById(workspaceId);
  if (!workspace?.activePullRequest) {
    return () => {};
  }

  logger.debug('[PRStatusService] Starting PR status polling', { workspaceId });

  const intervalId = setInterval(() => {
    // Validate that this workspace is still the current active workspace
    // to avoid unnecessary API calls for workspaces the user isn't viewing
    const currentWorkspaceId = workspaceStore.current?.id;
    if (currentWorkspaceId !== workspaceId) {
      logger.debug('[PRStatusService] Polling tick but workspace not current, skipping refresh', {
        targetWorkspaceId: workspaceId,
        currentWorkspaceId,
      });
      return;
    }
    refreshPRStatus(workspaceId);
  }, POLLING_INTERVAL_MS);

  pollingIntervals.set(workspaceId, intervalId);

  return () => stopPRStatusPolling(workspaceId);
}

/**
 * Stop PR status polling for a workspace
 */
export function stopPRStatusPolling(workspaceId: WorkspaceId): void {
  const intervalId = pollingIntervals.get(workspaceId);
  if (intervalId) {
    clearInterval(intervalId);
    pollingIntervals.delete(workspaceId);
    logger.debug('[PRStatusService] Stopped PR status polling', { workspaceId });
  }
}

/**
 * Register window focus listener to refresh PR status when app regains focus
 * Returns a cleanup function to unregister the listener
 */
export function registerWindowFocusRefresh(workspaceId: WorkspaceId): () => void {
  // Create the callback for this workspace
  // with workspace validation to avoid triggering API calls for non-current workspaces
  const callback = () => {
    // Validate that this workspace is still the current active workspace
    // to avoid triggering API calls for workspaces the user isn't viewing
    const currentWorkspaceId = workspaceStore.current?.id;
    if (currentWorkspaceId !== workspaceId) {
      logger.debug('[PRStatusService] Window focused but workspace not current, skipping refresh', {
        targetWorkspaceId: workspaceId,
        currentWorkspaceId,
      });
      return;
    }

    const workspace = workspaceStore.findById(workspaceId);
    if (workspace?.activePullRequest) {
      logger.debug('[PRStatusService] Window focused - refreshing PR status', { workspaceId });
      refreshPRStatus(workspaceId, { force: true });
    }
  };

  // Only register one global listener for focus/visibility, track callbacks per workspace
  if (!windowFocusListenerRegistered) {
    window.addEventListener('focus', handleWindowFocus);
    windowFocusListenerRegistered = true;
  }

  if (!windowVisibilityListenerRegistered) {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    windowVisibilityListenerRegistered = true;
  }

  windowFocusCallbacks.set(workspaceId, callback);

  return () => {
    windowFocusCallbacks.delete(workspaceId);
  };
}

/**
 * Clean up all PR status tracking for a workspace.
 * Call this when a workspace is closed or deleted to prevent memory leaks.
 *
 * @param workspaceId - The workspace ID to clean up
 */
export function cleanupPRStatusForWorkspace(workspaceId: WorkspaceId): void {
  // Stop polling interval
  stopPRStatusPolling(workspaceId);

  // Clear last refresh time
  if (lastRefreshTime.has(workspaceId)) {
    lastRefreshTime.delete(workspaceId);
    logger.debug('[PRStatusService] Cleared last refresh time for workspace', { workspaceId });
  }

  // Remove window focus callback
  if (windowFocusCallbacks.has(workspaceId)) {
    windowFocusCallbacks.delete(workspaceId);
    logger.debug('[PRStatusService] Removed window focus callback for workspace', { workspaceId });
  }
}
