/**
 * PR MCP Tools
 *
 * Provides GitHub PR merge and status operations as MCP tools for agents to use.
 */

import yaml from 'js-yaml';
import { BaseMCPTool, createInputSchema, stringProperty, numberProperty } from './tool';
import { ToolCall, ToolResult } from './protocol';
import { Logger } from '../../../../shared/logger';
import { githubService } from '../../../git-tracking/main/github.service';
import { augmentApiClient } from '../../../../shared/augment-api/augment-api.client';
import type { PRContext } from './pr-comment-tools';

const logger = new Logger('PRTools');

const GITHUB_TOOL_ID = 8;

/**
 * Name of the PR status tool for dynamic registration/unregistration
 */
export const PR_STATUS_TOOL_NAME = 'get_pr_status';

/**
 * Tool to merge a pull request
 */
export class MergePRTool extends BaseMCPTool {
  private prContext: PRContext;

  constructor(prContext: PRContext) {
    super(
      'merge_pr',
      'Merge the pull request. Checks if the PR is mergeable before attempting. Accepts merge method and optional commit title/message.',
      createInputSchema(
        {
          merge_method: stringProperty(
            'The merge method to use: "merge" (create a merge commit), "squash" (squash and merge), or "rebase" (rebase and merge). Default: "merge"',
            {
              enum: ['merge', 'squash', 'rebase'],
              default: 'merge',
            },
          ),
          commit_title: stringProperty(
            'Optional: Custom title for the merge commit (used with merge and squash methods)',
          ),
          commit_message: stringProperty(
            'Optional: Custom message for the merge commit (used with merge and squash methods)',
          ),
        },
        [],
      ),
    );
    this.prContext = prContext;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const { merge_method = 'merge', commit_title, commit_message } = call.arguments;
    const { owner, repo, prNumber } = this.prContext;

    try {
      // Check PR mergeability first by fetching current PR state
      const pr = await githubService.getPullRequest(owner, repo, prNumber, { force: true });

      if (!pr) {
        return this.error(`Could not find PR #${prNumber} in ${owner}/${repo}.`);
      }

      // Explicitly block draft PRs with a clear error message
      if (pr.state === 'draft') {
        return this.error(
          `PR #${prNumber} is a draft and cannot be merged. GitHub blocks merging draft PRs. Mark the PR as "Ready for review" first using the GitHub UI or API.`,
        );
      }

      if (pr.state !== 'open') {
        return this.error(
          `PR #${prNumber} is ${pr.state} and cannot be merged.`,
        );
      }

      // Warn about mergeability if GitHub has determined it
      if (pr.mergeable === false) {
        return this.error(
          `PR #${prNumber} is not mergeable. This could be due to merge conflicts, failing required checks, or missing required reviews. Please resolve the issues before attempting to merge.`,
        );
      }

      // Attempt the merge
      const result = await githubService.mergePullRequest(owner, repo, prNumber, {
        mergeMethod: merge_method as 'merge' | 'squash' | 'rebase',
        commitTitle: commit_title,
        commitMessage: commit_message,
      });

      if (result.merged) {
        const lines: string[] = [];
        lines.push(`✅ PR #${prNumber} merged successfully.`);
        lines.push(`Merge SHA: ${result.sha || 'N/A'}`);
        lines.push(`Method: ${merge_method}`);
        lines.push(`Message: ${result.message}`);
        return this.success(lines.join('\n'), {
          merged: true,
          sha: result.sha,
          merge_method,
        });
      } else {
        return this.error(
          `Failed to merge PR #${prNumber}: ${result.message}`,
          { merged: false },
        );
      }
    } catch (error) {
      logger.error('Failed to merge pull request', error as Error);
      return this.error(`Failed to merge PR #${prNumber}: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to get comprehensive PR status including mergeability, draft state, and review status.
 */
export class GetPRStatusTool extends BaseMCPTool {
  private prContext: PRContext;

  constructor(prContext: PRContext) {
    super(
      'get_pr_status',
      'Get the current PR status including mergeability, merge conflicts, and draft state. Returns a human-readable summary.',
      createInputSchema({}, []),
    );
    this.prContext = prContext;
  }

  async execute(_call: ToolCall): Promise<ToolResult> {
    const { owner, repo, prNumber } = this.prContext;

    try {
      // Force-fetch to get fresh mergeability data from GitHub
      const pr = await githubService.getPullRequest(owner, repo, prNumber, { force: true });

      if (!pr) {
        return this.error(
          `Could not fetch PR #${prNumber} for ${owner}/${repo}. The PR may not exist or GitHub API may be unavailable.`,
        );
      }

      const isDraft = pr.state === 'draft';
      const isMerged = pr.state === 'merged';
      const isClosed = pr.state === 'closed';
      const mergeable = pr.mergeable;
      const mergeableState = pr.mergeableState ?? 'unknown';
      // Only mark as conflicts when mergeableState is 'dirty' (actual merge conflicts)
      // mergeable === false can also mean blocked by reviews/checks, not just conflicts
      const hasConflicts = mergeableState === 'dirty';

      // Build human-readable summary
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
          summaryParts.push(
            '🔒 PR is blocked (e.g., required reviews or branch protection rules not met).',
          );
        } else if (mergeableState === 'unstable') {
          summaryParts.push('⚠️ PR has failing status checks.');
        } else if (mergeableState === 'behind') {
          summaryParts.push(
            '🔄 PR branch is behind the target branch and needs to be updated.',
          );
        }
      }

      if (summaryParts.length === 0) {
        summaryParts.push(`PR is in state: ${pr.state}, mergeableState: ${mergeableState}.`);
      }

      const summary = summaryParts.join(' ');

      // Build structured output
      const lines: string[] = [];
      lines.push(`PR #${prNumber}: ${pr.title}`);
      lines.push(`URL: ${pr.url}`);
      lines.push('');
      lines.push('--- Status ---');
      lines.push(`State: ${pr.state}`);
      lines.push(`Mergeable: ${mergeable ?? 'unknown (computing)'}`);
      lines.push(`Mergeable State: ${mergeableState}`);
      lines.push(`Has Conflicts: ${hasConflicts}`);
      lines.push(`Is Draft: ${isDraft}`);
      lines.push(`Is Merged: ${isMerged}`);
      lines.push('');
      lines.push('--- Summary ---');
      lines.push(summary);

      return this.success(lines.join('\n'), {
        prNumber,
        state: pr.state,
        mergeable: mergeable ?? null,
        mergeableState,
        hasConflicts,
        isDraft,
        isMerged,
        isClosed,
        summary,
      });
    } catch (error) {
      logger.error('Failed to get PR status', error as Error);
      return this.error(`Failed to get PR status: ${(error as Error).message}`);
    }
  }
}


