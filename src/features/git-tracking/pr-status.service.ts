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

  // Extract mergeability fields from raw PR data
  // The raw response contains mergeable (boolean | null), mergeable_state (string), review_comments (number)
  const mergeable = pr?.mergeable ?? existing?.mergeable;
  const mergeableState = pr?.mergeable_state ?? pr?.mergeableState ?? existing?.mergeableState;
  // mergeConflicts is true when mergeableState is 'dirty' (actual merge conflicts)
  // Note: mergeable === false is too broad as it includes other states like blocked/behind
  // When we have a known mergeableState, derive directly from it; only fall back to existing when undefined
  const mergeConflicts = mergeableState !== undefined ? mergeableState === 'dirty' : (existing?.mergeConflicts ?? false);

  // Extract comment counts
  const reviewComments = pr?.review_comments ?? pr?.reviewComments ?? existing?.reviewComments;
  const comments = pr?.comments ?? existing?.comments;

  // Extract review decision (from GraphQL responses, may not always be present)
  const reviewDecision = pr?.review_decision ?? pr?.reviewDecision ?? existing?.reviewDecision;

  // Extract additional fields
  const additions = pr?.additions ?? existing?.additions;
  const deletions = pr?.deletions ?? existing?.deletions;
  const changedFiles = pr?.changed_files ?? pr?.changedFiles ?? existing?.changedFiles;
  const baseRef = pr?.base_ref ?? pr?.baseRef ?? pr?.base?.ref ?? existing?.baseRef;
  const headRef = pr?.head_ref ?? pr?.headRef ?? pr?.head?.ref ?? existing?.headRef;

  // Extract headSha for CI status fetching
  const headSha = pr?.head_sha ?? pr?.headSha ?? pr?.head?.sha ?? existing?.headSha;

  // Preserve existing ciStatus if not provided in pr
  const ciStatus = pr?.ciStatus ?? existing?.ciStatus;

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
    // Mergeability fields
    mergeable,
    mergeableState,
    mergeConflicts,
    // Comment counts
    reviewComments,
    comments,
    // Review decision
    reviewDecision,
    // Additional fields
    additions,
    deletions,
    changedFiles,
    baseRef,
    headRef,
    // CI and git ref fields
    headSha,
    ciStatus,
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
 * Discover PRs for the workspace.
 *
 * Strategy:
 * 1. If workspace has a stored prNumber, fetch that specific PR
 * 2. Fetch all open PRs and find ones whose source branch matches
 *    the workspace's branch or baseRef (the branch the workspace targets)
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
    logger.debug('[PRStatusService] Discovering PRs for workspace', {
      workspaceId,
      branch: workspace.branch,
      baseRef: workspace.baseRef,
      prNumber: workspace.prNumber,
    });

    // Step 1: If workspace has a stored PR number, fetch it directly
    if (workspace.prNumber) {
      const response = (await invoke('git-tracking:get-pull-request', {
        owner: workspace.repositoryOwner,
        repo: workspace.repositoryName,
        number: workspace.prNumber,
        force: options.force,
      })) as { success?: boolean; data?: any; error?: string };

      if (response.success && response.data) {
        const status = normalizePullRequestStatus(response.data);
        const pr = normalizePullRequestInfo(response.data, null, status);
        logger.debug('[PRStatusService] Found PR by stored number', {
          workspaceId,
          prNumber: workspace.prNumber,
        });
        return { success: true, prs: [pr] };
      }
    }

    // Step 2: Fetch all open PRs and match by source branch
    // The workspace's baseRef is the branch it was created from (e.g., "pr-16d-remote-launch").
    // We look for open PRs whose source/head branch matches baseRef or workspace.branch.
    const openResponse = (await invoke('git-tracking:get-pull-requests', {
      owner: workspace.repositoryOwner,
      repo: workspace.repositoryName,
      options: { state: 'open', per_page: 100 },
      force: options.force,
    })) as { success?: boolean; data?: any[]; error?: string };

    if (!openResponse.success) {
      logger.warn('[PRStatusService] Failed to fetch open PRs', {
        error: openResponse.error,
      });
      return { success: true, prs: [] };
    }

    const allPRs = openResponse.data || [];

    logger.debug('[PRStatusService] Open PRs fetched', {
      workspaceId,
      count: allPRs.length,
    });

    // Match PRs whose source branch equals workspace.baseRef or workspace.branch
    const branchesToMatch = new Set<string>();
    branchesToMatch.add(workspace.branch);
    if (workspace.baseRef) {
      branchesToMatch.add(workspace.baseRef);
    }
    // Don't match trunk branches — would match ALL PRs
    branchesToMatch.delete('main');
    branchesToMatch.delete('master');
    branchesToMatch.delete('develop');

    const matchingPRs = allPRs.filter((pr: any) => {
      const src = pr.sourceBranch || '';
      return branchesToMatch.has(src);
    });

    logger.debug('[PRStatusService] PR matching result', {
      workspaceId,
      matchCount: matchingPRs.length,
    });

    if (matchingPRs.length > 0) {
      const normalizedPRs: PullRequestInfo[] = matchingPRs.map((pr: any) => {
        const status = normalizePullRequestStatus(pr);
        return normalizePullRequestInfo(pr, null, status);
      });
      return { success: true, prs: normalizedPRs };
    }

    return { success: true, prs: [] };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    logger.error('[PRStatusService] Failed to discover PRs', err as Error);
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

  logger.info('[PRStatusService] refreshPRStatus called', { workspaceId, force });

  // Check if we should skip due to rate limiting
  if (!force) {
    const lastRefresh = lastRefreshTime.get(workspaceId);
    if (lastRefresh && Date.now() - lastRefresh < MIN_REFRESH_INTERVAL_MS) {
      logger.info('[PRStatusService] Skipping - rate limited', { workspaceId });
      return {
        success: true,
        skipped: true,
        skipReason: 'Rate limited - refreshed recently',
      };
    }
  }

  const workspace = workspaceStore.findById(workspaceId);
  if (!workspace) {
    logger.info('[PRStatusService] Skipping - workspace not found', { workspaceId });
    return { success: false, error: 'Workspace not found' };
  }

  if (!workspace.repositoryOwner || !workspace.repositoryName) {
    logger.info('[PRStatusService] Skipping - missing repo info', {
      workspaceId,
      owner: workspace.repositoryOwner,
      repo: workspace.repositoryName,
    });
    return { success: false, error: 'Missing repository info' };
  }

  try {
    logger.debug('[PRStatusService] Refreshing PR status', {
      workspaceId,
      hasActivePR: !!workspace.activePullRequest,
      existingPRCount: workspace.pullRequests?.length ?? 0,
    });

    // Step 1: Discover PRs for the workspace first (to know which PRs are relevant)
    const discoveryResult = await discoverPRsForBranch(workspaceId, workspace, { force });
    if (!discoveryResult.success) {
      return { success: false, error: discoveryResult.error };
    }

    const discoveredPRs = discoveryResult.prs || [];

    // Build set of relevant PR numbers.
    // Always keep the active PR (it may have been user-created or correctly linked).
    // Also keep discovered PRs and explicit prNumber.
    // Drop non-active PRs that aren't in discovery (stale from bad auto-discovery).
    const relevantPRNumbers = new Set<number>();
    for (const pr of discoveredPRs) {
      relevantPRNumbers.add(pr.number);
    }
    if (workspace.prNumber) {
      relevantPRNumbers.add(workspace.prNumber);
    }
    if (workspace.activePullRequest) {
      relevantPRNumbers.add(workspace.activePullRequest.number);
    }

    // Step 3: Refresh only RELEVANT existing PRs (skip stale ones from bad discovery)
    const existingPRs = workspace.pullRequests || [];
    const refreshedExistingPRs: PullRequestInfo[] = [];
    for (const existingPR of existingPRs) {
      // Skip PRs that aren't relevant to this workspace
      if (!relevantPRNumbers.has(existingPR.number)) {
        logger.debug('[PRStatusService] Dropping stale PR from workspace', {
          workspaceId,
          prNumber: existingPR.number,
        });
        continue;
      }

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
          refreshedExistingPRs.push(existingPR);
        }
      } catch {
        refreshedExistingPRs.push(existingPR);
      }
    }

    // Step 4: Merge refreshed existing PRs with discovered PRs
    const mergedPRs = mergePullRequestArrays(refreshedExistingPRs, discoveredPRs);

    // Step 5: Determine the active PR (most recent open PR, or null)
    let newActivePR = findMostRecentOpenPR(mergedPRs);

    // Step 5.5: Fetch CI status and review status for the active PR (if open)
    if (newActivePR && (newActivePR.status === PullRequestStatus.Open || newActivePR.status === PullRequestStatus.Draft)) {
      try {
        // Get the headSha from the active PR (preserved during normalization)
        const headSha = newActivePR.headSha;

        // Fetch CI status and reviews in parallel
        const [ciStatusResult, reviewsResult] = await Promise.all([
          // Only fetch CI status if we have a headSha
          headSha
            ? invoke('git-tracking:get-check-runs', {
                owner: workspace.repositoryOwner,
                repo: workspace.repositoryName,
                commitSha: headSha,
              }) as Promise<{ success?: boolean; data?: { total: number; passed: number; failed: number; pending: number }; error?: string }>
            : Promise.resolve({ success: true, data: undefined }),
          // Fetch reviews for the active PR
          invoke('git-tracking:get-pr-reviews', {
            owner: workspace.repositoryOwner,
            repo: workspace.repositoryName,
            number: newActivePR.number,
          }) as Promise<{ success?: boolean; data?: { reviewDecision: string | null; approvalCount: number; changesRequestedCount: number; approvedBy: string[] }; error?: string }>,
        ]);

        // Enrich the active PR with CI status and review data
        if (ciStatusResult.success && ciStatusResult.data) {
          newActivePR = {
            ...newActivePR,
            ciStatus: ciStatusResult.data,
          };
          logger.debug('[PRStatusService] Added CI status to active PR', {
            workspaceId,
            prNumber: newActivePR.number,
            ciStatus: ciStatusResult.data,
          });
        }

        if (reviewsResult.success && reviewsResult.data) {
          // Use fresh data directly (even if null, meaning no actionable reviews)
          // Don't fall back to old value when we have a successful fresh result
          newActivePR = {
            ...newActivePR,
            reviewDecision: reviewsResult.data.reviewDecision ?? null,
            approvedBy: reviewsResult.data.approvedBy,
            approvalCount: reviewsResult.data.approvalCount,
          };
          logger.debug('[PRStatusService] Added review status to active PR', {
            workspaceId,
            prNumber: newActivePR.number,
            reviewDecision: reviewsResult.data.reviewDecision,
            approvedBy: reviewsResult.data.approvedBy,
            approvalCount: reviewsResult.data.approvalCount,
          });
        }

        // Also update this PR in the mergedPRs array
        const prIndex = mergedPRs.findIndex(pr => pr.number === newActivePR!.number);
        if (prIndex !== -1) {
          mergedPRs[prIndex] = newActivePR;
        }
      } catch (err) {
        // Log but don't fail the refresh if CI/review fetch fails
        logger.warn('[PRStatusService] Failed to fetch CI/review status', {
          workspaceId,
          prNumber: newActivePR.number,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

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
