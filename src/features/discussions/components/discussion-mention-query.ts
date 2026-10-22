import type { DiscussionAuthor } from '$shared/types/workspace-discussion';

export interface DiscussionMentionAgent {
  id: string;
  name: string;
  status?: 'working' | 'idle';
}

export type DiscussionMentionOption =
  | { kind: 'agent'; key: string; label: string; agent: DiscussionMentionAgent }
  | { kind: 'user'; key: string; label: string; user: DiscussionAuthor };

/** Only the token at a collapsed caret is eligible; email addresses are not mentions. */
export function discussionMentionQuery(value: string, start: number, end = start) {
  if (start !== end) return null;
  const match = /(?:^|\s)@([^\s@]*)$/.exec(value.slice(0, start));
  return match ? { start: start - match[1].length - 1, end: start, query: match[1] } : null;
}

export function discussionMentionOptions(
  agents: readonly DiscussionMentionAgent[],
  users: readonly DiscussionAuthor[],
  query: string,
): DiscussionMentionOption[] {
  const search = query.toLocaleLowerCase();
  return [
    ...agents
      .filter((agent) => agent.name.toLocaleLowerCase().includes(search))
      .map((agent) => ({
        kind: 'agent' as const,
        key: `agent:${agent.id}`,
        label: agent.name,
        agent,
      })),
    ...users
      .filter((user) => !user.agentId && !!(user.displayName || user.login))
      .filter((user) =>
        [user.displayName, user.login].some((label) => label?.toLocaleLowerCase().includes(search)),
      )
      .map((user) => ({
        kind: 'user' as const,
        key: `user:${user.principalId}`,
        label: user.displayName || user.login || '',
        user,
      })),
  ];
}
