import type { DiscussionAgentMention } from '../discussion-agent-mentions';
import type {
  DiscussionAgentActivity,
  DiscussionAuthor,
  DiscussionMessage,
  DiscussionReactor,
} from '$shared/types/workspace-discussion';

export interface DiscussionPendingDisplay {
  id: string;
  body: string;
  author: DiscussionAuthor;
  createdAt: string;
  recipientAgentIds?: string[];
  agentMentions?: DiscussionAgentMention[];
  status: 'sending' | 'failed';
  error?: string;
  replyTo?: DiscussionMessage['replyTo'];
}

export interface DiscussionReactionDisplay {
  emoji: string;
  count: number;
  reacted: boolean;
  reactors?: readonly DiscussionReactor[];
}

/**
 * A request's queued/working row stays until the agent's whole turn ends, which can be
 * long after it posted its answer. Once the agent has replied, the reply is the visible
 * result, so the thread hides the in-progress row. Failed and stopped rows stay.
 */
export function discussionActivityAnswered(
  messages: readonly DiscussionMessage[],
): (
  request: Pick<DiscussionMessage, 'id' | 'sequence'>,
  activity: DiscussionAgentActivity,
) => boolean {
  const linked = new Set<string>();
  const lastUnlinked = new Map<string, Pick<DiscussionMessage, 'sequence' | 'createdAt'>>();
  for (const message of messages) {
    const agentId = message.author.agentId;
    if (!agentId) continue;
    if (message.replyToMessageId) linked.add(JSON.stringify([message.replyToMessageId, agentId]));
    else {
      const last = lastUnlinked.get(agentId);
      if (!last || message.sequence > last.sequence) lastUnlinked.set(agentId, message);
    }
  }
  return (request, activity) => {
    if (activity.state !== 'queued' && activity.state !== 'working') return false;
    if (linked.has(JSON.stringify([request.id, activity.agentId]))) return true;
    // Without a reply link, only a message posted after this request started counts.
    const last = lastUnlinked.get(activity.agentId);
    return (
      activity.state === 'working' &&
      !!last &&
      last.sequence > request.sequence &&
      Date.parse(last.createdAt) >= Date.parse(activity.updatedAt)
    );
  };
}