/**
 * Tool to update a PR branch with latest changes from the base branch
 */
export class UpdatePRBranchTool extends BaseMCPTool {
  private prContext: PRContext;

  constructor(prContext: PRContext) {
    super(
      'update_pr_branch',
      'Update the PR branch by merging the latest changes from the base branch. Uses GitHub API (note: GitHub only supports merge, not rebase, for this operation).',
      createInputSchema({}, []),
    );
    this.prContext = prContext;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    void call; // No parameters needed
    const { owner, repo, prNumber } = this.prContext;

    try {
      logger.info('Updating PR branch', { owner, repo, prNumber });

      // Get the PR to find the current head SHA to prevent race conditions
      // Use githubService with force: true to bypass cache and get fresh data
      const pr = await githubService.getPullRequest(owner, repo, prNumber, { force: true });
      if (!pr) {
        return this.error(`Could not find PR #${prNumber}`);
      }

      // Validate headSha is present for race protection
      if (!pr.headSha) {
        logger.warn('PR headSha is empty, race condition protection will be disabled', { owner, repo, prNumber });
      }

      const result = await augmentApiClient.updatePullRequestBranch(
        owner,
        repo,
        prNumber,
        pr.headSha || undefined, // Pass undefined if empty so API skips the param
      );

      return this.success(
        `PR branch updated successfully via merge.\n${result.message}${result.url ? `\nURL: ${result.url}` : ''}`,
        {
          method: 'merge',
          message: result.message,
          url: result.url,
        },
      );
    } catch (error) {
      logger.error('Failed to update PR branch', error as Error);
      const errorMessage = (error as Error).message;

      // Provide helpful error messages for common cases
      if (errorMessage.includes('already up-to-date') || errorMessage.includes('already up to date')) {
        return this.success('PR branch is already up-to-date with the base branch.', {
          alreadyUpToDate: true,
        });
      }

      if (errorMessage.includes('merge conflict') || errorMessage.includes('Merge conflict')) {
        return this.error(
          `Cannot update PR branch: merge conflicts detected. The conflicts must be resolved manually.\n${errorMessage}`,
        );
      }

      return this.error(`Failed to update PR branch: ${errorMessage}`);
    }
  }
}

