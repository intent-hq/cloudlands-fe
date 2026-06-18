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

/** True for PRs the workspace still considers live (open or draft). */
function isOpenOrDraftStatus(status: PullRequestStatus | undefined): boolean {
  return status === PullRequestStatus.Open || status === PullRequestStatus.Draft;
}

/**
 * Match a list of PRs against the workspace branch by head ref.
 *
 * The compact PR listing payload omits head/base refs, so `sourceBranch` is
 * often empty for listed PRs. Unlike the server-side head-filtered fetch (Step
 * 2a), the broad-fetch and search fallbacks cannot trust an empty ref, so for
 * each such PR the real head ref is resolved via a per-PR details lookup
 * (`git-tracking:get-pull-request`) before matching. This prevents PRs from
 * being dropped purely due to the missing ref while still excluding unrelated
 * PRs whose head clearly does not match.
 */
function* resolveAndMatchPRsByHeadRef(
  prs: any[],
  workspace: Workspace,
  force: boolean,
): SagaGenerator<any[]> {
  const matched: any[] = [];
  for (const pr of prs) {
    const src = pr.sourceBranch || "";
    if (src) {
      if (src === workspace.branch) matched.push(pr);
      continue;
    }

    try {
      const detail: any = yield* call(invoke, "git-tracking:get-pull-request", {
        owner: workspace.repositoryOwner,
        repo: workspace.repositoryName,
        number: pr.number,
        force,
      });
      const resolvedSrc = (detail?.success && detail.data?.sourceBranch) || "";
      if (resolvedSrc && resolvedSrc === workspace.branch) {
        matched.push(detail.data);
      }
    } catch (resolveErr) {
      logger.warn("[PRStatusSaga] Failed to resolve PR head ref", {
        workspaceId: workspace.id,
        prNumber: pr.number,
        error: resolveErr instanceof Error ? resolveErr.message : "Unknown error",
      });
    }
  }
  return matched;
}

export function* discoverPRsForBranch(
  workspaceId: string,
  workspace: Workspace,
  force: boolean,
): SagaGenerator<{ success: boolean; prs?: PullRequestInfo[]; error?: string }> {
  if (!workspace.branch) {
    return { success: true, prs: [] };
  }

  try {
    // Step 1: Re-fetch every currently-known open/draft PR by number.
    //
    // Fetching by number is branch-independent and robust, unlike the branch-list
    // queries below (2a/2b/3), which can legitimately return empty (fork PRs that
    // miss the head filter, repos with many open PRs, transient list failures).
    // Re-fetching known PRs here makes discovery authoritative for them, so a PR
    // that was already visible isn't silently dropped on a forced refresh just
    // because the list queries came back empty.
    const knownPRNumbers: number[] = [];
    if (workspace.prNumber) {
      knownPRNumbers.push(workspace.prNumber);
    }
    if (
      workspace.activePullRequest &&
      isOpenOrDraftStatus(workspace.activePullRequest.status)
    ) {
      knownPRNumbers.push(workspace.activePullRequest.number);
    }
    for (const existing of workspace.pullRequests || []) {
      if (isOpenOrDraftStatus(existing.status)) {
        knownPRNumbers.push(existing.number);
      }
    }

    const knownPRs: PullRequestInfo[] = [];
    const seenKnownNumbers = new Set<number>();
    for (const number of knownPRNumbers) {
      if (seenKnownNumbers.has(number)) continue;
      seenKnownNumbers.add(number);

      const response: any = yield* call(invoke, "git-tracking:get-pull-request", {
        owner: workspace.repositoryOwner,
        repo: workspace.repositoryName,
        number,
        force,
      });

      if (!response.success || !response.data) continue;

      const status = normalizePullRequestStatus(response.data);
      const pr = normalizePullRequestInfo(response.data, null, status);

      // Preserve the stored-prNumber branch-validation: the explicitly stored
      // PR number is dropped when its source branch clearly belongs to another
      // branch. baseRef may be plain ("main") or remote-qualified ("origin/main");
      // only an allowlist of remote prefixes is stripped so slashed local
      // branches aren't over-stripped. PRs the workspace already tracked in
      // pullRequests/activePullRequest are retained with their real status
      // regardless of head ref — losing the ref must not erase a known PR.
      if (number === workspace.prNumber) {
        const prSourceBranch = pr.headRef || "";
        const matchesBranch = !prSourceBranch || !workspace.branch || prSourceBranch === workspace.branch;
        const baseRefMatched = matchesBaseRef(prSourceBranch, workspace.baseRef);
        if (!matchesBranch && !baseRefMatched) {
          logger.info("[PRStatusSaga] Stored PR source branch mismatch, skipping", {
            workspaceId, prNumber: workspace.prNumber, prSourceBranch,
          });
          continue;
        }
      }

      knownPRs.push(pr);
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
      // The server-side head filter (head=owner:branch) already guarantees the
      // returned PRs' head IS the workspace branch, so an empty sourceBranch from
      // the compact listing payload is treated as a match. A present sourceBranch
      // that clearly does not match is still excluded.
      if (!src) return true;
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
          matchingPRs = yield* call(
            resolveAndMatchPRsByHeadRef,
            broadResponse.data as any[],
            workspace,
            force,
          );
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
          matchingPRs = yield* call(
            resolveAndMatchPRsByHeadRef,
            searchResponse.data as any[],
            workspace,
            force,
          );
        }
      } catch (searchErr) {
        logger.warn("[PRStatusSaga] Search API fallback failed", {
          workspaceId,
          error: searchErr instanceof Error ? searchErr.message : "Unknown error",
        });
      }
    }

    // Newly discovered PRs from the branch-list queries (2a/2b/3).
    const discoveredNewPRs: PullRequestInfo[] = matchingPRs.map((pr: any) => {
      const status = normalizePullRequestStatus(pr);
      return normalizePullRequestInfo(pr, null, status);
    });

    // Merge re-fetched known PRs with newly discovered ones. mergePullRequestArrays
    // de-dupes by number, so a PR found both ways isn't double-counted; the known
    // (by-number, details:true) entry takes precedence over the compact listing.
    return {
      success: true,
      prs: mergePullRequestArrays(discoveredNewPRs, knownPRs),
    };
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

