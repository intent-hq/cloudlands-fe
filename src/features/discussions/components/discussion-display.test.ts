import { describe, expect, it } from 'vitest';
import type {
  DiscussionAgentActivity,
  DiscussionMessage,
} from '$shared/types/workspace-discussion';
import { discussionActivityAnswered } from './discussion-display';

const person = { principalId: 'me', login: 'sam', displayName: null, avatarUrl: null };
const agent = (agentId: string) => ({
  principalId: null,
  agentId,
  login: null,
  displayName: 'Guide',
  avatarUrl: null,
});
const at = (minute: number) => `2026-11-03T16:${String(minute).padStart(2, '0')}:00Z`;
const msg = (
  sequence: number,
  extra: Partial<DiscussionMessage> & { author?: unknown } = {},
): DiscussionMessage =>
  ({
    id: `m${sequence}`,
    workspaceId: 'ws',
    sequence,
    body: 'hi',
    author: person,
    createdAt: at(sequence),
    ...extra,
  }) as DiscussionMessage;
const activity = (
  state: DiscussionAgentActivity['state'],
  minute: number,
  agentId = 'agent-a',
): DiscussionAgentActivity => ({
  agentId,
  attempt: 1,
  version: 2,
  state,
  updatedAt: at(minute),
  error: null,
});

describe('discussion agent activity rows', () => {
  it('treats an in-progress request as answered once the agent posts a linked reply', () => {
    const request = msg(1, { recipientAgentIds: ['agent-a'] });
    const reply = msg(2, {
      author: agent('agent-a'),
      replyToMessageId: request.id,
      replyTo: { id: request.id, author: person, body: 'hi' },
    });
    const answered = discussionActivityAnswered([request, reply]);
    expect(answered(request, activity('working', 1))).toBe(true);
    expect(answered(request, activity('queued', 1))).toBe(true);
    expect(answered(request, activity('working', 1, 'agent-b'))).toBe(false);
  });
  it('keeps failed and stopped rows visible after a reply', () => {
    const request = msg(1);
    const reply = msg(2, { author: agent('agent-a'), replyToMessageId: request.id });
    const answered = discussionActivityAnswered([request, reply]);
    expect(answered(request, activity('failed', 1))).toBe(false);
    expect(answered(request, activity('stopped', 1))).toBe(false);
  });
  it('counts an unlinked agent message only for the request it is working on', () => {
    const first = msg(1);
    const second = msg(3);
    const unlinked = msg(4, { author: agent('agent-a') });
    const answered = discussionActivityAnswered([first, second, unlinked]);
    expect(answered(second, activity('working', 3))).toBe(true);
    expect(answered(second, activity('queued', 3))).toBe(false);
    expect(answered(second, activity('working', 5))).toBe(false);
    expect(answered(msg(5), activity('working', 5))).toBe(false);
  });
  it('keeps the row while the agent has not replied', () => {
    const request = msg(1);
    const other = msg(2, { author: agent('agent-b'), replyToMessageId: request.id });
    expect(discussionActivityAnswered([request, other])(request, activity('working', 1))).toBe(
      false,
    );
  });
});
