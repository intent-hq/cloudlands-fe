/**
 * PR Status Saga
 *
 * Manages PR status refresh, polling, and window focus listeners.
 * Replaces the imperative pr-status.service.ts with saga-based side effects.
 */

import { call, put, fork, delay, takeLatest, take, cancel, cancelled, select } from "typed-redux-saga";
import type { SagaGenerator } from "typed-redux-saga";
import type { Task } from "redux-saga";
import { eventChannel, type EventChannel, END } from "redux-saga";
import { invoke } from "$lib/electron-bridge";
import { logger } from "$lib/utils/client-logger";
import {
  selectActiveWorkspaceId,
  selectWorkspaceById,
  selectActiveWorkspace,
} from "$lib/store/slices/workspace/workspace-selectors";
import { takeLatestFromSelector } from "$lib/store/utils/selector-channel-effects";
import { updateWorkspaceEntity } from "$lib/store/slices/workspace/workspace-slice";
import { PullRequestStatus, type PullRequestInfo, type Workspace } from "$shared/types";
import {
  matchesBaseRef,
  getBaseRefMatchCandidates,
} from "$shared/services/baseref-matching";
import {
  refreshPRStatusRequested,
  prStatusRefreshStarted,
  prStatusRefreshCompleted,
  cleanupPRStatusWorkspace,
  startPRPolling,
  stopPRPolling,
} from "../pr-status-slice";
import { selectPRStatusLastRefreshTime } from "../pr-status-selectors";
import {
  sanitizeForIpc,
  normalizePullRequestStatus,
  normalizePullRequestInfo,
  mergePullRequestArrays,
  findMostRecentOpenPR,
} from "../utils/pr-status-utils";

// Polling interval in milliseconds (30 seconds)
const POLLING_INTERVAL_MS = 30_000;

// Minimum time between refreshes to avoid rate limiting (5 seconds)
const MIN_REFRESH_INTERVAL_MS = 5_000;

// ── Discover PRs ──

