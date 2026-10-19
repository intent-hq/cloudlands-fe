/** Plain-text discussion wire contract. Sequence is monotonic per conversation. */
export interface DiscussionAuthor {
  principalId: string;
  agentId?: undefined;
  login: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

interface DiscussionAgentAuthor {
  principalId: null;
  agentId: string;
  login: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}
type DiscussionMessageAuthor = DiscussionAuthor | DiscussionAgentAuthor;

export interface DiscussionMessage {
  id: string;
  workspaceId: string;
  /** Absent on older daemons, which only have the workspace-wide conversation. */
  conversationId?: string;
  sequence: number;
  body: string;
  author: DiscussionMessageAuthor;
  createdAt: string;
  /** Present together on daemons with discussionMessageActions:1. */
  replyToMessageId?: string | null;
  replyTo?: { id: string; author: DiscussionMessageAuthor; body: string } | null;
  reactions?: DiscussionReaction[];
  reactionVersion?: number;
  /** Present on daemons with discussionAgentMessaging:1; never inferred from body text. */
  recipientAgentIds?: string[];
}

export interface DiscussionListParams {
  workspaceId: string;
  conversationId?: string;
  beforeSequence?: number;
  afterSequence?: number;
  limit?: number;
}
export interface DiscussionListResult {
  messages: DiscussionMessage[];
  hasMore: boolean;
  conversation?: DiscussionConversation;
}
export interface DiscussionSendParams {
  workspaceId: string;
  conversationId?: string;
  recipientPrincipalIds?: string[];
  recipientAgentIds?: string[];
  messageId: string;
  body: string;
  replyToMessageId?: string;
}
export interface DiscussionSendResult {
  message: DiscussionMessage;
  conversation?: DiscussionConversation;
}
export interface DiscussionMessageEvent {
  workspaceId: string;
  conversationId?: string;
  conversation?: DiscussionConversation;
  message: DiscussionMessage;
}

export interface DiscussionConversation {
  id: string;
  workspaceId: string;
  kind: 'workspace' | 'direct' | 'group';
  participants: DiscussionAuthor[];
  createdAt: string;
}
export interface DiscussionConversationsParams {
  workspaceId: string;
  beforeId?: string;
  limit?: number;
}
export interface DiscussionConversationsResult {
  conversations: DiscussionConversation[];
  hasMore: boolean;
}
export interface DiscussionRecipientsParams {
  workspaceId: string;
  query?: string;
  afterPrincipalId?: string;
  limit?: number;
}
export interface DiscussionRecipientsResult {
  members: DiscussionAuthor[];
  hasMore: boolean;
}

export const DEFAULT_DISCUSSION_ID = 'default';
/** Local composer identity; never sent as a daemon conversation ID. */
export const NEW_DISCUSSION_ID = 'new';
export const DISCUSSION_MAX_RECIPIENTS = 31;

export const DISCUSSION_PAGE_SIZE = 50;
export const DISCUSSION_MAX_BODY_BYTES = 16_384;
export type DiscussionError = 'unknown' | 'forbidden' | 'unsupported' | 'invalid';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const nullableString = (value: unknown): boolean => value === null || typeof value === 'string';

export function isDiscussionAuthor(value: unknown): value is DiscussionAuthor {
  return (
    record(value) &&
    value.agentId === undefined &&
    typeof value.principalId === 'string' &&
    value.principalId.length > 0 &&
    nullableString(value.login) &&
    nullableString(value.displayName) &&
    nullableString(value.avatarUrl)
  );
}

function isDiscussionMessageAuthor(value: unknown): value is DiscussionMessageAuthor {
  return (
    isDiscussionAuthor(value) ||
    (record(value) &&
      value.principalId === null &&
      typeof value.agentId === 'string' &&
      value.agentId.length > 0 &&
      nullableString(value.login) &&
      nullableString(value.displayName) &&
      nullableString(value.avatarUrl))
  );
}

export function hasDiscussionAgentMessaging(value: unknown): boolean {
  return (
    record(value) &&
    Array.isArray(value.recipientAgentIds) &&
    value.recipientAgentIds.length <= DISCUSSION_MAX_RECIPIENTS &&
    value.recipientAgentIds.every((id) => typeof id === 'string' && id.length > 0) &&
    new Set(value.recipientAgentIds).size === value.recipientAgentIds.length
  );
}

export function isDiscussionConversation(value: unknown): value is DiscussionConversation {
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    !value.id ||
    value.id === NEW_DISCUSSION_ID ||
    typeof value.workspaceId !== 'string' ||
    !value.workspaceId ||
    !Array.isArray(value.participants) ||
    !value.participants.every(isDiscussionAuthor) ||
    new Set(value.participants.map((p) => p.principalId)).size !== value.participants.length ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt))
  )
    return false;
  return value.id === DEFAULT_DISCUSSION_ID
    ? value.kind === 'workspace' && value.participants.length === 0
    : (value.kind === 'direct' && value.participants.length === 2) ||
        (value.kind === 'group' &&
          value.participants.length >= 3 &&
          value.participants.length <= 32);
}

