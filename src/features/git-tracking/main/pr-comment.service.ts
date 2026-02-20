/**
 * PR Comment Service
 *
 * Handles GitHub PR review comment operations via REST and GraphQL APIs.
 * All API calls are proxied through Augment's backend API.
 */

import yaml from 'js-yaml';
import { augmentApiClient } from '../../../shared/augment-api/augment-api.client';
import { Logger } from '../../../shared/logger';

const logger = new Logger('PRCommentService');

const GITHUB_TOOL_ID = 8;

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

// ============================================================================
// Helper functions
// ============================================================================

interface RemoteToolResponse {
  tool_output: string;
  tool_result_message: string;
  status: number;
}

async function callGitHubApi(toolInput: object): Promise<RemoteToolResponse> {
  const response = await augmentApiClient.callEndpoint<RemoteToolResponse>('agents/run-remote-tool', {
    tool_name: 'github-api',
    tool_input_json: JSON.stringify(toolInput),
    tool_id: GITHUB_TOOL_ID,
  });

  // Status 1 = TOOL_EXECUTION_OK
  if (response.status !== 1) {
    const errorMessage = response.tool_output || response.tool_result_message || 'Unknown error';
    throw new Error(`GitHub API error: ${errorMessage}`);
  }

  return response;
}

function parseYamlResponse<T>(yamlOutput: string): T {
  if (!yamlOutput || yamlOutput.trim() === '') {
    throw new Error('Empty response from GitHub API');
  }
  return yaml.load(yamlOutput) as T;
}

function validateGraphQLResponse(parsed: Record<string, unknown>): void {
  const errors = parsed.errors as unknown[] | undefined;
  if (errors && errors.length > 0) {
    const firstError = errors[0] as Record<string, unknown>;
    const message = (firstError?.message as string) || 'Unknown GraphQL error';
    throw new Error(`GraphQL error: ${message}`);
  }
  if (parsed.data === null || parsed.data === undefined) {
    throw new Error('GraphQL response returned no data');
  }
}

// ============================================================================
// Service Class
// ============================================================================

export class PRCommentService {
  // --------------------------------------------------------------------------
  // REST API Methods
  // --------------------------------------------------------------------------

  /**
   * List review comments on a pull request
   */
  async listReviewComments(owner: string, repo: string, prNumber: number): Promise<ReviewComment[]> {
    const path = `/repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=100&sort=created&direction=desc`;

    const toolInput = {
      summary: `List review comments for PR #${prNumber} in ${owner}/${repo}`,
      method: 'GET',
      path,
    };

    logger.info('Listing review comments', { owner, repo, prNumber });

    try {
      const response = await callGitHubApi(toolInput);
      const parsed = parseYamlResponse<unknown[]>(response.tool_output);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.map((item: unknown) => this.mapToReviewComment(item as Record<string, unknown>));
    } catch (error) {
      logger.error('Failed to list review comments', error as Error);
      throw error;
    }
  }

  /**
   * Reply to an existing review comment
   */
  async replyToReviewComment(
    owner: string,
    repo: string,
    prNumber: number,
    commentId: number,
    body: string,
  ): Promise<ReviewComment> {
    const path = `/repos/${owner}/${repo}/pulls/${prNumber}/comments`;

    const toolInput = {
      summary: `Reply to review comment #${commentId} on PR #${prNumber}`,
      method: 'POST',
      path,
      data: {
        body,
        in_reply_to: commentId,
      },
    };

    logger.info('Replying to review comment', { owner, repo, prNumber, commentId });

    try {
      const response = await callGitHubApi(toolInput);
      const parsed = parseYamlResponse<Record<string, unknown>>(response.tool_output);
      return this.mapToReviewComment(parsed);
    } catch (error) {
      logger.error('Failed to reply to review comment', error as Error);
      throw error;
    }
  }

