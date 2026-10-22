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
/** Display-only snapshots may have unknown identity after importing legacy reactions. */
export type DiscussionReactor =
  DiscussionMessageAuthor | (Omit<DiscussionAuthor, 'principalId'> & { principalId: null });

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
  /** Versioned request progress; never derived from an agent-wide status. */
  agentActivity?: DiscussionAgentActivity[];
  /** Immutable selected spans; offsets are UTF-16 code units, end exclusive. */
  agentMentions?: DiscussionAgentMention[];
  principalMentions?: DiscussionPrincipalMention[];
}

export interface DiscussionPrincipalMention {
  principalId: string;
  name: string;
  start: number;
  end: number;
}

export function hasDiscussionPrincipalMentions(value: unknown): boolean {
  if (
    !record(value) ||
    typeof value.body !== 'string' ||
    !Array.isArray(value.principalMentions) ||
    value.principalMentions.length > 100 ||
    (value.agentMentions !== undefined && !hasDiscussionAgentMentions(value))
  )
    return false;
  let end = 0;
  for (const mention of value.principalMentions) {
    if (
      !record(mention) ||
      typeof mention.principalId !== 'string' ||
      !mention.principalId.trim() ||
      typeof mention.name !== 'string' ||
      !mention.name.trim() ||
      new TextEncoder().encode(mention.name).length > 256 ||
      !Number.isSafeInteger(mention.start) ||
      !Number.isSafeInteger(mention.end) ||
      (mention.start as number) < end ||
      (mention.end as number) <= (mention.start as number) ||
      (mention.end as number) > value.body.length ||
      value.body.slice(mention.start as number, mention.end as number) !== `@${mention.name}` ||
      (value.agentMentions as DiscussionAgentMention[] | undefined)?.some(
        (agent) => agent.start < (mention.end as number) && agent.end > (mention.start as number),
      )
    )
      return false;
    end = mention.end as number;
  }
  return true;
}

