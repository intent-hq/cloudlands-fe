import { Logger } from '../../../../shared/logger';
import { getBackendClient } from '../../../backend/main/backend.ipc';
import { githubService } from '../../../git-tracking/main/github.service';
import {
  prCommentService,
  type ReviewThread,
} from '../../../git-tracking/main/pr-comment.service';
import type { PullRequest } from '../../../git-tracking/types';

const logger = new Logger('WsPrApi');

/**
 * Context required for PR comment operations
 */
export interface PRContext {
  owner: string;
  repo: string;
  prNumber: number;
}

const NO_ACTIVE_PR_ERROR = 'No active PR';
const SAFETY_PADDING_SECONDS = 10;

type MergeMethod = 'merge' | 'squash' | 'rebase';
type WatchMode = 'any' | 'checks' | 'state' | 'commits';
type ReviewCommentStatus = 'unresolved' | 'resolved' | 'all';
type ResolveThreadAction = 'resolve' | 'unresolve';

export interface MergePrOptions {
  mergeMethod?: MergeMethod;
  commitTitle?: string;
  commitMessage?: string;
}

export interface WaitForPrChangesOptions {
  timeoutSeconds?: number;
  pollIntervalSeconds?: number;
  watch?: WatchMode;
}

export interface ListPrReviewCommentsOptions {
  path?: string;
  status?: ReviewCommentStatus;
}

export interface ListPrCommentsOptions {
  count?: number;
}

interface CheckRunStatus {
  name: string;
  status: string;
  conclusion: string | null;
}

interface PRSnapshot {
  headSha: string | undefined;
  state: string;
  mergeable: boolean | undefined;
  mergeableState: string | undefined;
  updatedAt: string | undefined;
  checkRuns: CheckRunStatus[];
  checkRunsFetchFailed: boolean;
}

function requirePrContext(prContext?: PRContext): PRContext {
  if (!prContext) {
    throw new Error(NO_ACTIVE_PR_ERROR);
  }
  return prContext;
}

function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required and must be a string`);
  }
}

function assertNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`${name} is required and must be a number`);
  }
}

function validateMergeMethod(mergeMethod: unknown): MergeMethod {
  if (mergeMethod === undefined) {
    return 'merge';
  }
  if (mergeMethod === 'merge' || mergeMethod === 'squash' || mergeMethod === 'rebase') {
    return mergeMethod;
  }
  throw new Error('mergeMethod must be one of: merge, squash, rebase');
}

function validateReviewCommentStatus(status: unknown): ReviewCommentStatus {
  if (status === undefined) {
    return 'unresolved';
  }
  if (status === 'unresolved' || status === 'resolved' || status === 'all') {
    return status;
  }
  throw new Error('status must be one of: unresolved, resolved, all');
}

function validateWatchMode(watch: unknown): WatchMode {
  if (watch === undefined) {
    return 'any';
  }
  if (watch === 'any' || watch === 'checks' || watch === 'state' || watch === 'commits') {
    return watch;
  }
  throw new Error('watch must be one of: any, checks, state, commits');
}

function validateResolveThreadAction(action: unknown): ResolveThreadAction {
  if (action === undefined) {
    return 'resolve';
  }
  if (action === 'resolve' || action === 'unresolve') {
    return action;
  }
  throw new Error('action must be one of: resolve, unresolve');
}

async function getPullRequest(prContext: PRContext): Promise<PullRequest> {
  const pr = await githubService.getPullRequest(prContext.owner, prContext.repo, prContext.prNumber, { force: true });
  if (!pr) {
    throw new Error(`Could not fetch PR #${prContext.prNumber} for ${prContext.owner}/${prContext.repo}. The PR may not exist or GitHub API may be unavailable.`);
  }
  return pr;
}

