import type { DiscussionAgentMention } from '$shared/types/workspace-discussion';

/** Only explicit picker selections create delivery targets. Text alone never does. */
export type { DiscussionAgentMention } from '$shared/types/workspace-discussion';

/** Keep only untouched selected tokens, shifting them when surrounding text changes. */
export function reconcileDiscussionMentions<T extends { name: string; start: number; end: number }>(
  before: string,
  after: string,
  mentions: readonly T[],
): T[] {
  if (before === after) return [...mentions];
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const shift = newEnd - oldEnd;
  return mentions
    .flatMap((mention) => {
      if (mention.end <= start) return [mention];
      if (mention.start >= oldEnd)
        return [{ ...mention, start: mention.start + shift, end: mention.end + shift }];
      return [];
    })
    .filter(
      (mention) =>
        // Repeated plain references can make a text diff ambiguous. If a token
        // disappeared, revoke its target rather than transfer it to another copy.
        after.split(`@${mention.name}`).length >= before.split(`@${mention.name}`).length &&
        after.slice(mention.start, mention.end) === `@${mention.name}` &&
        (mention.start === 0 || /\s/.test(after[mention.start - 1])) &&
        (mention.end === after.length || /[\s.,!?;:]/.test(after[mention.end])),
    );
}

export function discussionAgentIds(mentions: readonly DiscussionAgentMention[]): string[] {
  return [...new Set(mentions.map((mention) => mention.agentId))].sort();
}

/** Current agent display names keyed by agent ID; absent agents keep their snapshot. */
export type DiscussionAgentNames = Readonly<Record<string, string>>;

/**
 * The saved `name` validates the immutable span; the label follows the agent ID so a
 * rename shows everywhere the agent was mentioned.
 */
export function discussionAgentMentionLabel(
  mention: Pick<DiscussionAgentMention, 'agentId' | 'name'>,
  agentNames: DiscussionAgentNames = {},
): string {
  const current = Object.hasOwn(agentNames, mention.agentId)
    ? agentNames[mention.agentId]?.trim()
    : '';
  return current || mention.name;
}

/** Plain-text body with each valid saved span relabeled to the agent's current name. */
export function discussionBodyWithAgentNames(
  body: string,
  mentions: readonly DiscussionAgentMention[] = [],
  agentNames: DiscussionAgentNames = {},
): string {
  let result = '';
  let cursor = 0;
  for (const mention of [...mentions].sort((a, b) => a.start - b.start)) {
    if (
      mention.start < cursor ||
      mention.end > body.length ||
      body.slice(mention.start, mention.end) !== `@${mention.name}`
    )
      continue;
    result += `${body.slice(cursor, mention.start)}@${discussionAgentMentionLabel(mention, agentNames)}`;
    cursor = mention.end;
  }
  return result + body.slice(cursor);
}
