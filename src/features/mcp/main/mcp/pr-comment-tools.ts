/**
 * PR Comment MCP Tools
 *
 * Provides GitHub PR comment operations as MCP tools for agents to use.
 */

import { BaseMCPTool, createInputSchema, stringProperty, numberProperty } from './tool';
import { ToolCall, ToolResult } from './protocol';
import { Logger } from '../../../../shared/logger';
import {
  prCommentService,
  ReviewThread,
  PaginatedReviewThreads,
  PaginatedReviewComments,
} from '../../../git-tracking/main/pr-comment.service';

const logger = new Logger('PRCommentTools');

/**
 * Context required for PR comment operations
 */
export interface PRContext {
  owner: string;
  repo: string;
  prNumber: number;
}

/**
 * Names of all PR comment tools for dynamic registration/unregistration
 */
export const PR_TOOL_NAMES = [
  'list_pr_review_comments',
  'reply_to_pr_review_comment',
  'resolve_pr_review_thread',
  'list_pr_comments',
  'post_pr_comment',
  'merge_pr',
  'update_pr_branch',
  'wait_for_pr_changes',
] as const;

/**
 * Tool to list inline review comments on a PR, grouped by thread
 */
export class ListPRReviewCommentsTool extends BaseMCPTool {
  private prContext: PRContext;

