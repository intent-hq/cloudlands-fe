import { m } from '$shared/paraglide/messages.js';
import { getActiveLocale } from '$lib/i18n/locale';
import { formatInteger } from '$lib/i18n/format';
import type { DiscussionReactionDisplay } from './discussion-display';
import thumbsUp from '../assets/thumbs-up.png';
import thumbsDown from '../assets/thumbs-down.png';
import eyes from '../assets/eyes.png';
import done from '../assets/done.png';
import seeNoEvil from '../assets/see-no-evil.png';

export const discussionReactionChoices = ['👍', '👎', '👀', '✅', '🙈'] as const;
const assets: Record<string, string> = {
  '👍': thumbsUp,
  '👎': thumbsDown,
  '👀': eyes,
  '✅': done,
  '🙈': seeNoEvil,
};
export function discussionReactionAsset(emoji: string): string | undefined {
  return assets[emoji];
}
export function discussionReactionName(emoji: string): string {
  switch (emoji) {
    case '👍':
      return m.workspace_discussion_thumbsUp_label();
    case '👎':
      return m.workspace_discussion_thumbsDown_label();
    case '👀':
      return m.workspace_discussion_eyes_label();
    case '✅':
      return m.workspace_discussion_done_label();
    case '🙈':
      return m.workspace_discussion_seeNoEvil_label();
    default:
      return emoji;
  }
}
export function orderedDiscussionReactions(reactions: readonly DiscussionReactionDisplay[]) {
  const order: readonly string[] = [...discussionReactionChoices, '🙂'];
  return reactions
    .filter((reaction) => reaction.count > 0)
    .toSorted((a, b) => {
      const ai = order.indexOf(a.emoji),
        bi = order.indexOf(b.emoji);
      return (
        (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi) ||
        a.emoji.localeCompare(b.emoji)
      );
    });
}
export function discussionReactionPeople(reaction: DiscussionReactionDisplay): string {
  const names = (reaction.reactors ?? [])
    .slice(0, 20)
    .map(
      (author) =>
        author.displayName || author.login || m.workspace_discussion_unknownAuthor_label(),
    );
  const remaining = Math.max(0, reaction.count - names.length);
  if (remaining)
    names.push(m.workspace_discussion_otherReactors_label({ count: formatInteger(remaining) }));
  return new Intl.ListFormat(getActiveLocale(), { style: 'long', type: 'conjunction' }).format(
    names,
  );
}