export function* discoverPRsForBranch(
  workspaceId: string,
  workspace: Workspace,
  force: boolean,
): SagaGenerator<{ success: boolean; prs?: PullRequestInfo[]; error?: string }> {
  if (!workspace.branch) {
    return { success: true, prs: [] };
  }

  try {
    // Step 1: If workspace has a stored PR number, fetch and validate
    if (workspace.prNumber) {
      const response: any = yield* call(invoke, "git-tracking:get-pull-request", {
        owner: workspace.repositoryOwner,
        repo: workspace.repositoryName,
        number: workspace.prNumber,
        force,
      });

      if (response.success && response.data) {
        const status = normalizePullRequestStatus(response.data);
        const pr = normalizePullRequestInfo(response.data, null, status);
        const prSourceBranch = pr.headRef || "";

        const matchesBranch = !prSourceBranch || !workspace.branch || prSourceBranch === workspace.branch;
        // Accept the stored PR if its sourceBranch matches the workspace's
        // baseRef. baseRef may be a plain branch ("main") or remote-qualified
        // ("origin/main"); only a conservative allowlist of remote prefixes
        // is stripped so slashed local branches aren't over-stripped.
        const baseRefMatched = matchesBaseRef(prSourceBranch, workspace.baseRef);
        if (!matchesBranch && !baseRefMatched) {
          logger.info("[PRStatusSaga] Stored PR source branch mismatch, skipping", {
            workspaceId, prNumber: workspace.prNumber, prSourceBranch,
          });
        } else {
          return { success: true, prs: [pr] };
        }
      }
    }

    // Step 2: Fetch all open PRs and match by source branch
    const openResponse: any = yield* call(invoke, "git-tracking:get-pull-requests", {
      owner: workspace.repositoryOwner,
      repo: workspace.repositoryName,
      options: { state: "open", per_page: 100 },
      force,
    });

    if (!openResponse.success) {
      return { success: true, prs: [] };
    }

    const allPRs = openResponse.data || [];
    const branchesToMatch = new Set<string>();
    branchesToMatch.add(workspace.branch);
    // Also match baseRef for PR review workspaces where workspace.branch is
    // a local review branch, not the PR's source branch. Only an allowlisted
    // remote prefix is stripped; slashed local branches pass through as-is.
    for (const candidate of getBaseRefMatchCandidates(workspace.baseRef)) {
      branchesToMatch.add(candidate);
    }
    branchesToMatch.delete("main");
    branchesToMatch.delete("master");
    branchesToMatch.delete("develop");

    const matchingPRs = allPRs.filter((pr: any) => {
      const src = pr.sourceBranch || "";
      return branchesToMatch.has(src);
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
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error("[PRStatusSaga] Failed to discover PRs", err as Error);
    return { success: false, error };
  }
}

// ── Refresh PR Status ──

function* handleRefreshPRStatus(action: ReturnType<typeof refreshPRStatusRequested>) {
  const [wsId, force, isManual] = action.payload;

  // Rate limiting check
  if (!force) {
    const lastRefresh: number | null = yield* select(selectPRStatusLastRefreshTime.select, wsId);
    if (lastRefresh && Date.now() - lastRefresh < MIN_REFRESH_INTERVAL_MS) {
      logger.info("[PRStatusSaga] Skipping - rate limited", { wsId });
      yield* put(prStatusRefreshCompleted(wsId, true));
      return;
    }
  }

  const workspace: Workspace | undefined = yield* select(selectWorkspaceById.select, wsId);
  if (!workspace) {
    yield* put(prStatusRefreshCompleted(wsId, false, "Workspace not found"));
    return;
  }

  if (!workspace.repositoryOwner || !workspace.repositoryName) {
    yield* put(prStatusRefreshCompleted(wsId, false, "Missing repository info"));
    return;
  }

  yield* put(prStatusRefreshStarted(wsId));

  try {
    // Step 1: Discover PRs
    const discoveryResult = yield* call(discoverPRsForBranch, wsId, workspace, force);
    if (!discoveryResult.success) {
      yield* put(prStatusRefreshCompleted(wsId, false, discoveryResult.error));
      if (isManual) {
        yield* call(showToastError, discoveryResult.error || "Failed to refresh PR status");
      }
      return;
    }

    const discoveredPRs = discoveryResult.prs || [];
    const relevantPRNumbers = new Set<number>(discoveredPRs.map((pr) => pr.number));

    // Step 2: Refresh relevant existing PRs
    const existingPRs = workspace.pullRequests || [];
    const refreshedExistingPRs: PullRequestInfo[] = [];
    for (const existingPR of existingPRs) {
      const isMerged = existingPR.status === PullRequestStatus.Merged;
      if (!relevantPRNumbers.has(existingPR.number) && !isMerged) continue;

      try {
        const response: any = yield* call(invoke, "git-tracking:get-pull-request", {
          owner: workspace.repositoryOwner,
          repo: workspace.repositoryName,
          number: existingPR.number,
          force,
        });

        if (response.success && response.data) {
          const normalizedStatus = normalizePullRequestStatus(response.data);
          refreshedExistingPRs.push(normalizePullRequestInfo(response.data, existingPR, normalizedStatus));
        } else {
          refreshedExistingPRs.push(existingPR);
        }
      } catch {
        refreshedExistingPRs.push(existingPR);
      }
    }

    // Step 3: Merge and find active PR
    const mergedPRs = mergePullRequestArrays(refreshedExistingPRs, discoveredPRs);
    let newActivePR = findMostRecentOpenPR(mergedPRs);

    // Step 4: Fetch CI status and reviews for active PR
    if (newActivePR && (newActivePR.status === PullRequestStatus.Open || newActivePR.status === PullRequestStatus.Draft)) {
      newActivePR = yield* call(enrichActivePR, workspace, newActivePR);
      const prIndex = mergedPRs.findIndex((pr) => pr.number === newActivePR!.number);
      if (prIndex !== -1) mergedPRs[prIndex] = newActivePR;
    }

    // Compute legacy fields
    const fallbackMergedPR = !newActivePR
      ? mergedPRs.find((pr) => pr.status === PullRequestStatus.Merged) ?? null
      : null;
    const legacyPR = newActivePR ?? fallbackMergedPR;
    const prStatus = legacyPR?.status ?? null;
    const prNumber = legacyPR?.number ?? null;
    const prUrl = legacyPR?.url ?? null;

    // Step 5: Update workspace via IPC
    yield* call(invoke, "workspace:update", {
      id: wsId,
      prStatus,
      prNumber,
      prUrl,
      activePullRequest: sanitizeForIpc(newActivePR),
      pullRequests: sanitizeForIpc(mergedPRs),
    });

    // Step 6: Update local store
    yield* put(updateWorkspaceEntity(wsId, {
      prStatus: prStatus ?? undefined,
      prNumber: prNumber ?? undefined,
      prUrl: prUrl ?? undefined,
      activePullRequest: sanitizeForIpc(newActivePR) ?? undefined,
      pullRequests: sanitizeForIpc(mergedPRs),
    }));

    yield* put(prStatusRefreshCompleted(wsId, true));

    logger.info("[PRStatusSaga] PR refresh complete", {
      wsId,
      totalPRs: mergedPRs.length,
      activePRNumber: newActivePR?.number ?? null,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    logger.error("[PRStatusSaga] Failed to refresh PR status", err as Error);
    yield* put(prStatusRefreshCompleted(wsId, false, error));
    if (isManual) {
      yield* call(showToastError, error);
    }
  }
}

// ── Enrich Active PR with CI & Reviews ──

function* enrichActivePR(
  workspace: Workspace,
  activePR: PullRequestInfo,
): SagaGenerator<PullRequestInfo> {
  let enriched = activePR;
  try {
    const headSha = activePR.headSha;

    // Fetch CI status and reviews in parallel via call
    const [ciStatusResult, reviewsResult]: [any, any] = yield* call(
      (owner: string, repo: string, sha: string | undefined, prNumber: number) =>
        Promise.all([
          sha
            ? invoke("git-tracking:get-check-runs", { owner, repo, commitSha: sha })
            : Promise.resolve({ success: true, data: undefined }),
          invoke("git-tracking:get-pr-reviews", { owner, repo, number: prNumber }),
        ]),
      workspace.repositoryOwner!,
      workspace.repositoryName!,
      headSha,
      activePR.number,
    );

    if (ciStatusResult.success && ciStatusResult.data) {
      enriched = { ...enriched, ciStatus: ciStatusResult.data };
    }

    if (reviewsResult.success && reviewsResult.data) {
      enriched = {
        ...enriched,
        reviewDecision: reviewsResult.data.reviewDecision ?? null,
        approvedBy: reviewsResult.data.approvedBy,
        approvalCount: reviewsResult.data.approvalCount,
      };
    }
  } catch (err) {
    logger.warn("[PRStatusSaga] Failed to fetch CI/review status", {
      prNumber: activePR.number,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
  return enriched;
}

// ── Toast Helper ──

async function showToastError(message: string): Promise<void> {
  try {
    const { toast } = await import("svelte-sonner");
    toast.error(message);
  } catch {
    // Toast not available
  }
}

// ── Polling Saga ──

/** Manages polling for a single workspace. Cancellable via fork/cancel. */
function* pollWorkspacePRStatus(wsId: string): SagaGenerator<void> {
  try {
    while (true) {
      yield* delay(POLLING_INTERVAL_MS);

      // Only refresh if this workspace is still the active one
      const currentWsId: string | null = yield* select(selectActiveWorkspaceId.select);
      if (currentWsId !== wsId) continue;

      yield* put(refreshPRStatusRequested(wsId, false, false));
    }
  } finally {
    if (yield* cancelled()) {
      logger.debug("[PRStatusSaga] Polling cancelled", { wsId });
    }
  }
}

/** Watches for start/stop polling actions and manages polling tasks per workspace. */
function* watchPolling(): SagaGenerator<void> {
  const pollingTasks: Record<string, Task> = {};

  while (true) {
    const action: ReturnType<typeof startPRPolling> | ReturnType<typeof stopPRPolling> | ReturnType<typeof cleanupPRStatusWorkspace> =
      yield* take([startPRPolling, stopPRPolling, cleanupPRStatusWorkspace]);

    const wsId = Array.isArray(action.payload) ? action.payload[0] : action.payload;

    if (action.type === startPRPolling.type) {
      // Cancel existing polling for this workspace
      if (pollingTasks[wsId]) {
        yield* cancel(pollingTasks[wsId]);
      }
      pollingTasks[wsId] = yield* fork(pollWorkspacePRStatus, wsId);
    } else {
      // Stop polling (both stopPRPolling and cleanupPRStatusWorkspace)
      if (pollingTasks[wsId]) {
        yield* cancel(pollingTasks[wsId]);
        delete pollingTasks[wsId];
      }
    }
  }
}

// ── Window Focus Saga ──

function createWindowFocusChannel(): EventChannel<"focus"> {
  return eventChannel<"focus">((emitter) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      emitter(END as any);
      return () => {};
    }

    const handleFocus = () => emitter("focus");
    const handleVisibility = () => {
      if (document.visibilityState === "visible") emitter("focus");
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  });
}

function* watchWindowFocus(): SagaGenerator<void> {
  const channel = createWindowFocusChannel();
  try {
    while (true) {
      yield* take(channel);

      const currentWsId: string | null = yield* select(selectActiveWorkspaceId.select);
      if (!currentWsId) continue;

      const workspace: Workspace | undefined = yield* select(selectWorkspaceById.select, currentWsId);
      if (workspace?.activePullRequest) {
        yield* put(refreshPRStatusRequested(currentWsId, true, false));
      }
    }
  } finally {
    channel.close();
  }
}

// ── Active PR Polling Watcher ──

/**
 * Watches the active workspace's activePullRequest and starts/stops polling
 * accordingly. Replaces the component-side $effect that dispatched
 * startPRPolling / stopPRPolling.
 */
function* watchActiveWorkspacePRPolling(): SagaGenerator<void> {
  yield* takeLatestFromSelector(
    selectActiveWorkspace,
    function* ({ payload: workspace }) {
      const wsId = workspace?.id;
      if (!wsId) return;

      if (workspace.activePullRequest != null) {
        yield* put(startPRPolling(wsId));
      } else {
        yield* put(stopPRPolling(wsId));
      }
    }
  );
}

// ── Root Saga ──

export function* prStatusSaga(): SagaGenerator<void> {
  yield* fork(watchPolling);
  yield* fork(watchWindowFocus);
  yield* fork(watchActiveWorkspacePRPolling);
  yield* takeLatest(refreshPRStatusRequested, handleRefreshPRStatus);
}

