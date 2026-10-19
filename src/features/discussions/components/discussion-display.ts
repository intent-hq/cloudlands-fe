import type { DiscussionAgentMention } from '../discussion-agent-mentions';
import type { DiscussionAuthor, DiscussionMessage } from '$shared/types/workspace-discussion';

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
}
