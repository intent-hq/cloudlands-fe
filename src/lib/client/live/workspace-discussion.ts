import { backendRequest } from './backend-transport';
import {
  DISCUSSION_PAGE_SIZE,
  isDiscussionMessage,
  type DiscussionError,
  type DiscussionListParams,
  type DiscussionListResult,
  type DiscussionSendParams,
  type DiscussionSendResult,
} from '$shared/types/workspace-discussion';

/** Only bounded codes reach presentation state, never raw daemon error strings. */
export function discussionError(error: unknown): DiscussionError {
  const e = error as { rpcCode?: number; code?: string; data?: { code?: string } } | null;
  if (e?.rpcCode === -32601 || e?.code === 'METHOD_NOT_FOUND') return 'unsupported';
  if (e?.rpcCode === -32003 || (e?.rpcCode === -32602 && e?.data?.code === 'not-found'))
    return 'forbidden';
  if (e?.rpcCode === -32602) return 'invalid';
  return 'unknown';
}

export const workspaceDiscussionClient = {
  async list(params: DiscussionListParams): Promise<DiscussionListResult> {
    const limit = Math.min(DISCUSSION_PAGE_SIZE, Math.max(1, params.limit ?? DISCUSSION_PAGE_SIZE));
    const result = await backendRequest<DiscussionListResult>('discussion.list', {
      ...params,
      limit,
    });
    if (
      !result ||
      typeof result.hasMore !== 'boolean' ||
      !Array.isArray(result.messages) ||
      result.messages.length > limit ||
      !result.messages.every(
        (message) =>
          isDiscussionMessage(message) &&
          message.workspaceId === params.workspaceId &&
          (params.beforeSequence === undefined || message.sequence < params.beforeSequence) &&
          (params.afterSequence === undefined || message.sequence > params.afterSequence),
      ) ||
      (result.hasMore && result.messages.length === 0)
    ) {
      throw new Error('Invalid discussion list response');
    }
    const messages = [...result.messages].sort((a, b) => a.sequence - b.sequence);
    if (
      new Set(messages.map((m) => m.id)).size !== messages.length ||
      new Set(messages.map((m) => m.sequence)).size !== messages.length
    )
      throw new Error('Duplicate discussion list rows');
    return { messages, hasMore: result.hasMore };
  },
  async send(params: DiscussionSendParams): Promise<DiscussionSendResult> {
    const result = await backendRequest<DiscussionSendResult>('discussion.send', params);
    if (
      !isDiscussionMessage(result?.message) ||
      result.message.workspaceId !== params.workspaceId ||
      result.message.body !== params.body
    )
      throw new Error('Invalid discussion send response');
    return result;
  },
};
