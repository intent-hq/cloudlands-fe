import type { AgentMessage } from '$shared/types';
import { extractAllContent } from '$shared/types';
import { stripMarkdownFormatting } from '$shared/utils-client';

export interface UserMessageNavigationItem {
  id: string;
  text: string;
}

export interface ChatNavigationState {
  isAtBottom: boolean;
  userMessages: UserMessageNavigationItem[];
}

function isAutomatedUserMessage(message: AgentMessage, text: string): boolean {
  if (message.metadata?.type) return true;
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith('[WORKSPACE EVENTS]') ||
    trimmed.startsWith('[TASK WAKE]') ||
    trimmed.startsWith('[AGENT MESSAGE]')
  );
}

export function getPlainTextMessagePreview(message: AgentMessage): string {
  return stripMarkdownFormatting(extractAllContent(message)).replace(/\s+/g, ' ').trim();
}

export function getUserMessageNavigationItems(
  messages: readonly AgentMessage[],
): UserMessageNavigationItem[] {
  const seenIds = new Set<string>();
  const items: UserMessageNavigationItem[] = [];
  for (const message of messages) {
    if (message.role !== 'user' || seenIds.has(message.id)) continue;
    const sourceText = extractAllContent(message);
    if (isAutomatedUserMessage(message, sourceText)) continue;
    const text = getPlainTextMessagePreview(message);
    if (!text) continue;
    seenIds.add(message.id);
    items.push({ id: message.id, text });
  }
  return items;
}
