/**
 * PR Comment Service
 *
 * Handles GitHub PR review comment + thread operations via the daemon
 * `github.*` namespace (PROTOCOL §5.27) over the shared JSON-RPC client. The
 * daemon wire is camelCase; this service translates each DTO back to the
 * GitHub-native snake_case shapes the existing consumers expect.
 */

import { getBackendClient } from '../../backend/main/backend.ipc';
import { JsonRpcError } from '../../backend/main/json-rpc-errors';
import { Logger } from '../../../shared/logger';

const logger = new Logger('PRCommentService');

// ============================================================================
// Types
// ============================================================================

export interface ReviewComment {
  id: number;
  body: string;
  path: string;
  line: number | null;
  user: {
    login: string;
    avatar_url?: string;
  };
  created_at: string;
  updated_at: string;
  in_reply_to_id?: number;
  html_url: string;
}

export interface IssueComment {
  id: number;
  body: string;
  user: {
    login: string;
    avatar_url?: string;
  };
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface ReviewThreadComment {
  id: string;
  body: string;
  author: {
    login: string;
  };
  path: string;
  line: number | null;
  createdAt: string;
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  comments: ReviewThreadComment[];
}

export interface PaginatedReviewThreads {
  threads: ReviewThread[];
  totalCount: number | null;
  pagesFetched: number;
  hasMore: boolean;
}

export interface PaginatedReviewComments {
  comments: ReviewComment[];
  totalFetched: number;
  pagesFetched: number;
  hasMore: boolean;
}

// ============================================================================
// Daemon wire shapes (camelCase, PROTOCOL §5.27)
// ============================================================================

interface WireReviewComment {
  id: number;
  body?: string;
  path?: string;
  line?: number | null;
  user?: {
    login?: string;
    avatarUrl?: string;
  };
  createdAt?: string;
  updatedAt?: string;
  inReplyToId?: number;
  htmlUrl?: string;
}

interface WireReviewThreadComment {
  id?: string;
  body?: string;
  author?: {
    login?: string;
  };
  path?: string;
  line?: number | null;
  createdAt?: string;
}

interface WireReviewThread {
  id?: string;
  isResolved?: boolean;
  comments?: WireReviewThreadComment[];
}

interface WireListReviewCommentsResult {
  comments?: WireReviewComment[];
  nextToken?: string | null;
}

interface WireReplyReviewCommentResult {
  comment: WireReviewComment;
}

interface WireGetReviewThreadsResult {
  threads?: WireReviewThread[];
  nextToken?: string | null;
}

interface WireResolveThreadResult {
  isResolved?: boolean;
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Whether a daemon JSON-RPC error should degrade to an empty result rather than
 * propagate. Covers methods that are not wired yet (-32601), missing/invalid
 * params and "not found" lookups (-32602), and a token that is absent or fails
 * `GET /user` / other GitHub failures (-32603) per PROTOCOL §5.27 / §9.
 */
function isDaemonDataError(error: unknown): boolean {
  if (error instanceof JsonRpcError) {
    return error.rpcCode === -32601 || error.rpcCode === -32602 || error.rpcCode === -32603;
  }
  return false;
}

// ============================================================================
// Service Class
// ============================================================================

export class PRCommentService {
  // --------------------------------------------------------------------------
  // REST API Methods
  // --------------------------------------------------------------------------