export function discussionKey(workspaceId: string, conversationId = DEFAULT_DISCUSSION_ID): string {
  return JSON.stringify([workspaceId, conversationId]);
}

export function isDiscussionMessage(value: unknown): value is DiscussionMessage {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.workspaceId === 'string' &&
    value.workspaceId.length > 0 &&
    (value.conversationId === undefined ||
      (typeof value.conversationId === 'string' &&
        value.conversationId.length > 0 &&
        value.conversationId !== NEW_DISCUSSION_ID)) &&
    typeof value.sequence === 'number' &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence > 0 &&
    typeof value.body === 'string' &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    isDiscussionMessageAuthor(value.author) &&
    (value.recipientAgentIds === undefined
      ? value.author.agentId === undefined
      : hasDiscussionAgentMessaging(value)) &&
    (['replyToMessageId', 'replyTo', 'reactions', 'reactionVersion'].every(
      (key) => value[key] === undefined,
    ) ||
      hasDiscussionMessageActions(value))
  );
}

export function isDiscussionMessageEvent(value: unknown): value is DiscussionMessageEvent {
  return (
    record(value) &&
    typeof value.workspaceId === 'string' &&
    isDiscussionMessage(value.message) &&
    value.message.workspaceId === value.workspaceId &&
    (value.conversationId ?? DEFAULT_DISCUSSION_ID) ===
      (value.message.conversationId ?? DEFAULT_DISCUSSION_ID) &&
    (value.conversation === undefined
      ? (value.conversationId ?? DEFAULT_DISCUSSION_ID) === DEFAULT_DISCUSSION_ID
      : isDiscussionConversation(value.conversation) &&
        value.conversation.workspaceId === value.workspaceId &&
        value.conversation.id === (value.conversationId ?? DEFAULT_DISCUSSION_ID))
  );
}

export type DiscussionReactionValue = '👍' | '🙂';
interface DiscussionReaction {
  reaction: DiscussionReactionValue;
  count: number;
  reacted: boolean;
}
export interface DiscussionReactParams {
  workspaceId: string;
  conversationId?: string;
  messageId: string;
  reaction: DiscussionReactionValue;
  active: boolean;
}
export interface DiscussionReactionResult {
  messageId: string;
  reactions: DiscussionReaction[];
  reactionVersion: number;
}
interface DiscussionReactionEvent extends DiscussionReactionResult {
  workspaceId: string;
  conversationId: string;
}
export function isDiscussionReactionResult(value: unknown): value is DiscussionReactionResult {
  return (
    record(value) &&
    typeof value.messageId === 'string' &&
    value.messageId.length > 0 &&
    typeof value.reactionVersion === 'number' &&
    Number.isSafeInteger(value.reactionVersion) &&
    value.reactionVersion >= 0 &&
    Array.isArray(value.reactions) &&
    value.reactions.length <= 2 &&
    new Set(value.reactions.map((r) => (record(r) ? r.reaction : undefined))).size ===
      value.reactions.length &&
    value.reactions.every(
      (r) =>
        record(r) &&
        (r.reaction === '👍' || r.reaction === '🙂') &&
        typeof r.count === 'number' &&
        Number.isSafeInteger(r.count) &&
        r.count > 0 &&
        typeof r.reacted === 'boolean',
    )
  );
}
export function hasDiscussionMessageActions(value: unknown): boolean {
  if (!record(value) || !isDiscussionReactionResult({ ...value, messageId: value.id }))
    return false;
  return value.replyToMessageId === null
    ? value.replyTo === null
    : typeof value.replyToMessageId === 'string' &&
        value.replyToMessageId.length > 0 &&
        value.replyToMessageId !== value.id &&
        record(value.replyTo) &&
        value.replyTo.id === value.replyToMessageId &&
        typeof value.replyTo.body === 'string' &&
        new TextEncoder().encode(value.replyTo.body).length <= DISCUSSION_MAX_BODY_BYTES &&
        isDiscussionMessageAuthor(value.replyTo.author);
}
export function isDiscussionReactionEvent(value: unknown): value is DiscussionReactionEvent {
  return (
    record(value) &&
    isDiscussionReactionResult(value) &&
    typeof value.workspaceId === 'string' &&
    value.workspaceId.length > 0 &&
    typeof value.conversationId === 'string' &&
    value.conversationId.length > 0 &&
    value.conversationId !== NEW_DISCUSSION_ID
  );
}
