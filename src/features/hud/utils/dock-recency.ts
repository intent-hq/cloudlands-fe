import type {
  UserMessageIndexItem,
  UserMessageIndexPageOptions,
  UserMessageIndexResult,
} from '$lib/client';
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

/** Newest rows per dock index page: one page usually holds a human row. */
export const DOCK_INDEX_PAGE_LIMIT = 50;
/**
 * Hard bound on pages per scan, so a flood of automated rows stays cheap.
 * Only a first scan of an agent with no recent human row walks this far;
 * later scans stop at the previous scan's newest row.
 */
export const DOCK_INDEX_MAX_PAGES = 20;

/** What one dock scan proved about an agent's newest human message. */
export interface DockHumanScan {
  /** Newest human message timestamp found, or null when none was found. */
  latest: number | null;
  /** Id of the newest row the scan read; the next scan may stop there. */
  newestId: string | null;
}

function newer(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  return b !== null && b > a ? b : a;
}

export type DockIndexPageReader = (
  page: UserMessageIndexPageOptions,
) => Promise<UserMessageIndexResult>;

/**
 * Find an agent's newest human message by reading the user-message index
 * newest-first (`agent.listUserMessages` paging, intent-hq/intent#8278)
 * instead of downloading the whole index. Pages follow transcript order,
 * not `createdAt`, so every stop is decided by row identity, never by a
 * timestamp: the scan stops at the first page holding a human row, at the
 * newest row `previous` read (whose `latest` then still holds), at the end
 * of the index, or after `DOCK_INDEX_MAX_PAGES` pages. A daemon that
 * predates paging returns the whole index without `nextToken`, which reads
 * as one complete page. `null` when a read fails: failures never prove
 * recency.
 */
export async function scanDockHumanMessages(
  readPage: DockIndexPageReader,
  previous?: DockHumanScan,
): Promise<DockHumanScan | null> {
  let nextToken: string | undefined;
  let newestId: string | null = null;
  for (let page = 0; page < DOCK_INDEX_MAX_PAGES; page++) {
    const result = await readPage({ limit: DOCK_INDEX_PAGE_LIMIT, nextToken });
    if (!result.ok) return null;
    const items = result.items;
    if (newestId === null && items.length > 0) newestId = items[items.length - 1].id;
    const seen =
      previous?.newestId != null ? items.findIndex((item) => item.id === previous.newestId) : -1;
    const latest = latestDockHumanMessage(seen >= 0 ? items.slice(seen + 1) : items);
    // Rows the previous scan read still stand, so its result can only be
    // superseded by a newer timestamp, never by a backdated new row.
    if (seen >= 0) return { latest: newer(latest, previous?.latest ?? null), newestId };
    if (latest !== null) return { latest: newer(latest, previous?.latest ?? null), newestId };
    if (typeof result.nextToken !== 'string') return { latest: null, newestId };
    nextToken = result.nextToken;
  }
  return { latest: previous?.latest ?? null, newestId };
}

export function isRecentDockConversation(
  timestamp: number | null | undefined,
  now: number,
): boolean {
  return timestamp != null && timestamp <= now && timestamp > now - DOCK_CONVERSATION_WINDOW_MS;
}
