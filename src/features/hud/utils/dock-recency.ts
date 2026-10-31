import type { UserMessageIndexItem } from '$lib/client';
import { isAutomatedChatMessage } from '$lib/utils/previous-user-message';

const DOCK_CONVERSATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Only persisted human messages can admit an entry; activity is not evidence. */
export function latestDockHumanMessage(items: readonly UserMessageIndexItem[]): number | null {
  let latest: number | null = null;
  for (const item of items) {
    if (
      isAutomatedChatMessage({
        id: item.id,
        role: 'user',
        timestamp: item.createdAt,
        metadata: item.metadata,
        contentBlocks: [{ type: 'text', text: item.preview.trimStart() }],
      })
    )
      continue;
    const timestamp = Date.parse(item.createdAt);
    if (Number.isFinite(timestamp) && (latest === null || timestamp > latest)) latest = timestamp;
  }
  return latest;
}

export function isRecentDockConversation(
  timestamp: number | null | undefined,
  now: number,
): boolean {
  return timestamp != null && timestamp <= now && timestamp > now - DOCK_CONVERSATION_WINDOW_MS;
}
