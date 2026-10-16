/** Plain-text human discussion wire contract. Sequence is monotonic per workspace. */
interface DiscussionAuthor {
  principalId: string;
  login: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface DiscussionMessage {
  id: string;
  workspaceId: string;
  sequence: number;
  body: string;
  author: DiscussionAuthor;
  createdAt: string;
}

export interface DiscussionListParams {
  workspaceId: string;
  beforeSequence?: number;
  afterSequence?: number;
  limit?: number;
}
export interface DiscussionListResult {
  messages: DiscussionMessage[];
  hasMore: boolean;
}
export interface DiscussionSendParams {
  workspaceId: string;
  messageId: string;
  body: string;
}
export interface DiscussionSendResult {
  message: DiscussionMessage;
}
export interface DiscussionMessageEvent {
  workspaceId: string;
  message: DiscussionMessage;
}

export const DISCUSSION_PAGE_SIZE = 50;
export const DISCUSSION_MAX_BODY_BYTES = 16_384;
export type DiscussionError = 'unknown' | 'forbidden' | 'unsupported' | 'invalid';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const nullableString = (value: unknown): boolean => value === null || typeof value === 'string';

export function isDiscussionMessage(value: unknown): value is DiscussionMessage {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.workspaceId === 'string' &&
    value.workspaceId.length > 0 &&
    typeof value.sequence === 'number' &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence > 0 &&
    typeof value.body === 'string' &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    record(value.author) &&
    typeof value.author.principalId === 'string' &&
    value.author.principalId.length > 0 &&
    nullableString(value.author.login) &&
    nullableString(value.author.displayName) &&
    nullableString(value.author.avatarUrl)
  );
}

export function isDiscussionMessageEvent(value: unknown): value is DiscussionMessageEvent {
  return (
    record(value) &&
    typeof value.workspaceId === 'string' &&
    isDiscussionMessage(value.message) &&
    value.message.workspaceId === value.workspaceId
  );
}