  /**
   * List review comments on a pull request (REST inline comments).
   *
   * Pages through `github.listReviewComments` via the opaque `nextToken`
   * cursor (§5.5). A not-configured / not-found daemon error degrades to an
   * empty result rather than throwing.
   */
  async listReviewComments(owner: string, repo: string, prNumber: number): Promise<PaginatedReviewComments> {
    const allComments: ReviewComment[] = [];
    const limit = 100;
    const maxPages = 10;
    let pagesFetched = 0;
    let nextToken: string | null = null;
    let hasMore = false;

    logger.info('Listing review comments', { owner, repo, prNumber });

    try {
      for (let page = 0; page < maxPages; page++) {
        const requestParams: Record<string, unknown> = { owner, repo, number: prNumber, limit };
        if (nextToken) {
          requestParams.nextToken = nextToken;
        }
        const result = await getBackendClient().request<WireListReviewCommentsResult>(
          'github.listReviewComments',
          requestParams,
        );

        pagesFetched++;
        const comments = (result?.comments ?? []).map((item) => this.mapWireToReviewComment(item));
        allComments.push(...comments);

        nextToken = result?.nextToken ?? null;
        if (!nextToken) {
          break;
        }
        if (page === maxPages - 1) {
          hasMore = true;
        }
      }

      if (hasMore) {
        logger.warn('Review comments pagination hit maxPages cap, results may be truncated', {
          owner,
          repo,
          prNumber,
          pagesFetched,
          totalFetched: allComments.length,
          maxPages,
        });
      }

      return {
        comments: allComments,
        totalFetched: allComments.length,
        pagesFetched,
        hasMore,
      };
    } catch (error) {
      if (isDaemonDataError(error)) {
        logger.warn('listReviewComments degraded to empty (daemon not configured / not found)', {
          owner,
          repo,
          prNumber,
        });
        return { comments: [], totalFetched: 0, pagesFetched, hasMore: false };
      }
      logger.error('Failed to list review comments', error as Error);
      throw error;
    }
  }

  /**
   * Reply to an existing review comment via `github.replyReviewComment`
   * (the daemon sets `inReplyToId = commentId`).
   */
  async replyToReviewComment(
    owner: string,
    repo: string,
    prNumber: number,
    commentId: number,
    body: string,
  ): Promise<ReviewComment> {
    logger.info('Replying to review comment', { owner, repo, prNumber, commentId });

    try {
      const result = await getBackendClient().request<WireReplyReviewCommentResult>(
        'github.replyReviewComment',
        { owner, repo, number: prNumber, commentId, body },
      );
      return this.mapWireToReviewComment(result.comment);
    } catch (error) {
      logger.error('Failed to reply to review comment', error as Error);
      throw error;
    }
  }

  /**
   * List issue/PR conversation comments.
   *
   * GAP: the `github.*` namespace (PROTOCOL §5.27) has no wire method for
   * conversation-level issue comments (the workspace-scoped `pr.listComments`
   * in §5.7 needs workspace context unavailable at this explicit-addressing
   * call site). Degrades gracefully to an empty list. See BE hand-off note
   * d1df7466.
   */
  async listIssueComments(
    owner: string,
    repo: string,
    issueNumber: number,
    _count = 100,
  ): Promise<IssueComment[]> {
    logger.warn('listIssueComments has no github.* daemon method; returning empty', {
      owner,
      repo,
      issueNumber,
    });
    return [];
  }

  /**
   * Post a comment on an issue or PR.
   *
   * GAP: no `github.*` wire method exists for posting conversation-level
   * comments (PROTOCOL §5.27). Surfaces a clear not-available error rather than
   * fabricating a method. See BE hand-off note d1df7466.
   */
  async postIssueComment(
    owner: string,
    repo: string,
    issueNumber: number,
    _body: string,
  ): Promise<IssueComment> {
    logger.warn('postIssueComment has no github.* daemon method', { owner, repo, issueNumber });
    throw new Error(
      'Posting issue comments is not available via the daemon github.* namespace yet (no wire method; see BE hand-off note d1df7466).',
    );
  }

  // --------------------------------------------------------------------------
  // GraphQL API Methods
  // --------------------------------------------------------------------------

