/** Plain-text human discussion wire contract. Sequence is monotonic per conversation. */
export interface DiscussionAuthor {
  principalId: string;
  login: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface DiscussionMessage {
  id: string;
  workspaceId: string;
  /** Absent on older daemons, which only have the workspace-wide conversation. */
  conversationId?: string;
  sequence: number;
  body: string;
  author: DiscussionAuthor;
  createdAt: string;
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
  messageId: string;
  body: string;
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
    typeof value.principalId === 'string' &&
    value.principalId.length > 0 &&
    nullableString(value.login) &&
    nullableString(value.displayName) &&
    nullableString(value.avatarUrl)
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
    isDiscussionAuthor(value.author)
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