/**
 * Name of the wait for PR changes tool for dynamic registration/unregistration
 */
export const WAIT_FOR_PR_CHANGES_TOOL_NAME = 'wait_for_pr_changes';

/**
 * Safety padding in seconds to ensure the tool returns before transport-layer timeouts.
 * The tool will finish this many seconds before the user-specified timeout to guarantee
 * a response is sent back even if the transport has a matching timeout configured.
 */
export const SAFETY_PADDING_SECONDS = 10;

// Types for check run status tracking
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

/**
 * Tool to wait for PR state changes by polling.
 * Useful for agents waiting on CI completion, review updates, or new commits.
 */
export class WaitForPRChangesTool extends BaseMCPTool {
  private prContext: PRContext;

  constructor(prContext: PRContext) {
    super(
      'wait_for_pr_changes',
      'Wait for changes to the PR (new commits, check status updates, state changes). Polls GitHub until a change is detected or timeout occurs. Returns a summary of what changed.',
      createInputSchema(
        {
          timeout_seconds: numberProperty(
            'Maximum time to wait in seconds (10-600, default: 300)',
            { default: 300, minimum: 10, maximum: 600 },
          ),
          poll_interval_seconds: numberProperty(
            'Interval between polls in seconds (10-60, default: 15)',
            { default: 15, minimum: 10, maximum: 60 },
          ),
          watch: stringProperty(
            'What to watch for: "any" (all changes), "checks" (CI status), "state" (open/closed/merged, mergeability), "commits" (new commits). Default: "any"',
            { enum: ['any', 'checks', 'state', 'commits'], default: 'any' },
          ),
        },
        [],
      ),
    );
    this.prContext = prContext;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const {
      timeout_seconds = 300,
      poll_interval_seconds = 15,
      watch = 'any',
    } = call.arguments;

    const { owner, repo, prNumber } = this.prContext;

    // Coerce to numbers with fallback to defaults for non-numeric inputs
    const rawTimeout = Number(timeout_seconds);
    const rawPollInterval = Number(poll_interval_seconds);
    const timeout = Math.max(10, Math.min(600, isNaN(rawTimeout) ? 300 : rawTimeout));
    const pollInterval = Math.max(10, Math.min(60, isNaN(rawPollInterval) ? 15 : rawPollInterval));
    const watchMode = watch as 'any' | 'checks' | 'state' | 'commits';

    const startTime = Date.now();
    const timeoutMs = timeout * 1000;
    const pollIntervalMs = pollInterval * 1000;

    // Safety padding: finish early to ensure response is sent before transport-layer timeouts.
    // Clamp effectiveTimeout to at least one poll interval to ensure at least one poll happens,
    // but never exceed the user-provided timeout to avoid tripping the STDIO server timeout.
    const safetyPaddingMs = SAFETY_PADDING_SECONDS * 1000;
    const effectiveTimeoutMs = Math.min(timeoutMs, Math.max(pollIntervalMs, timeoutMs - safetyPaddingMs));

    try {
      // Capture initial snapshot
      logger.info('Capturing initial PR snapshot', { owner, repo, prNumber, watchMode });
      const initialSnapshot = await this.captureSnapshot(owner, repo, prNumber);
      if (!initialSnapshot) {
        return this.error(`Could not fetch PR #${prNumber} for ${owner}/${repo}.`);
      }

      let lastSnapshot = initialSnapshot;
      let baselineSnapshot = initialSnapshot;
      let iterationCount = 0;
      // Polling loop - uses effectiveTimeoutMs to ensure we finish before transport-layer timeouts
      while (Date.now() - startTime < effectiveTimeoutMs) {
        iterationCount++;
        // Sleep before next poll, clamping to remaining effective time
        const remainingMs = effectiveTimeoutMs - (Date.now() - startTime);
        if (remainingMs <= 0) break;
        await this.sleep(Math.min(pollIntervalMs, remainingMs));

        const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
        logger.info('Polling PR for changes', {
          owner,
          repo,
          prNumber,
          iteration: iterationCount,
          elapsedSeconds,
          watchMode,
        });

        // Fetch fresh PR state
        const currentSnapshot = await this.captureSnapshot(owner, repo, prNumber);
        if (!currentSnapshot) {
          logger.warn('Failed to fetch PR during polling, will retry', {
            owner,
            repo,
            prNumber,
            iteration: iterationCount,
          });
          continue;
        }
        lastSnapshot = currentSnapshot;

        // Update baseline if initial check-runs fetch failed but current succeeded
        if (baselineSnapshot.checkRunsFetchFailed && !currentSnapshot.checkRunsFetchFailed) {
          logger.info('Updating check-runs baseline after initial fetch failure recovered', {
            owner,
            repo,
            prNumber,
            iteration: iterationCount,
          });
          baselineSnapshot = {
            ...baselineSnapshot,
            checkRuns: currentSnapshot.checkRuns,
            checkRunsFetchFailed: false,
          };
        }

        // Compare snapshots based on watch mode
        const changes = this.detectChanges(baselineSnapshot, currentSnapshot, watchMode);
        if (changes.length > 0) {
          const summary = this.formatChangeSummary(changes, currentSnapshot, elapsedSeconds);
          return this.success(summary, {
            changed: true,
            changes,
            elapsedSeconds,
            iterations: iterationCount,
            snapshot: currentSnapshot,
          });
        }
      }

      // Timeout reached without detecting changes
      const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
      const lines: string[] = [];
      lines.push(`⏱️ Timeout reached after ${elapsedSeconds} seconds without detecting changes.`);
      lines.push(`Watched mode: ${watchMode}`);
      lines.push(`Polls performed: ${iterationCount}`);
      lines.push('');
      lines.push('--- Current State ---');
      lines.push(`State: ${lastSnapshot.state}`);
      lines.push(`Head SHA: ${lastSnapshot.headSha || 'unknown'}`);
      lines.push(`Mergeable: ${lastSnapshot.mergeable ?? 'unknown'}`);
      lines.push(`Mergeable State: ${lastSnapshot.mergeableState || 'unknown'}`);
      if (lastSnapshot.checkRuns.length > 0) {
        lines.push('');
        lines.push('Check Runs:');
        for (const check of lastSnapshot.checkRuns) {
          const status = check.conclusion || check.status;
          lines.push(`  - ${check.name}: ${status}`);
        }
      }

      return this.success(lines.join('\n'), {
        changed: false,
        elapsedSeconds,
        iterations: iterationCount,
        snapshot: lastSnapshot,
      });
    } catch (error) {
      logger.error('Failed to wait for PR changes', error as Error);
      return this.error(`Failed to wait for PR changes: ${(error as Error).message}`);
    }
  }