  /**
   * List issue/PR comments (general comments, not review comments)
   */
  async listIssueComments(
    owner: string,
    repo: string,
    issueNumber: number,
    count = 100,
  ): Promise<IssueComment[]> {
    const clampedCount = Math.min(Math.max(count, 1), 100);
    const path = `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=${clampedCount}&sort=created&direction=desc`;

    const toolInput = {
      summary: `List issue comments for #${issueNumber} in ${owner}/${repo}`,
      method: 'GET',
      path,
    };

    logger.info('Listing issue comments', { owner, repo, issueNumber, count });

    try {
      const response = await callGitHubApi(toolInput);
      const parsed = parseYamlResponse<unknown[]>(response.tool_output);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.map((item: unknown) => this.mapToIssueComment(item as Record<string, unknown>));
    } catch (error) {
      logger.error('Failed to list issue comments', error as Error);
      throw error;
    }
  }

  /**
   * Post a comment on an issue or PR
   */
  async postIssueComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<IssueComment> {
    const path = `/repos/${owner}/${repo}/issues/${issueNumber}/comments`;

    const toolInput = {
      summary: `Post comment on issue/PR #${issueNumber} in ${owner}/${repo}`,
      method: 'POST',
      path,
      data: { body },
    };

    logger.info('Posting issue comment', { owner, repo, issueNumber });

    try {
      const response = await callGitHubApi(toolInput);
      const parsed = parseYamlResponse<Record<string, unknown>>(response.tool_output);
      return this.mapToIssueComment(parsed);
    } catch (error) {
      logger.error('Failed to post issue comment', error as Error);
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // GraphQL API Methods
  // --------------------------------------------------------------------------

  /**
   * Get review threads for a pull request using GraphQL
   */
  async getReviewThreads(owner: string, repo: string, prNumber: number): Promise<ReviewThread[]> {
    const query = `
      query GetReviewThreads($owner: String!, $repo: String!, $prNumber: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $prNumber) {
            reviewThreads(first: 100) {
              nodes {
                id
                isResolved
                comments(first: 100) {
                  nodes {
                    id
                    body
                    author {
                      login
                    }
                    path
                    line
                    createdAt
                  }
                }
              }
            }
          }
        }
      }
    `;

    const toolInput = {
      summary: `Get review threads for PR #${prNumber} in ${owner}/${repo}`,
      method: 'POST',
      path: '/graphql',
      data: {
        query,
        variables: { owner, repo, prNumber },
      },
    };

    logger.info('Getting review threads', { owner, repo, prNumber });

    try {
      const response = await callGitHubApi(toolInput);
      const parsed = parseYamlResponse<Record<string, unknown>>(response.tool_output);
      validateGraphQLResponse(parsed);

      // Navigate the GraphQL response structure
      const data = parsed.data as Record<string, unknown> | undefined;
      const repository = data?.repository as Record<string, unknown> | undefined;
      const pullRequest = repository?.pullRequest as Record<string, unknown> | undefined;
      const reviewThreads = pullRequest?.reviewThreads as Record<string, unknown> | undefined;
      const nodes = reviewThreads?.nodes as unknown[] | undefined;

      if (!nodes || !Array.isArray(nodes)) {
        return [];
      }

      return nodes
        .filter((node): node is Record<string, unknown> => node != null && typeof node === 'object')
        .map((node) => this.mapToReviewThread(node));
    } catch (error) {
      logger.error('Failed to get review threads', error as Error);
      throw error;
    }
  }

  /**
   * Resolve a review thread using GraphQL
   */
  async resolveThread(threadId: string): Promise<boolean> {
    const mutation = `
      mutation ResolveThread($threadId: ID!) {
        resolveReviewThread(input: { threadId: $threadId }) {
          thread {
            id
            isResolved
          }
        }
      }
    `;

    const toolInput = {
      summary: `Resolve review thread ${threadId}`,
      method: 'POST',
      path: '/graphql',
      data: {
        query: mutation,
        variables: { threadId },
      },
    };

    logger.info('Resolving review thread', { threadId });

    try {
      const response = await callGitHubApi(toolInput);
      const parsed = parseYamlResponse<Record<string, unknown>>(response.tool_output);
      validateGraphQLResponse(parsed);

      const data = parsed.data as Record<string, unknown> | undefined;
      const resolveReviewThread = data?.resolveReviewThread as Record<string, unknown> | undefined;
      const thread = resolveReviewThread?.thread as Record<string, unknown> | undefined;

      return thread?.isResolved === true;
    } catch (error) {
      logger.error('Failed to resolve review thread', error as Error);
      throw error;
    }
  }

  /**
   * Unresolve a review thread using GraphQL
   */
  async unresolveThread(threadId: string): Promise<boolean> {
    const mutation = `
      mutation UnresolveThread($threadId: ID!) {
        unresolveReviewThread(input: { threadId: $threadId }) {
          thread {
            id
            isResolved
          }
        }
      }
    `;

    const toolInput = {
      summary: `Unresolve review thread ${threadId}`,
      method: 'POST',
      path: '/graphql',
      data: {
        query: mutation,
        variables: { threadId },
      },
    };

    logger.info('Unresolving review thread', { threadId });

    try {
      const response = await callGitHubApi(toolInput);
      const parsed = parseYamlResponse<Record<string, unknown>>(response.tool_output);
      validateGraphQLResponse(parsed);

      const data = parsed.data as Record<string, unknown> | undefined;
      const unresolveReviewThread = data?.unresolveReviewThread as Record<string, unknown> | undefined;
      const thread = unresolveReviewThread?.thread as Record<string, unknown> | undefined;

      return thread?.isResolved === false;
    } catch (error) {
      logger.error('Failed to unresolve review thread', error as Error);
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Private Helper Methods
  // --------------------------------------------------------------------------

  private mapToReviewComment(item: Record<string, unknown>): ReviewComment {
    const user = (item.user as Record<string, unknown>) || {};
    return {
      id: item.id as number,
      body: (item.body as string) || '',
      path: (item.path as string) || '',
      line: (item.line as number) ?? null,
      user: {
        login: (user.login as string) || 'unknown',
        avatar_url: user.avatar_url as string | undefined,
      },
      created_at: this.normalizeDate(item.created_at),
      updated_at: this.normalizeDate(item.updated_at),
      in_reply_to_id: item.in_reply_to_id as number | undefined,
      html_url: (item.html_url as string) || '',
    };
  }

  private mapToIssueComment(item: Record<string, unknown>): IssueComment {
    const user = (item.user as Record<string, unknown>) || {};
    return {
      id: item.id as number,
      body: (item.body as string) || '',
      user: {
        login: (user.login as string) || 'unknown',
        avatar_url: user.avatar_url as string | undefined,
      },
      created_at: this.normalizeDate(item.created_at),
      updated_at: this.normalizeDate(item.updated_at),
      html_url: (item.html_url as string) || '',
    };
  }

  private mapToReviewThread(node: Record<string, unknown>): ReviewThread {
    const comments = node.comments as Record<string, unknown> | undefined;
    const commentNodes = (comments?.nodes as unknown[]) || [];

    return {
      id: (node.id as string) || '',
      isResolved: (node.isResolved as boolean) || false,
      comments: commentNodes
        .filter((comment): comment is Record<string, unknown> => comment != null && typeof comment === 'object')
        .map((comment) => {
        const c = comment;
        const author = (c.author as Record<string, unknown>) || {};
        return {
          id: (c.id as string) || '',
          body: (c.body as string) || '',
          author: {
            login: (author.login as string) || 'unknown',
          },
          path: (c.path as string) || '',
          line: (c.line as number) ?? null,
          createdAt: this.normalizeDate(c.createdAt),
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