function buildStatusSummary(pr: PullRequest): string {
  const isDraft = pr.state === 'draft';
  const isMerged = pr.state === 'merged';
  const isClosed = pr.state === 'closed';
  const mergeable = pr.mergeable;
  const mergeableState = pr.mergeableState ?? 'unknown';
  const hasConflicts = mergeableState === 'dirty';
  const summaryParts: string[] = [];

  if (isMerged) {
    summaryParts.push('✅ PR is merged.');
  } else if (isClosed) {
    summaryParts.push('🚫 PR is closed.');
  } else {
    if (isDraft) {
      summaryParts.push('📝 PR is a draft.');
    }

    if (hasConflicts) {
      summaryParts.push('⚠️ PR has merge conflicts that need to be resolved.');
    } else if (mergeable === true && mergeableState === 'clean') {
      summaryParts.push('✅ PR is mergeable with no conflicts.');
    } else if (mergeableState === 'unknown' || mergeable === undefined) {
      summaryParts.push('⏳ GitHub is still computing mergeability.');
    }

    if (mergeableState === 'blocked') {
      summaryParts.push('🔒 PR is blocked (e.g., required reviews or branch protection rules not met).');
    } else if (mergeableState === 'unstable') {
      summaryParts.push('⚠️ PR has failing status checks.');
    } else if (mergeableState === 'behind') {
      summaryParts.push('🔄 PR branch is behind the target branch and needs to be updated.');
    }
  }

  if (summaryParts.length === 0) {
    summaryParts.push(`PR is in state: ${pr.state}, mergeableState: ${mergeableState}.`);
  }

  return summaryParts.join(' ');
}

async function fetchCheckRuns(owner: string, repo: string, commitSha: string): Promise<CheckRunStatus[]> {
  // GAP: the daemon `github.*` namespace (PROTOCOL §5.27) has no per-commit
  // check-runs method — that surface is workspace-scoped on `pr.listCheckRuns`
  // (§5.7), which is unavailable at this explicit owner/repo call site. Until a
  // github.* check-runs method lands, report no checks (see BE hand-off note
  // d1df7466), matching githubService.getCheckRuns.
  logger.debug('Check runs unavailable via daemon github.*; returning empty', { owner, repo, commitSha });
  return [];
}

async function captureSnapshot(prContext: PRContext): Promise<PRSnapshot | null> {
  const pr = await githubService.getPullRequest(prContext.owner, prContext.repo, prContext.prNumber, { force: true });
  if (!pr) {
    return null;
  }

  let checkRuns: CheckRunStatus[] = [];
  let checkRunsFetchFailed = false;

  if (pr.headSha) {
    try {
      checkRuns = await fetchCheckRuns(prContext.owner, prContext.repo, pr.headSha);
    } catch (error) {
      logger.warn('Failed to fetch check runs', { error: (error as Error).message, ...prContext });
      checkRunsFetchFailed = true;
    }
  }

  return {
    headSha: pr.headSha,
    state: pr.state,
    mergeable: pr.mergeable,
    mergeableState: pr.mergeableState,
    updatedAt: pr.updatedAt,
    checkRuns,
    checkRunsFetchFailed,
  };
}

function detectChanges(initial: PRSnapshot, current: PRSnapshot, watchMode: WatchMode): string[] {
  const changes: string[] = [];

  if ((watchMode === 'any' || watchMode === 'commits') && initial.headSha && current.headSha && initial.headSha !== current.headSha) {
    changes.push(`New commit: ${initial.headSha.substring(0, 7)} → ${current.headSha.substring(0, 7)}`);
  }

  if (watchMode === 'any' || watchMode === 'state') {
    if (initial.state !== current.state) {
      changes.push(`State changed: ${initial.state} → ${current.state}`);
    }
    if (initial.mergeable !== current.mergeable) {
      changes.push(`Mergeable changed: ${initial.mergeable} → ${current.mergeable}`);
    }
    if (initial.mergeableState !== current.mergeableState) {
      changes.push(`Mergeable state changed: ${initial.mergeableState || 'unknown'} → ${current.mergeableState || 'unknown'}`);
    }
  }

  if ((watchMode === 'any' || watchMode === 'checks') && !initial.checkRunsFetchFailed && !current.checkRunsFetchFailed) {
    const initialChecks = new Map(initial.checkRuns.map((check) => [check.name, check]));
    const currentChecks = new Map(current.checkRuns.map((check) => [check.name, check]));

    for (const [name, check] of currentChecks) {
      const initialCheck = initialChecks.get(name);
      if (!initialCheck) {
        changes.push(`New check: ${name} (${check.conclusion || check.status})`);
        continue;
      }

      const initialStatus = initialCheck.conclusion || initialCheck.status;
      const currentStatus = check.conclusion || check.status;
      if (initialStatus !== currentStatus) {
        changes.push(`Check "${name}": ${initialStatus} → ${currentStatus}`);
      }
    }
  }

  if (watchMode === 'any' && initial.updatedAt && current.updatedAt && initial.updatedAt !== current.updatedAt && changes.length === 0) {
    changes.push(`PR updated: ${initial.updatedAt} → ${current.updatedAt}`);
  }

  return changes;
}