  private async captureSnapshot(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<PRSnapshot | null> {
    // Force-fetch to bypass cache
    const pr = await githubService.getPullRequest(owner, repo, prNumber, { force: true });
    if (!pr) {
      return null;
    }

    // Fetch check runs for the head SHA
    let checkRuns: CheckRunStatus[] = [];
    let checkRunsFetchFailed = false;
    if (pr.headSha) {
      try {
        checkRuns = await this.fetchCheckRuns(owner, repo, pr.headSha);
      } catch (error) {
        logger.warn('Failed to fetch check runs', { error: (error as Error).message });
        // Mark as failed so we don't report spurious changes
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

  private async fetchCheckRuns(
    owner: string,
    repo: string,
    commitSha: string,
  ): Promise<CheckRunStatus[]> {
    const path = `/repos/${owner}/${repo}/commits/${commitSha}/check-runs`;
    const toolInput = {
      path,
      method: 'GET',
    };

    const response = await augmentApiClient.callEndpoint<{
      tool_output: string;
      tool_result_message: string;
      status: number;
    }>('agents/run-remote-tool', {
      tool_name: 'github-api',
      tool_input_json: JSON.stringify(toolInput),
      tool_id: GITHUB_TOOL_ID,
    });

    // Status 1 = TOOL_EXECUTION_OK
    if (response.status !== 1) {
      throw new Error(response.tool_output || response.tool_result_message || 'Unknown error');
    }

    if (!response.tool_output || response.tool_output.trim() === '') {
      return [];
    }

    // Parse YAML response
    const parsed = yaml.load(response.tool_output) as { check_runs?: Array<{
      name: string;
      status: string;
      conclusion: string | null;
    }> };

    if (!parsed || !parsed.check_runs) {
      return [];
    }

    return parsed.check_runs.map((cr) => ({
      name: cr.name,
      status: cr.status,
      conclusion: cr.conclusion,
    }));
  }

  private detectChanges(
    initial: PRSnapshot,
    current: PRSnapshot,
    watchMode: 'any' | 'checks' | 'state' | 'commits',
  ): string[] {
    const changes: string[] = [];

    // Check for new commits
    if (watchMode === 'any' || watchMode === 'commits') {
      if (initial.headSha && current.headSha && initial.headSha !== current.headSha) {
        changes.push(`New commit: ${initial.headSha.substring(0, 7)} → ${current.headSha.substring(0, 7)}`);
      }
    }

    // Check for state changes
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

    // Check for check run changes (skip if either snapshot had a fetch failure to avoid spurious changes)
    if (watchMode === 'any' || watchMode === 'checks') {
      if (!initial.checkRunsFetchFailed && !current.checkRunsFetchFailed) {
        const initialChecks = new Map(initial.checkRuns.map((c) => [c.name, c]));
        const currentChecks = new Map(current.checkRuns.map((c) => [c.name, c]));

        // Detect new checks
        for (const [name, check] of currentChecks) {
          const initialCheck = initialChecks.get(name);
          if (!initialCheck) {
            const status = check.conclusion || check.status;
            changes.push(`New check: ${name} (${status})`);
          } else {
            // Detect status/conclusion changes
            const initialStatus = initialCheck.conclusion || initialCheck.status;
            const currentStatus = check.conclusion || check.status;
            if (initialStatus !== currentStatus) {
              changes.push(`Check "${name}": ${initialStatus} → ${currentStatus}`);
            }
          }
        }
      }
    }

    // Check for any other updates (comments, reviews, etc.) via updatedAt
    if (watchMode === 'any') {
      if (initial.updatedAt && current.updatedAt && initial.updatedAt !== current.updatedAt) {
        // Only report if no other changes were detected (to avoid noise)
        if (changes.length === 0) {
          changes.push(`PR updated: ${initial.updatedAt} → ${current.updatedAt}`);
        }
      }
    }

    return changes;
  }

  private formatChangeSummary(
    changes: string[],
    snapshot: PRSnapshot,
    elapsedSeconds: number,
  ): string {
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
        const status = check.conclusion || check.status;
        const icon = this.getCheckIcon(check);
        lines.push(`  ${icon} ${check.name}: ${status}`);
      }
    }

    return lines.join('\n');
  }

  private getCheckIcon(check: CheckRunStatus): string {
    if (check.conclusion === 'success') return '✅';
    if (check.conclusion === 'failure') return '❌';
    if (check.conclusion === 'cancelled') return '🚫';
    if (check.conclusion === 'skipped') return '⏭️';
    if (check.status === 'in_progress') return '🔄';
    if (check.status === 'queued') return '⏳';
    return '•';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
