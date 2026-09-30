import type { AgentMessage } from '$shared/types';
import { isAutomatedChatMessage } from './previous-user-message';

export interface PreviousMessagePage {
  /** Conversation pages are in ascending transcript order. */
  messages: AgentMessage[];
  nextToken: string | null;
  prevToken: string | null;
  totalMessages: number;
}

/**
 * Resolve an unknown predecessor via the supported aroundMessageId/backward
 * cursor API. Never infer across a resident gap or publish intermediate pages.
 * The caller owns cancellation and commits only the final landing page.
 */
export async function loadPreviousUserMessage(
  currentMessageId: string,
  fetchPage: (token?: string, anchor?: string) => Promise<PreviousMessagePage>,
  isCurrent: () => boolean,
): Promise<{
  target: AgentMessage | null;
  page: PreviousMessagePage;
  rowsBeforeAnchor: number;
} | null> {
  let token: string | undefined;
  const tokens = new Set<string>();
  const seenIds = new Set<string>();
  const seenAppIds = new Set<string>();
  let rowsBeforeAnchor = 0;
  let lastNonemptyPage: PreviousMessagePage | undefined;
  while (isCurrent()) {
    const page = await fetchPage(token, token ? undefined : currentMessageId);
    if (!isCurrent()) return null;
    let end = page.messages.length;
    if (!token) {
      end = page.messages.findIndex((message) => message.id === currentMessageId);
      if (end < 0) throw new Error('Previous-message anchor is absent from its conversation page');
      // Exclude the clicked row and any newer rows, even if a later page overlaps.
      for (const message of page.messages.slice(end)) {
        seenIds.add(message.id);
        if (message.appMessageId) seenAppIds.add(message.appMessageId);
      }
    }
    rowsBeforeAnchor += end;
    if (page.messages.length > 0) lastNonemptyPage = page;
    for (let index = end - 1; index >= 0; index--) {
      const message = page.messages[index];
      if (seenIds.has(message.id) || (message.appMessageId && seenAppIds.has(message.appMessageId)))
        continue;
      seenIds.add(message.id);
      if (message.appMessageId) seenAppIds.add(message.appMessageId);
      if (message.role === 'user' && !isAutomatedChatMessage(message)) {
        return { target: message, page, rowsBeforeAnchor };
      }
    }
    if (page.nextToken === null) {
      return {
        target: null,
        page: { ...(lastNonemptyPage ?? page), nextToken: null },
        rowsBeforeAnchor,
      };
    }
    if (!page.nextToken || tokens.has(page.nextToken)) {
      throw new Error('Previous-message cursor did not advance');
    }
    tokens.add(page.nextToken);
    token = page.nextToken;
  }
  return null;
}
