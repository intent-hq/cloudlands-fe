import type { AgentSession, Note } from '$shared/types';
import { getAgentPeekData } from '$lib/utils/agent-peek-utils';
import { stripGroupTags, stripMarkdownFormatting } from '$lib/utils/text-utils';

export interface AgentLauncherPreview {
  lastUserMessage: string;
  response: string;
}

export function shouldShowAgentInLauncher(agent: AgentSession, isRunning: boolean): boolean {
  return isRunning || agent.hasUnread === true;
}

function getLastMessageTimestamp(agent: AgentSession): number {
  const timestamp = agent.messages.at(-1)?.timestamp;
  if (!timestamp) return 0;
  const time = new Date(timestamp).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function compareAgentsByLastMessage(a: AgentSession, b: AgentSession): number {
  return getLastMessageTimestamp(b) - getLastMessageTimestamp(a);
}

export function getAgentLauncherPreview(
  agent: AgentSession,
  streamingContent = '',
): AgentLauncherPreview {
  const peek = getAgentPeekData(agent);
  const lastUserMessage =
    peek?.lastUserMessage
      .replace(/^\[.*?\]\s*/g, '')
      .replace(/@context\[[^\]]*\]/g, '')
      .replace(/\s+/g, ' ')
      .trim() ?? '';
  const liveResponse = stripGroupTags(streamingContent).trim();

  return {
    lastUserMessage,
    response: liveResponse || peek?.lastResponse?.trim() || '',
  };
}

export function getNoteLauncherPreview(note: Note): string {
  return stripMarkdownFormatting(note.content)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
