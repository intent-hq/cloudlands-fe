import { describe, expect, it } from 'vitest';
import type { DiscussionAuthor } from '$shared/types/workspace-discussion';
import { discussionMentionOptions, discussionMentionQuery } from './discussion-mention-query';

describe('discussion mention query', () => {
  it('tracks the token before the caret without consuming surrounding text', () => {
    expect(discussionMentionQuery('@', 1)).toEqual({ start: 0, end: 1, query: '' });
    expect(discussionMentionQuery('Hello @Sa please review', 9)).toEqual({
      start: 6,
      end: 9,
      query: 'Sa',
    });
    expect(discussionMentionQuery('Hello\n@Sam', 10)).toEqual({ start: 6, end: 10, query: 'Sam' });
  });

  it('does not open for email, selected text, a finished token, or a second at sign', () => {
    expect(discussionMentionQuery('sam@example.com', 15)).toBeNull();
    expect(discussionMentionQuery('@Sam', 1, 4)).toBeNull();
    expect(discussionMentionQuery('@Sam ', 5)).toBeNull();
    expect(discussionMentionQuery('@@Sam', 5)).toBeNull();
  });
});

describe('discussion mention options', () => {
  const user: DiscussionAuthor = {
    principalId: 'person-sam',
    displayName: 'Sam Example',
    login: 'sammy',
    avatarUrl: null,
  };
  const agent = { id: 'reviewer', name: 'Sam Reviewer' };

  it('keeps agents before people with separate identities even for matching names', () => {
    const options = discussionMentionOptions(
      [agent],
      [{ ...user, displayName: agent.name }],
      'sAm',
    );
    expect(options.map((option) => [option.kind, option.key, option.label])).toEqual([
      ['agent', 'agent:reviewer', 'Sam Reviewer'],
      ['user', 'user:person-sam', 'Sam Reviewer'],
    ]);
  });

  it('matches people by display name or login and falls back to login for insertion', () => {
    expect(discussionMentionOptions([], [user], 'example')).toHaveLength(1);
    expect(discussionMentionOptions([], [{ ...user, displayName: null }], 'sammy')[0]?.label).toBe(
      'sammy',
    );
    expect(discussionMentionOptions([agent], [user], 'missing')).toEqual([]);
  });

  it('does not reintroduce agent identities through the supplied people list', () => {
    const malformedUser = { ...user, agentId: agent.id } as unknown as DiscussionAuthor;
    expect(discussionMentionOptions([], [malformedUser], '')).toEqual([]);
    expect(discussionMentionOptions([], [{ ...user, displayName: null, login: null }], '')).toEqual(
      [],
    );
  });
});