export interface DiscussionAgentMention {
  agentId: string;
  name: string;
  start: number;
  end: number;
}
export interface DiscussionAgentActivity {
  agentId: string;
  attempt: number;
  version: number;
  state: 'queued' | 'working' | 'completed' | 'failed' | 'stopped';
  updatedAt: string;
  error: string | null;
}
export interface DiscussionAgentControlParams {
  workspaceId: string;
  conversationId?: string;
  messageId: string;
  agentId: string;
  attempt: number;
}
export interface DiscussionAgentActivityEvent {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  activity: DiscussionAgentActivity;
}
export function discussionAgentControlKey(messageId: string, agentId: string): string {
  return JSON.stringify([messageId, agentId]);
}
export function isDiscussionAgentActivity(value: unknown): value is DiscussionAgentActivity {
  return (
    record(value) &&
    typeof value.agentId === 'string' &&
    value.agentId.length > 0 &&
    Number.isSafeInteger(value.attempt) &&
    (value.attempt as number) > 0 &&
    Number.isSafeInteger(value.version) &&
    (value.version as number) > 0 &&
    ['queued', 'working', 'completed', 'failed', 'stopped'].includes(value.state as string) &&
    typeof value.updatedAt === 'string' &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    nullableString(value.error)
  );
}
export function hasDiscussionAgentActivity(value: unknown): boolean {
  return (
    record(value) &&
    hasDiscussionAgentMessaging(value) &&
    Array.isArray(value.agentActivity) &&
    value.agentActivity.length <= DISCUSSION_MAX_RECIPIENTS &&
    value.agentActivity.every(
      (activity) =>
        isDiscussionAgentActivity(activity) &&
        (value.recipientAgentIds as string[]).includes(activity.agentId),
    ) &&
    new Set(value.agentActivity.map((activity) => activity.agentId)).size ===
      value.agentActivity.length
  );
}
export function hasDiscussionAgentMentions(value: unknown): boolean {
  if (
    !record(value) ||
    !hasDiscussionAgentMessaging(value) ||
    typeof value.body !== 'string' ||
    !Array.isArray(value.agentMentions) ||
    value.agentMentions.length > 100
  )
    return false;
  let end = 0;
  for (const mention of value.agentMentions) {
    if (
      !record(mention) ||
      typeof mention.agentId !== 'string' ||
      !(value.recipientAgentIds as string[]).includes(mention.agentId) ||
      typeof mention.name !== 'string' ||
      !mention.name.trim() ||
      new TextEncoder().encode(mention.name).length > 256 ||
      !Number.isSafeInteger(mention.start) ||
      !Number.isSafeInteger(mention.end) ||
      (mention.start as number) < end ||
      (mention.end as number) <= (mention.start as number) ||
      (mention.end as number) > value.body.length ||
      value.body.slice(mention.start as number, mention.end as number) !== `@${mention.name}`
    )
      return false;
    end = mention.end as number;
  }
  return true;
}
export function isDiscussionAgentActivityEvent(
  value: unknown,
): value is DiscussionAgentActivityEvent {
  return (
    record(value) &&
    typeof value.workspaceId === 'string' &&
    !!value.workspaceId &&
    value.conversationId === DEFAULT_DISCUSSION_ID &&
    typeof value.messageId === 'string' &&
    !!value.messageId &&
    isDiscussionAgentActivity(value.activity)
  );
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
  agentMentions?: DiscussionAgentMention[];
  principalMentions?: DiscussionPrincipalMention[];
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
    (value.agentActivity === undefined || hasDiscussionAgentActivity(value)) &&
    (value.agentMentions === undefined || hasDiscussionAgentMentions(value)) &&
    (value.principalMentions === undefined || hasDiscussionPrincipalMentions(value)) &&
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

export type DiscussionReactionValue = '👍' | '👎' | '👀' | '✅' | '🙈' | '🙂';
const DISCUSSION_MAX_REACTORS = 20;
export function isDiscussionReactionValue(value: unknown): value is DiscussionReactionValue {
  return ['👍', '👎', '👀', '✅', '🙈', '🙂'].includes(value as string);
}
interface DiscussionReaction {
  reaction: DiscussionReactionValue;
  count: number;
  reacted: boolean;
  /** Bounded identity snapshots, required with discussionReactions:1. */
  reactors?: DiscussionReactor[];
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
function isDiscussionReactor(value: unknown): value is DiscussionReactor {
  return (
    isDiscussionMessageAuthor(value) ||
    (record(value) &&
      value.principalId === null &&
      value.agentId === undefined &&
      nullableString(value.login) &&
      nullableString(value.displayName) &&
      nullableString(value.avatarUrl))
  );
}
export function isDiscussionReactionResult(
  value: unknown,
  expanded = false,
): value is DiscussionReactionResult {
  return (
    record(value) &&
    typeof value.messageId === 'string' &&
    value.messageId.length > 0 &&
    typeof value.reactionVersion === 'number' &&
    Number.isSafeInteger(value.reactionVersion) &&
    value.reactionVersion >= 0 &&
    Array.isArray(value.reactions) &&
    value.reactions.length <= 6 &&
    new Set(value.reactions.map((r) => (record(r) ? r.reaction : undefined))).size ===
      value.reactions.length &&
    value.reactions.every(
      (r) =>
        record(r) &&
        isDiscussionReactionValue(r.reaction) &&
        typeof r.count === 'number' &&
        Number.isSafeInteger(r.count) &&
        r.count > 0 &&
        typeof r.reacted === 'boolean' &&
        (r.reactors === undefined
          ? !expanded
          : Array.isArray(r.reactors) &&
            r.reactors.length <= DISCUSSION_MAX_REACTORS &&
            r.reactors.length <= r.count &&
            r.reactors.every(isDiscussionReactor)),
    )
  );
}
export function hasDiscussionReactions(value: unknown): boolean {
  return record(value) && isDiscussionReactionResult({ ...value, messageId: value.id }, true);
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
