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