  constructor(prContext: PRContext) {
    super(
      'list_pr_review_comments',
      'List inline review comments on the PR, grouped by review thread with resolved/unresolved status',
      createInputSchema(
        {
          path: stringProperty('Optional: filter by file path'),
          status: stringProperty('Filter by status: "unresolved", "resolved", or "all" (default: "unresolved")', {
            enum: ['unresolved', 'resolved', 'all'],
            default: 'unresolved',
          }),
        },
        [],
      ),
    );
    this.prContext = prContext;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const { path, status = 'unresolved' } = call.arguments;
    const { owner, repo, prNumber } = this.prContext;

    try {
      // Try GraphQL first (has resolved status)
      let threads: ReviewThread[];
      let usingFallback = false;
      let paginationInfo: { totalCount: number | null; pagesFetched: number; hasMore: boolean } | null = null;
      let restPaginationInfo: { totalFetched: number; pagesFetched: number; hasMore: boolean } | null = null;

      try {
        const result: PaginatedReviewThreads = await prCommentService.getReviewThreads(owner, repo, prNumber);
        threads = result.threads;
        paginationInfo = {
          totalCount: result.totalCount,
          pagesFetched: result.pagesFetched,
          hasMore: result.hasMore,
        };
      } catch (graphqlError) {
        // Fall back to REST API
        logger.warn('GraphQL failed, falling back to REST API', graphqlError as Error);
        usingFallback = true;
        const restResult: PaginatedReviewComments = await prCommentService.listReviewComments(owner, repo, prNumber);
        const restComments = restResult.comments;
        restPaginationInfo = {
          totalFetched: restResult.totalFetched,
          pagesFetched: restResult.pagesFetched,
          hasMore: restResult.hasMore,
        };

        // Sort ascending by ID to ensure root comments are processed before their replies
        restComments.sort((a, b) => a.id - b.id);

        // Build thread chains using in_reply_to_id
        const threadMap = new Map<number, ReviewThread>();
        const replyMap = new Map<number, number>(); // commentId -> rootCommentId

        for (const comment of restComments) {
          if (comment.in_reply_to_id) {
            // This is a reply — find its root
            const rootId = replyMap.get(comment.in_reply_to_id) ?? comment.in_reply_to_id;
            replyMap.set(comment.id, rootId);
            if (threadMap.has(rootId)) {
              threadMap.get(rootId)!.comments.push({
                id: String(comment.id),
                body: comment.body,
                author: { login: comment.user.login },
                path: comment.path,
                line: comment.line,
                createdAt: comment.created_at,
              });
            } else {
              // Root comment is outside fetched page — create standalone thread for orphaned reply
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
            // Root comment — create a new thread
            replyMap.set(comment.id, comment.id);
            threadMap.set(comment.id, {
              id: `rest-thread-${comment.id}`,
              isResolved: false, // Unknown from REST API
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

      // Filter by status (only when resolved status is available from GraphQL)
      if (!usingFallback) {
        if (status === 'resolved') {
          threads = threads.filter((t) => t.isResolved);
        } else if (status === 'unresolved') {
          threads = threads.filter((t) => !t.isResolved);
        }
      }

      // Filter by path
      if (path) {
        threads = threads.filter((t) => t.comments.some((c) => c.path === path));
      }

      if (threads.length === 0) {
        return this.success(`No ${status === 'all' ? '' : status + ' '}review comments found.`);
      }

      // Format output
      const lines: string[] = [];
      if (usingFallback) {
        lines.push(`⚠️ Note: Using REST API fallback. Resolved status is unavailable${status !== 'all' ? ' — showing all threads regardless of status filter' : ''}.\n`);
      }
      lines.push(`Found ${threads.length} review thread(s):`);

      // Add pagination context
      if (!usingFallback && paginationInfo) {
        if (paginationInfo.totalCount !== null) {
          lines.push(`(total: ${paginationInfo.totalCount}, fetched in ${paginationInfo.pagesFetched} page(s))`);
        } else {
          lines.push(`(fetched in ${paginationInfo.pagesFetched} page(s))`);
        }
        if (paginationInfo.hasMore) {
          lines.push(`⚠️ Results may be truncated — more data available beyond pagination limit.`);
        }
      } else if (usingFallback && restPaginationInfo) {
        lines.push(`(fetched ${restPaginationInfo.totalFetched} comments in ${restPaginationInfo.pagesFetched} page(s))`);
        if (restPaginationInfo.hasMore) {
          lines.push(`⚠️ Results may be truncated — more data available beyond pagination limit.`);
        }
      }
      lines.push('');

      for (const thread of threads) {
        const firstComment = thread.comments[0];
        const resolvedLabel = thread.isResolved ? '✅ RESOLVED' : '❌ UNRESOLVED';
        lines.push(`--- Thread (${resolvedLabel}) ---`);
        lines.push(`Thread ID: ${thread.id}${usingFallback ? ' (REST fallback — not resolvable)' : ''}`);
        lines.push(`File: ${firstComment?.path || 'unknown'}`);
        if (firstComment?.line != null) {
          lines.push(`Line: ${firstComment.line}`);
        }
        lines.push('');

        for (const comment of thread.comments) {
          lines.push(`  @${comment.author.login} (${comment.createdAt}):`);
          lines.push(`  Comment ID: ${comment.id}`);
          lines.push(`  ${comment.body.split('\n').join('\n  ')}`);
          lines.push('');
        }
      }

      return this.success(lines.join('\n'), { threadCount: threads.length });
    } catch (error) {
      logger.error('Failed to list review comments', error as Error);
      return this.error(`Failed to list review comments: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to reply to an existing review comment thread
 */
export class ReplyToPRReviewCommentTool extends BaseMCPTool {
  private prContext: PRContext;

  constructor(prContext: PRContext) {
    super(
      'reply_to_pr_review_comment',
      'Reply to an existing review comment thread on the PR',
      createInputSchema(
        {
          comment_id: numberProperty('The review comment ID to reply to'),
          body: stringProperty('The reply content'),
        },
        ['comment_id', 'body'],
      ),
    );
    this.prContext = prContext;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const { comment_id, body } = call.arguments;
    const { owner, repo, prNumber } = this.prContext;

    if (!comment_id || typeof comment_id !== 'number') {
      return this.error('comment_id is required and must be a number');
    }
    if (!body || typeof body !== 'string') {
      return this.error('body is required and must be a string');
    }

    try {
      const result = await prCommentService.replyToReviewComment(owner, repo, prNumber, comment_id, body);
      return this.success(`Reply posted successfully.\nComment ID: ${result.id}\nURL: ${result.html_url}`, {
        id: result.id,
        html_url: result.html_url,
      });
    } catch (error) {
      logger.error('Failed to reply to review comment', error as Error);
      return this.error(`Failed to reply: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to resolve or unresolve a PR review thread
 */
export class ResolvePRReviewThreadTool extends BaseMCPTool {
  private prContext: PRContext;

  constructor(prContext: PRContext) {
    super(
      'resolve_pr_review_thread',
      'Resolve or unresolve a PR review thread',
      createInputSchema(
        {
          thread_id: stringProperty('The GraphQL node ID of the thread to resolve/unresolve'),
          action: stringProperty('Action to perform: "resolve" or "unresolve" (default: "resolve")', {
            enum: ['resolve', 'unresolve'],
            default: 'resolve',
          }),
        },
        ['thread_id'],
      ),
    );
    this.prContext = prContext;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const { thread_id, action = 'resolve' } = call.arguments;

    if (!thread_id || typeof thread_id !== 'string') {
      return this.error('thread_id is required and must be a string (GraphQL node ID)');
    }

    try {
      let success: boolean;
      if (action === 'unresolve') {
        success = await prCommentService.unresolveThread(thread_id);
      } else {
        success = await prCommentService.resolveThread(thread_id);
      }

      if (success) {
        return this.success(`Thread ${action}d successfully.`, { thread_id, action });
      } else {
        return this.error(`Failed to ${action} thread. The operation may have failed silently.`);
      }
    } catch (error) {
      logger.error(`Failed to ${action} thread`, error as Error);
      return this.error(`Failed to ${action} thread: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to list general (non-inline) comments on a PR
 */
export class ListPRCommentsTool extends BaseMCPTool {
  private prContext: PRContext;

  constructor(prContext: PRContext) {
    super(
      'list_pr_comments',
      'List general (non-inline) comments on the PR',
      createInputSchema(
        {
          count: numberProperty('Number of comments to retrieve (default: 20, max: 100)', {
            default: 20,
            minimum: 1,
            maximum: 100,
          }),
        },
        [],
      ),
    );
    this.prContext = prContext;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const { count = 20 } = call.arguments;
    const { owner, repo, prNumber } = this.prContext;

    const actualCount = Math.min(Math.max(1, count), 100);

    try {
      const comments = await prCommentService.listIssueComments(owner, repo, prNumber, actualCount);

      if (comments.length === 0) {
        return this.success('No general comments found on this PR.');
      }

      const lines: string[] = [];
      lines.push(`Found ${comments.length} comment(s):\n`);

      for (const comment of comments) {
        lines.push(`--- Comment #${comment.id} ---`);
        lines.push(`Author: @${comment.user.login}`);
        lines.push(`Date: ${comment.created_at}`);
        lines.push(`URL: ${comment.html_url}`);
        lines.push('');
        lines.push(comment.body);
        lines.push('');
      }

      return this.success(lines.join('\n'), { count: comments.length });
    } catch (error) {
      logger.error('Failed to list PR comments', error as Error);
      return this.error(`Failed to list PR comments: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to post a new general comment on a PR
 */
export class PostPRCommentTool extends BaseMCPTool {
  private prContext: PRContext;

  constructor(prContext: PRContext) {
    super(
      'post_pr_comment',
      'Post a new general comment on the PR',
      createInputSchema(
        {
          body: stringProperty('The comment content'),
        },
        ['body'],
      ),
    );
    this.prContext = prContext;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const { body } = call.arguments;
    const { owner, repo, prNumber } = this.prContext;

    if (!body || typeof body !== 'string') {
      return this.error('body is required and must be a string');
    }

    try {
      const result = await prCommentService.postIssueComment(owner, repo, prNumber, body);
      return this.success(`Comment posted successfully.\nComment ID: ${result.id}\nURL: ${result.html_url}`, {
        id: result.id,
        html_url: result.html_url,
      });
    } catch (error) {
      logger.error('Failed to post PR comment', error as Error);
      return this.error(`Failed to post comment: ${(error as Error).message}`);
    }
  }
}
