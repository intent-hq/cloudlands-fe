import type { AgentMessage } from '$shared/types';
import { extractAllContent } from '$shared/types';
import { stripMarkdownFormatting } from '$shared/utils-client';
import {
  getPresentedUserMessageText,
  stripInternalDeliveryNotes,
  stripTruncatedTrailingDeliveryNote,
} from '$lib/utils/user-message-presentation';
import type { UserMessageIndexItem } from '$lib/client';

export interface UserMessageNavigationItem {
  id: string;
  text: string;
}

export interface ChatNavigationState {
  isAtBottom: boolean;
  userMessages: UserMessageNavigationItem[];
  /**
   * True while the first full-history index fetch (`agent.listUserMessages`)
   * is in flight — false again once the index is cached or unsupported.
   */
  isLoadingUserMessageIndex: boolean;
}

export interface MessageNavigationStartGeometry {
  currentScrollTop: number;
  targetTop: number;
  containerTop: number;
  headerBottom?: number;
}

export function getMessageNavigationStartScrollTop({
  currentScrollTop,
  targetTop,
  containerTop,
  headerBottom,
}: MessageNavigationStartGeometry): number {
  const visibleStart = Math.max(containerTop, headerBottom ?? containerTop);
  return currentScrollTop + targetTop - visibleStart;
}

function hasAutomatedPrefix(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith('[WORKSPACE EVENTS]') ||
    trimmed.startsWith('[TASK WAKE]') ||
    trimmed.startsWith('[AGENT MESSAGE]')
  );
}

function isAutomatedUserMessage(message: AgentMessage, text: string): boolean {
  if (message.metadata?.type) return true;
  return hasAutomatedPrefix(text);
}

export function getPlainTextMessagePreview(message: AgentMessage): string {
  return stripMarkdownFormatting(getPresentedUserMessageText(message)).replace(/\s+/g, ' ').trim();
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

/**
 * Convert full-history index items (`agent.listUserMessages`) into navigation
 * items, applying the same automated-row exclusion and plain-text
 * normalization as the tail-derived path above. The daemon serves user-role
 * rows only, so no role filter is needed.
 */
export function getUserMessageNavigationItemsFromIndex(
  indexItems: readonly UserMessageIndexItem[],
): UserMessageNavigationItem[] {
  const seenIds = new Set<string>();
  const items: UserMessageNavigationItem[] = [];
  for (const item of indexItems) {
    if (seenIds.has(item.id)) continue;
    if (item.metadata?.type || hasAutomatedPrefix(item.preview)) continue;
    const text = stripMarkdownFormatting(
      stripTruncatedTrailingDeliveryNote(
        stripInternalDeliveryNotes(item.preview, item.metadata),
        item.metadata,
      ),
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    seenIds.add(item.id);
    items.push({ id: item.id, text });
  }
  return items;
}

/**
 * Merge the full-history index items (oldest→newest) with the tail-derived
 * items. Tail items win by id — they are freshest (including still-streaming
 * rows) — while index-only rows keep their index position; tail-only rows
 * (newer than the index snapshot) are appended in tail order.
 */
export function mergeUserMessageNavigationItems(
  indexItems: readonly UserMessageNavigationItem[],
  tailItems: readonly UserMessageNavigationItem[],
): UserMessageNavigationItem[] {
  const tailById = new Map(tailItems.map((item) => [item.id, item]));
  const merged = indexItems.map((item) => tailById.get(item.id) ?? item);
  const indexIds = new Set(indexItems.map((item) => item.id));
  for (const item of tailItems) {
    if (!indexIds.has(item.id)) merged.push(item);
  }
  return merged;
}
