import { m } from '$shared/paraglide/messages.js';

export function discussionTitle(
  conversation: {
    id?: string;
    name?: string | null;
    kind: string;
    participants: readonly {
      principalId: string;
      displayName: string | null;
      login: string | null;
    }[];
  },
  selfId?: string,
) {
  if (conversation.name?.trim()) return conversation.name.trim();
  if (conversation.kind === 'workspace')
    return conversation.id && conversation.id !== 'default'
      ? m.workspace_discussion_conversation_title()
      : m.workspace_discussion_title();
  const names = conversation.participants
    .filter((person) => person.principalId !== selfId)
    .map(
      (person) =>
        person.displayName || person.login || m.workspace_discussion_unknownAuthor_label(),
    );
  return names.join(', ') || m.workspace_discussion_group_title();
}