  /**
   * Get review threads for a pull request via `github.getReviewThreads`
   * (GraphQL `pullRequest.reviewThreads`). Pages through the opaque `nextToken`
   * cursor (§5.5). The daemon does not surface a total count, so `totalCount`
   * is null. A not-configured / not-found error degrades to empty.
   */
  async getReviewThreads(owner: string, repo: string, prNumber: number): Promise<PaginatedReviewThreads> {
    logger.info('Getting review threads', { owner, repo, prNumber });

    const allThreads: ReviewThread[] = [];
    const limit = 100;
    const maxPages = 20;
    let pagesFetched = 0;
    let nextToken: string | null = null;
    let hasMore = false;

    try {
      for (let page = 0; page < maxPages; page++) {
        const requestParams: Record<string, unknown> = { owner, repo, number: prNumber, limit };
        if (nextToken) {
          requestParams.nextToken = nextToken;
        }
        const result = await getBackendClient().request<WireGetReviewThreadsResult>(
          'github.getReviewThreads',
          requestParams,
        );

        pagesFetched++;
        const threads = (result?.threads ?? [])
          .filter((node): node is WireReviewThread => node != null && typeof node === 'object')
          .map((node) => this.mapWireToReviewThread(node));
        allThreads.push(...threads);

        nextToken = result?.nextToken ?? null;
        if (!nextToken) {
          break;
        }
        if (page === maxPages - 1) {
          hasMore = true;
        }
      }

      if (hasMore) {
        logger.warn('Review threads pagination hit maxPages cap, results may be truncated', {
          owner,
          repo,
          prNumber,
          pagesFetched,
          maxPages,
          totalThreadsFetched: allThreads.length,
        });
      }

      return {
        threads: allThreads,
        totalCount: null,
        pagesFetched,
        hasMore,
      };
    } catch (error) {
      if (isDaemonDataError(error)) {
        logger.warn('getReviewThreads degraded to empty (daemon not configured / not found)', {
          owner,
          repo,
          prNumber,
        });
        return { threads: [], totalCount: null, pagesFetched, hasMore: false };
      }
      logger.error('Failed to get review threads', error as Error);
      throw error;
    }
  }

  /**
   * Resolve a review thread via `github.resolveThread`
   * (GraphQL `resolveReviewThread`).
   */
  async resolveThread(threadId: string): Promise<boolean> {
    logger.info('Resolving review thread', { threadId });

    try {
      const result = await getBackendClient().request<WireResolveThreadResult>(
        'github.resolveThread',
        { threadId },
      );
      return result?.isResolved === true;
    } catch (error) {
      logger.error('Failed to resolve review thread', error as Error);
      throw error;
    }
  }

  /**
   * Unresolve a review thread via `github.unresolveThread`
   * (GraphQL `unresolveReviewThread`).
   */
  async unresolveThread(threadId: string): Promise<boolean> {
    logger.info('Unresolving review thread', { threadId });

    try {
      const result = await getBackendClient().request<WireResolveThreadResult>(
        'github.unresolveThread',
        { threadId },
      );
      return result?.isResolved === false;
    } catch (error) {
      logger.error('Failed to unresolve review thread', error as Error);
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Private Helper Methods
  // --------------------------------------------------------------------------

  private mapWireToReviewComment(item: WireReviewComment): ReviewComment {
    const user = item.user ?? {};
    return {
      id: item.id,
      body: item.body || '',
      path: item.path || '',
      line: item.line ?? null,
      user: {
        login: user.login || 'unknown',
        avatar_url: user.avatarUrl,
      },
      created_at: this.normalizeDate(item.createdAt),
      updated_at: this.normalizeDate(item.updatedAt),
      in_reply_to_id: item.inReplyToId,
      html_url: item.htmlUrl || '',
    };
  }

  private mapWireToReviewThread(node: WireReviewThread): ReviewThread {
    const commentNodes = node.comments ?? [];
    return {
      id: node.id || '',
      isResolved: node.isResolved || false,
      comments: commentNodes
        .filter((comment): comment is WireReviewThreadComment => comment != null && typeof comment === 'object')
        .map((comment) => {
          const author = comment.author ?? {};
          return {
            id: comment.id || '',
            body: comment.body || '',
            author: {
              login: author.login || 'unknown',
            },
            path: comment.path || '',
            line: comment.line ?? null,
            createdAt: this.normalizeDate(comment.createdAt),
          };
        }),
    };
  }

  private normalizeDate(value: unknown): string {
    if (value === undefined || value === null) {
      return '';
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return String(value);
  }
}

// Singleton instance
export const prCommentService = new PRCommentService();

