import { backendRequest } from './backend-transport';
import {
  DEFAULT_DISCUSSION_ID,
  NEW_DISCUSSION_ID,
  DISCUSSION_PAGE_SIZE,
  isDiscussionMessage,
  isDiscussionConversation,
  isDiscussionAuthor,
  hasDiscussionMessageActions,
  hasDiscussionReactions,
  isDiscussionReactionValue,
  hasDiscussionAgentMessaging,
  hasDiscussionAgentActivity,
  hasDiscussionAgentMentions,
  hasDiscussionPrincipalMentions,
  isDiscussionAgentActivity,
  type DiscussionAgentActivity,
  type DiscussionAgentControlParams,
  isDiscussionReactionResult,
  type DiscussionReactParams,
  type DiscussionReactionResult,
  type DiscussionError,
  type DiscussionListParams,
  type DiscussionListResult,
  type DiscussionSendParams,
  type DiscussionSendResult,
  type DiscussionConversationsParams,
  type DiscussionConversationsResult,
  type DiscussionRecipientsParams,
  type DiscussionRecipientsResult,
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
function requireConversations(supported: boolean): void {
  if (!supported)
    throw Object.assign(new Error('Discussion conversations unavailable'), {
      code: 'METHOD_NOT_FOUND',
    });
}
const pageLimit = (limit?: number) =>
  Math.min(DISCUSSION_PAGE_SIZE, Math.max(1, limit ?? DISCUSSION_PAGE_SIZE));
export const workspaceDiscussionClient = {
  async supportsPrincipalMentions(): Promise<boolean> {
    try {
      const result = await backendRequest<{ discussionPrincipalMentions?: unknown }>(
        'system.capabilities',
        {},
      );
      return result?.discussionPrincipalMentions === 1;
    } catch {
      return false;
    }
  },
  async supportsAgentActivity(): Promise<boolean> {
    try {
      const result = await backendRequest<{ discussionAgentActivity?: unknown }>(
        'system.capabilities',
        {},
      );
      return result?.discussionAgentActivity === 1;
    } catch {
      return false;
    }
  },
  async controlAgent(
    operation: 'stop' | 'retry',
    params: DiscussionAgentControlParams,
    supported = false,
  ): Promise<{ activity: DiscussionAgentActivity }> {
    requireConversations(supported);
    if (
      (params.conversationId ?? DEFAULT_DISCUSSION_ID) !== DEFAULT_DISCUSSION_ID ||
      !params.messageId ||
      !params.agentId ||
      !Number.isSafeInteger(params.attempt) ||
      params.attempt < 1
    )
      throw new Error('Invalid discussion agent control');
    const result = await backendRequest<{ activity: DiscussionAgentActivity }>(
      operation === 'stop' ? 'discussion.stopAgent' : 'discussion.retryAgent',
      params,
    );
    if (
      !isDiscussionAgentActivity(result?.activity) ||
      result.activity.agentId !== params.agentId ||
      result.activity.attempt < params.attempt
    )
      throw new Error('Invalid discussion agent activity response');
    return result;
  },
  async supportsAgentMessaging(): Promise<boolean> {
    try {
      const result = await backendRequest<{ discussionAgentMessaging?: unknown }>(
        'system.capabilities',
        {},
      );
      return result?.discussionAgentMessaging === 1;
    } catch {
      return false;
    }
  },
  async supportsMessageActions(): Promise<boolean> {
    try {
      const result = await backendRequest<{ discussionMessageActions?: unknown }>(
        'system.capabilities',
        {},
      );
      return result?.discussionMessageActions === 1;
    } catch {
      return false;
    }
  },
  async supportsReactions(): Promise<boolean> {
    try {
      const result = await backendRequest<{ discussionReactions?: unknown }>(
        'system.capabilities',
        {},
      );
      return result?.discussionReactions === 1;
    } catch {
      return false;
    }
  },
  async react(
    params: DiscussionReactParams,
    supported = false,
    expanded = false,
  ): Promise<DiscussionReactionResult> {
    requireConversations(supported);
    if (!isDiscussionReactionValue(params.reaction)) throw new Error('Invalid discussion reaction');
    if (params.reaction !== '👍' && params.reaction !== '🙂') requireConversations(expanded);
    if (expanded && params.reaction === '🙂' && params.active)
      throw new Error('Legacy discussion reaction is removal-only');
    const result = await backendRequest<DiscussionReactionResult>('discussion.react', params);
    if (!isDiscussionReactionResult(result, expanded) || result.messageId !== params.messageId)
      throw new Error('Invalid discussion reaction response');
    return result;
  },
  async supportsConversations(): Promise<boolean> {
    try {
      const result = await backendRequest<{ discussionConversations?: unknown }>(
        'system.capabilities',
        {},
      );
      return result?.discussionConversations === 1;
    } catch {
      return false;
    }
  },
  async list(
    params: DiscussionListParams,
    supported = false,
    actionsSupported = false,
    agentsSupported = false,
    activitySupported = false,
    reactionsSupported = false,
    principalMentionsSupported = false,
  ): Promise<DiscussionListResult> {
    const id = params.conversationId ?? DEFAULT_DISCUSSION_ID;
    if (id !== DEFAULT_DISCUSSION_ID) requireConversations(supported);
    if (id === NEW_DISCUSSION_ID) throw new Error('Local discussion has no history');
    const limit = pageLimit(params.limit);
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
          (!actionsSupported || hasDiscussionMessageActions(message)) &&
          (!reactionsSupported || hasDiscussionReactions(message)) &&
          (!agentsSupported || hasDiscussionAgentMessaging(message)) &&
          (!principalMentionsSupported || hasDiscussionPrincipalMentions(message)) &&
          (!activitySupported ||
            (hasDiscussionAgentActivity(message) && hasDiscussionAgentMentions(message))) &&
          message.workspaceId === params.workspaceId &&
          (message.conversationId ?? DEFAULT_DISCUSSION_ID) === id &&
          (params.beforeSequence === undefined || message.sequence < params.beforeSequence) &&
          (params.afterSequence === undefined || message.sequence > params.afterSequence),
      ) ||
      (result.hasMore && result.messages.length === 0) ||
      (result.conversation === undefined
        ? id !== DEFAULT_DISCUSSION_ID
        : !isDiscussionConversation(result.conversation) ||
          result.conversation.workspaceId !== params.workspaceId ||
          result.conversation.id !== id)
    )
      throw new Error('Invalid discussion list response');
    const messages = [...result.messages].sort((a, b) => a.sequence - b.sequence);
    if (
      new Set(messages.map((m) => m.id)).size !== messages.length ||
      new Set(messages.map((m) => m.sequence)).size !== messages.length
    )
      throw new Error('Duplicate discussion list rows');
    return { ...result, messages };
  },
  async send(
    params: DiscussionSendParams,
    supported = false,
    actionsSupported = false,
    agentsSupported = false,
    activitySupported = false,
    reactionsSupported = false,
    principalMentionsSupported = false,
  ): Promise<DiscussionSendResult> {
    if (params.principalMentions !== undefined) {
      requireConversations(principalMentionsSupported);
      if (
        !hasDiscussionPrincipalMentions({
          ...params,
          recipientAgentIds: params.recipientAgentIds ?? [],
        })
      )
        throw new Error('Invalid discussion principal mentions');
    }
    if (params.agentMentions !== undefined) {
      requireConversations(activitySupported);
      if (
        !hasDiscussionAgentMentions({
          ...params,
          recipientAgentIds: params.recipientAgentIds ?? [],
        })
      )
        throw new Error('Invalid discussion agent mentions');
    }
    if (params.recipientAgentIds !== undefined) {
      requireConversations(agentsSupported);
      if (
        (params.conversationId ?? DEFAULT_DISCUSSION_ID) !== DEFAULT_DISCUSSION_ID ||
        params.recipientPrincipalIds !== undefined ||
        !hasDiscussionAgentMessaging(params)
      )
        throw new Error('Invalid discussion agent target');
    }
    if (params.replyToMessageId !== undefined) requireConversations(actionsSupported);
    const id = params.conversationId ?? DEFAULT_DISCUSSION_ID;
    if (id !== DEFAULT_DISCUSSION_ID || params.recipientPrincipalIds !== undefined)
      requireConversations(supported);
    if (id === NEW_DISCUSSION_ID || (params.recipientPrincipalIds && params.conversationId))
      throw new Error('Invalid discussion target');
    const result = await backendRequest<DiscussionSendResult>('discussion.send', params);
    const resultId = result?.message?.conversationId ?? DEFAULT_DISCUSSION_ID;
    if (
      !isDiscussionMessage(result?.message) ||
      (actionsSupported && !hasDiscussionMessageActions(result?.message)) ||
      (reactionsSupported && !hasDiscussionReactions(result?.message)) ||
      (agentsSupported && !hasDiscussionAgentMessaging(result?.message)) ||
      (principalMentionsSupported && !hasDiscussionPrincipalMentions(result?.message)) ||
      (principalMentionsSupported &&
        JSON.stringify(
          (result?.message?.principalMentions ?? []).map((m) => [
            m.principalId,
            m.name,
            m.start,
            m.end,
          ]),
        ) !==
          JSON.stringify(
            (params.principalMentions ?? []).map((m) => [m.principalId, m.name, m.start, m.end]),
          )) ||
      (activitySupported &&
        (!hasDiscussionAgentActivity(result?.message) ||
          !hasDiscussionAgentMentions(result?.message))) ||
      (activitySupported &&
        JSON.stringify(
          (result?.message?.agentMentions ?? []).map((m) => [m.agentId, m.name, m.start, m.end]),
        ) !==
          JSON.stringify(
            (params.agentMentions ?? []).map((m) => [m.agentId, m.name, m.start, m.end]),
          )) ||
      result.message.author.agentId !== undefined ||
      JSON.stringify([...(result.message.recipientAgentIds ?? [])].sort()) !==
        JSON.stringify([...(params.recipientAgentIds ?? [])].sort()) ||
      (result?.message?.replyToMessageId ?? null) !== (params.replyToMessageId ?? null) ||
      result.message.workspaceId !== params.workspaceId ||
      result.message.body !== params.body ||
      (params.recipientPrincipalIds ? resultId === DEFAULT_DISCUSSION_ID : resultId !== id) ||
      (result.conversation === undefined
        ? resultId !== DEFAULT_DISCUSSION_ID
        : !isDiscussionConversation(result.conversation) ||
          result.conversation.workspaceId !== params.workspaceId ||
          result.conversation.id !== resultId)
    )
      throw new Error('Invalid discussion send response');
    if (params.recipientPrincipalIds && result.conversation) {
      const expected = new Set([
        ...params.recipientPrincipalIds,
        result.message.author.principalId,
      ]);
      if (
        result.conversation.participants.length !== expected.size ||
        result.conversation.participants.some((p) => !expected.has(p.principalId))
      )
        throw new Error('Invalid discussion participants');
    }
    return result;
  },
  async conversations(
    params: DiscussionConversationsParams,
    supported = false,
  ): Promise<DiscussionConversationsResult> {
    requireConversations(supported);
    const limit = pageLimit(params.limit);
    const result = await backendRequest<DiscussionConversationsResult>('discussion.conversations', {
      ...params,
      limit,
    });
    if (
      !result ||
      typeof result.hasMore !== 'boolean' ||
      !Array.isArray(result.conversations) ||
      result.conversations.length > limit ||
      (result.hasMore && !result.conversations.length) ||
      !result.conversations.every(
        (c, i, rows) =>
          isDiscussionConversation(c) &&
          c.workspaceId === params.workspaceId &&
          (c.id === DEFAULT_DISCUSSION_ID
            ? !params.beforeId && i === 0
            : (!params.beforeId ||
                params.beforeId === DEFAULT_DISCUSSION_ID ||
                c.id < params.beforeId) &&
              (i === 0 || rows[i - 1].id === DEFAULT_DISCUSSION_ID || c.id < rows[i - 1].id)),
      )
    )
      throw new Error('Invalid discussion directory response');
    return result;
  },
  async recipients(
    params: DiscussionRecipientsParams,
    supported = false,
  ): Promise<DiscussionRecipientsResult> {
    requireConversations(supported);
    const limit = pageLimit(params.limit);
    const result = await backendRequest<DiscussionRecipientsResult>('discussion.recipients', {
      ...params,
      limit,
    });
    if (
      !result ||
      typeof result.hasMore !== 'boolean' ||
      !Array.isArray(result.members) ||
      result.members.length > limit ||
      (result.hasMore && !result.members.length) ||
      !result.members.every(
        (m, i, rows) =>
          isDiscussionAuthor(m) &&
          (!params.afterPrincipalId || m.principalId > params.afterPrincipalId) &&
          (i === 0 || m.principalId > rows[i - 1].principalId),
      )
    )
      throw new Error('Invalid discussion recipients response');
    return result;
  },
};