function getCheckIcon(check: CheckRunStatus): string {
  if (check.conclusion === 'success') return '✅';
  if (check.conclusion === 'failure') return '❌';
  if (check.conclusion === 'cancelled') return '🚫';
  if (check.conclusion === 'skipped') return '⏭️';
  if (check.status === 'in_progress') return '🔄';
  if (check.status === 'queued') return '⏳';
  return '•';
}

function formatChangeSummary(changes: string[], snapshot: PRSnapshot, elapsedSeconds: number): string {
  const lines: string[] = [];
  lines.push(`✅ PR changes detected after ${elapsedSeconds} seconds:`);
  lines.push('');
  for (const change of changes) {
    lines.push(`  • ${change}`);
  }
  lines.push('');
  lines.push('--- Current State ---');
  lines.push(`State: ${snapshot.state}`);
  lines.push(`Head SHA: ${snapshot.headSha || 'unknown'}`);
  lines.push(`Mergeable: ${snapshot.mergeable ?? 'unknown'}`);
  lines.push(`Mergeable State: ${snapshot.mergeableState || 'unknown'}`);

  if (snapshot.checkRuns.length > 0) {
    lines.push('');
    lines.push('Check Runs:');
    for (const check of snapshot.checkRuns) {
      lines.push(`  ${getCheckIcon(check)} ${check.name}: ${check.conclusion || check.status}`);
    }
  }

  return lines.join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildWsPrApi(prContext?: PRContext) {
  return {
    async merge(options: MergePrOptions = {}) {
      const activePr = requirePrContext(prContext);
      const mergeMethod = validateMergeMethod(options.mergeMethod);

      logger.info('ws.pr.merge', { ...activePr, mergeMethod });

      const pr = await getPullRequest(activePr);
      if (pr.state === 'draft') {
        throw new Error(`PR #${activePr.prNumber} is a draft and cannot be merged. GitHub blocks merging draft PRs. Mark the PR as "Ready for review" first using the GitHub UI or API.`);
      }
      if (pr.state !== 'open') {
        throw new Error(`PR #${activePr.prNumber} is ${pr.state} and cannot be merged.`);
      }
      if (pr.mergeable === false) {
        throw new Error(`PR #${activePr.prNumber} is not mergeable. This could be due to merge conflicts, failing required checks, or missing required reviews. Please resolve the issues before attempting to merge.`);
      }

      const result = await githubService.mergePullRequest(activePr.owner, activePr.repo, activePr.prNumber, {
        mergeMethod,
        commitTitle: options.commitTitle,
        commitMessage: options.commitMessage,
      });

      if (!result.merged) {
        throw new Error(`Failed to merge PR #${activePr.prNumber}: ${result.message}`);
      }

      return {
        merged: true,
        sha: result.sha,
        mergeMethod,
        message: result.message,
        prNumber: activePr.prNumber,
      };
    },

    async status() {
      const activePr = requirePrContext(prContext);
      logger.info('ws.pr.status', activePr);

      const pr = await getPullRequest(activePr);
      const mergeableState = pr.mergeableState ?? 'unknown';
      const hasConflicts = mergeableState === 'dirty';
      const isDraft = pr.state === 'draft';
      const isMerged = pr.state === 'merged';
      const isClosed = pr.state === 'closed';

      return {
        prNumber: activePr.prNumber,
        title: pr.title,
        url: pr.url,
        state: pr.state,
        mergeable: pr.mergeable ?? null,
        mergeableState,
        hasConflicts,
        isDraft,
        isMerged,
        isClosed,
        summary: buildStatusSummary(pr),
      };
    },

    async updateBranch() {
      const activePr = requirePrContext(prContext);
      logger.info('ws.pr.updateBranch', activePr);

      try {
        const pr = await githubService.getPullRequest(activePr.owner, activePr.repo, activePr.prNumber, { force: true });
        if (!pr) {
          throw new Error(`Could not find PR #${activePr.prNumber}`);
        }

        const result = await getBackendClient().request<{ message?: string; url?: string | null }>(
          'github.pulls.updateBranch',
          {
            owner: activePr.owner,
            repo: activePr.repo,
            number: activePr.prNumber,
            expectedHeadSha: pr.headSha || undefined,
          },
        );

        return {
          method: 'merge' as const,
          alreadyUpToDate: false,
          message: result?.message ?? 'PR branch updated.',
          url: result?.url ?? null,
        };
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (errorMessage.includes('already up-to-date') || errorMessage.includes('already up to date')) {
          return {
            method: 'merge' as const,
            alreadyUpToDate: true,
            message: 'PR branch is already up-to-date with the base branch.',
            url: null,
          };
        }

        if (errorMessage.includes('merge conflict') || errorMessage.includes('Merge conflict')) {
          throw new Error(`Cannot update PR branch: merge conflicts detected. The conflicts must be resolved manually.\n${errorMessage}`);
        }

        throw new Error(`Failed to update PR branch: ${errorMessage}`);
      }
    },

    async waitForChanges(options: WaitForPrChangesOptions = {}) {
      const activePr = requirePrContext(prContext);
      const timeout = Math.max(10, Math.min(600, Number.isNaN(Number(options.timeoutSeconds)) ? 300 : Number(options.timeoutSeconds)));
      const pollInterval = Math.max(10, Math.min(60, Number.isNaN(Number(options.pollIntervalSeconds)) ? 15 : Number(options.pollIntervalSeconds)));
      const watchMode = validateWatchMode(options.watch);

      logger.info('ws.pr.waitForChanges', { ...activePr, timeout, pollInterval, watchMode });

      const startTime = Date.now();
      const timeoutMs = timeout * 1000;
      const pollIntervalMs = pollInterval * 1000;
      const safetyPaddingMs = SAFETY_PADDING_SECONDS * 1000;
      const effectiveTimeoutMs = Math.min(timeoutMs, Math.max(pollIntervalMs, timeoutMs - safetyPaddingMs));

      const initialSnapshot = await captureSnapshot(activePr);
      if (!initialSnapshot) {
        throw new Error(`Could not fetch PR #${activePr.prNumber} for ${activePr.owner}/${activePr.repo}.`);
      }

      let lastSnapshot = initialSnapshot;
      let baselineSnapshot = initialSnapshot;
      let iterationCount = 0;

      while (Date.now() - startTime < effectiveTimeoutMs) {
        iterationCount += 1;
        const remainingMs = effectiveTimeoutMs - (Date.now() - startTime);
        if (remainingMs <= 0) {
          break;
        }

        await sleep(Math.min(pollIntervalMs, remainingMs));

        const currentSnapshot = await captureSnapshot(activePr);
        if (!currentSnapshot) {
          logger.warn('Failed to fetch PR during polling, will retry', { ...activePr, iteration: iterationCount });
          continue;
        }
        lastSnapshot = currentSnapshot;

        if (baselineSnapshot.checkRunsFetchFailed && !currentSnapshot.checkRunsFetchFailed) {
          baselineSnapshot = {
            ...baselineSnapshot,
            checkRuns: currentSnapshot.checkRuns,
            checkRunsFetchFailed: false,
          };
        }

        const changes = detectChanges(baselineSnapshot, currentSnapshot, watchMode);
        if (changes.length > 0) {
          const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
          return {
            changed: true,
            changes,
            elapsedSeconds,
            iterations: iterationCount,
            snapshot: currentSnapshot,
            summary: formatChangeSummary(changes, currentSnapshot, elapsedSeconds),
          };
        }
      }

      const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
      return {
        changed: false,
        elapsedSeconds,
        iterations: iterationCount,
        snapshot: lastSnapshot,
        summary: [
          `⏱️ Timeout reached after ${elapsedSeconds} seconds without detecting changes.`,
          `Watched mode: ${watchMode}`,
          `Polls performed: ${iterationCount}`,
        ].join('\n'),
      };
    },

    async listReviewComments(options: ListPrReviewCommentsOptions = {}) {
      const activePr = requirePrContext(prContext);
      const status = validateReviewCommentStatus(options.status);

      logger.info('ws.pr.listReviewComments', { ...activePr, path: options.path, status });

      let threads: ReviewThread[] = [];
      let usingFallback = false;
      let pagination:
        | { totalCount: number | null; pagesFetched: number; hasMore: boolean }
        | { totalFetched: number; pagesFetched: number; hasMore: boolean }
        | null = null;

      try {
        const result = await prCommentService.getReviewThreads(activePr.owner, activePr.repo, activePr.prNumber);
        threads = result.threads;
        pagination = {
          totalCount: result.totalCount,
          pagesFetched: result.pagesFetched,
          hasMore: result.hasMore,
        };
      } catch (graphqlError) {
        logger.warn('GraphQL failed, falling back to REST API', graphqlError as Error);
        usingFallback = true;
        const restResult = await prCommentService.listReviewComments(activePr.owner, activePr.repo, activePr.prNumber);
        const restComments = [...restResult.comments].sort((a, b) => a.id - b.id);
        pagination = {
          totalFetched: restResult.totalFetched,
          pagesFetched: restResult.pagesFetched,
          hasMore: restResult.hasMore,
        };

        const threadMap = new Map<number, ReviewThread>();
        const replyMap = new Map<number, number>();

        for (const comment of restComments) {
          if (comment.in_reply_to_id) {
            const rootId = replyMap.get(comment.in_reply_to_id) ?? comment.in_reply_to_id;
            replyMap.set(comment.id, rootId);
            const rootThread = threadMap.get(rootId);
            if (rootThread) {
              rootThread.comments.push({
                id: String(comment.id),
                body: comment.body,
                author: { login: comment.user.login },
                path: comment.path,
                line: comment.line,
                createdAt: comment.created_at,
              });
            } else {
              replyMap.set(comment.id, comment.id);
              threadMap.set(comment.id, {
                id: `rest-thread-${comment.id}`,
                isResolved: false,
                comments: [{
                  id: String(comment.id),
                  body: comment.body,
                  author: { login: comment.user.login },
                  path: comment.path,
                  line: comment.line,
                  createdAt: comment.created_at,
                }],
              });
            }
          } else {
            replyMap.set(comment.id, comment.id);
            threadMap.set(comment.id, {
              id: `rest-thread-${comment.id}`,
              isResolved: false,
              comments: [{
                id: String(comment.id),
                body: comment.body,
                author: { login: comment.user.login },
                path: comment.path,
                line: comment.line,
                createdAt: comment.created_at,
              }],
            });
          }
        }

        threads = Array.from(threadMap.values());
      }

      if (!usingFallback) {
        if (status === 'resolved') {
          threads = threads.filter((thread) => thread.isResolved);
        } else if (status === 'unresolved') {
          threads = threads.filter((thread) => !thread.isResolved);
        }
      }

      if (options.path) {
        threads = threads.filter((thread) => thread.comments.some((comment) => comment.path === options.path));
      }

      return {
        threads,
        threadCount: threads.length,
        usingFallback,
        pagination,
        filter: {
          path: options.path ?? null,
          status,
        },
        note: usingFallback && status !== 'all'
          ? 'Resolved status is unavailable with REST fallback; returning all threads regardless of the status filter.'
          : null,
      };
    },

    async replyToReviewComment(commentId: number, body: string) {
      const activePr = requirePrContext(prContext);
      assertNumber(commentId, 'commentId');
      assertString(body, 'body');

      logger.info('ws.pr.replyToReviewComment', { ...activePr, commentId });

      const result = await prCommentService.replyToReviewComment(
        activePr.owner,
        activePr.repo,
        activePr.prNumber,
        commentId,
        body,
      );

      return {
        id: result.id,
        htmlUrl: result.html_url,
      };
    },

    async resolveThread(threadId: string, action?: ResolveThreadAction) {
      const activePr = requirePrContext(prContext);
      assertString(threadId, 'threadId');

      const normalizedAction = validateResolveThreadAction(action);
      logger.info('ws.pr.resolveThread', { ...activePr, threadId, action: normalizedAction });

      const success = normalizedAction === 'unresolve'
        ? await prCommentService.unresolveThread(threadId)
        : await prCommentService.resolveThread(threadId);

      if (!success) {
        throw new Error(`Failed to ${normalizedAction} thread. The operation may have failed silently.`);
      }

      return {
        ok: true,
        threadId,
        action: normalizedAction,
      };
    },

    async listComments(options: ListPrCommentsOptions = {}) {
      const activePr = requirePrContext(prContext);
      const requestedCount = options.count ?? 20;
      const count = Math.min(Math.max(requestedCount, 1), 100);

      logger.info('ws.pr.listComments', { ...activePr, count });

      const comments = await prCommentService.listIssueComments(
        activePr.owner,
        activePr.repo,
        activePr.prNumber,
        count,
      );

      return {
        count: comments.length,
        comments,
      };
    },

    async postComment(body: string) {
      const activePr = requirePrContext(prContext);
      assertString(body, 'body');

      logger.info('ws.pr.postComment', activePr);

      const result = await prCommentService.postIssueComment(
        activePr.owner,
        activePr.repo,
        activePr.prNumber,
        body,
      );

      return {
        id: result.id,
        htmlUrl: result.html_url,
      };
    },
  };
}

export type WsPrApi = ReturnType<typeof buildWsPrApi>;