/**
 * PR Status Saga
 *
 * Manages PR status refresh, polling, and window focus listeners.
 * Replaces the imperative pr-status.service.ts with saga-based side effects.
 */

import {
  call,
  put,
  fork,
  delay,
  takeLatest,
  take,
  cancelled,
} from "typed-redux-saga";
import type { SagaGenerator } from "typed-redux-saga";
import {
  eventChannel,
  type EventChannel,
  END,
} from "redux-saga";
import { invoke } from "$lib/electron-bridge";
import { logger } from "$lib/utils/client-logger";
import {
  selectActiveWorkspaceId,
  selectWorkspaceById,
  selectActiveWorkspace,
} from "$store/renderer/slices/workspace/workspace-selectors";
import { updateWorkspaceEntity } from "$store/renderer/slices/workspace/workspace-slice";
import {
  PullRequestStatus,
  type PullRequestInfo,
  type Workspace,
} from "$shared/types";
import {
  matchesBaseRef,
  getBaseRefMatchCandidates,
} from "$shared/services/baseref-matching";
import {
  refreshPRStatusRequested,
  prStatusRefreshStarted,
  prStatusRefreshCompleted,
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

    // Step 2a: Fetch open PRs filtered by head branch (server-side filtering)
    const openResponse: any = yield* call(invoke, "git-tracking:get-pull-requests", {
      owner: workspace.repositoryOwner,
      repo: workspace.repositoryName,
      options: {
        state: "open",
        head: `${workspace.repositoryOwner}:${workspace.branch}`,
        per_page: 10,
      },
      force,
    });

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


    let matchingPRs = allPRs.filter((pr: any) => {
      const src = pr.sourceBranch || "";
      return branchesToMatch.has(src);
    });

    // Step 2b: Broad fetch fallback — if head-filtered returned empty,
    // fetch all open PRs and client-side filter by branch (original working approach)
    if (matchingPRs.length === 0 && workspace.branch) {
      try {
        const broadResponse: any = yield* call(invoke, "git-tracking:get-pull-requests", {
          owner: workspace.repositoryOwner,
          repo: workspace.repositoryName,
          options: {
            state: "open",
            per_page: 30,
          },
          force,
        });

        if (broadResponse.success && broadResponse.data) {
          matchingPRs = (broadResponse.data as any[]).filter((pr: any) => {
            const src = pr.sourceBranch || "";
            return src === workspace.branch;
          });
        }
      } catch (broadErr) {
        logger.warn("[PRStatusSaga] Broad PR fetch fallback failed", {
          workspaceId,
          error: broadErr instanceof Error ? broadErr.message : "Unknown error",
        });
      }
    }

    // Step 3: Search API fallback if Strategy 2a and 2b found nothing
    if (matchingPRs.length === 0 && workspace.branch) {
      try {
        const searchResponse: any = yield* call(invoke, "git-tracking:search-pull-requests", {
          owner: workspace.repositoryOwner,
          repo: workspace.repositoryName,
          options: { filter: "all", state: "open" },
          force,
        });

        if (searchResponse.success && searchResponse.data) {
          matchingPRs = (searchResponse.data as any[]).filter((pr: any) => {
            const src = pr.sourceBranch || "";
            return src === workspace.branch;
          });
        }
      } catch (searchErr) {
        logger.warn("[PRStatusSaga] Search API fallback failed", {
          workspaceId,
          error: searchErr instanceof Error ? searchErr.message : "Unknown error",
        });
      }
    }

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
    const lastRefresh: number | null = yield* selectPRStatusLastRefreshTime.effect(wsId);
    if (lastRefresh && Date.now() - lastRefresh < MIN_REFRESH_INTERVAL_MS) {
      logger.info("[PRStatusSaga] Skipping - rate limited", { wsId });
      yield* put(prStatusRefreshCompleted(wsId, true));
      return;
    }
  }

  const workspace: Workspace | undefined = yield* selectWorkspaceById.effect(wsId);
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
    const sanitizedActivePR = newActivePR === null ? null : sanitizeForIpc(newActivePR);

    // Step 5: Update workspace via IPC
    yield* call(invoke, "workspace:update", {
      id: wsId,
      prStatus,
      prNumber,
      prUrl,
      activePullRequest: sanitizedActivePR,
      pullRequests: sanitizeForIpc(mergedPRs),
    });

    // Step 6: Update local store
    yield* put(updateWorkspaceEntity(wsId, {
      prStatus: prStatus ?? undefined,
      prNumber: prNumber ?? undefined,
      prUrl: prUrl ?? undefined,
      activePullRequest: sanitizedActivePR,
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

/** Manages polling for the active workspace. Cancellable via fork/cancel. */
export function* pollActiveWorkspacePRStatus(): SagaGenerator<void> {
  try {
    while (true) {
      yield* delay(POLLING_INTERVAL_MS);

      const activeWorkspace: Workspace | undefined = yield* selectActiveWorkspace.effect();
      if (!activeWorkspace?.id || activeWorkspace.activePullRequest == null) continue;

      yield* put(refreshPRStatusRequested(activeWorkspace.id, false, false));
    }
  } finally {
    if (yield* cancelled()) {
      logger.debug("[PRStatusSaga] Active workspace polling cancelled");
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

      const currentWsId: string | null = yield* selectActiveWorkspaceId.effect();
      if (!currentWsId) continue;

      const workspace: Workspace | undefined = yield* selectWorkspaceById.effect(currentWsId);
      if (workspace) {
        yield* put(refreshPRStatusRequested(currentWsId, true, false));
      }
    }
  } finally {
    channel.close();
  }
}

// ── Root Saga ──

export function* prStatusSaga(): SagaGenerator<void> {
  yield* fork(watchWindowFocus);
  yield* fork(pollActiveWorkspacePRStatus);
  yield* takeLatest(refreshPRStatusRequested, handleRefreshPRStatus);
}

