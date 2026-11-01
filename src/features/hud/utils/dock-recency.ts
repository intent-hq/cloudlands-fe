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
/** Hard bound on pages per scan, so a flood of automated rows stays cheap. */
export const DOCK_INDEX_MAX_PAGES = 20;

/** What one dock scan proved about an agent's newest human message. */
export interface DockHumanScan {
  /** Newest human message timestamp found, or null when none is in range. */
  latest: number | null;
  /** Newest row timestamp the scan read; the next scan may stop below it. */
  scannedThrough: number | null;
}

export type DockIndexPageReader = (
  page: UserMessageIndexPageOptions,
) => Promise<UserMessageIndexResult>;

function timestamps(items: readonly UserMessageIndexItem[]): number[] {
  return items.map((item) => Date.parse(item.createdAt)).filter(Number.isFinite);
}

/**
 * Find an agent's newest human message by reading the user-message index
 * newest-first (`agent.listUserMessages` paging, intent-hq/intent#8278)
 * instead of downloading the whole index. Stops at the first page holding
 * a human row, when older rows cannot be recent (past the dock window), or
 * when they were already covered by `previous` (its `latest` still holds).
 * A daemon that predates paging returns the whole index without
 * `nextToken`, which reads as one complete page. `null` when a read fails:
 * failures never prove recency.
 */
export async function scanDockHumanMessages(
  readPage: DockIndexPageReader,
  now: number,
  previous?: DockHumanScan,
): Promise<DockHumanScan | null> {
  const windowStart = now - DOCK_CONVERSATION_WINDOW_MS;
  let nextToken: string | undefined;
  let scannedThrough: number | null = null;
  for (let page = 0; page < DOCK_INDEX_MAX_PAGES; page++) {
    const result = await readPage({ limit: DOCK_INDEX_PAGE_LIMIT, nextToken });
    if (!result.ok) return null;
    const read = timestamps(result.items);
    if (read.length > 0) {
      const newest = Math.max(...read);
      scannedThrough = scannedThrough === null ? newest : Math.max(scannedThrough, newest);
    }
    const latest = latestDockHumanMessage(result.items);
    if (latest !== null) return { latest, scannedThrough };
    if (typeof result.nextToken !== 'string') return { latest: null, scannedThrough };
    const oldest = read.length > 0 ? Math.min(...read) : null;
    if (oldest !== null && previous?.scannedThrough != null && oldest < previous.scannedThrough)
      return { latest: previous.latest, scannedThrough };
    if (oldest !== null && oldest <= windowStart) return { latest: null, scannedThrough };
    nextToken = result.nextToken;
  }
  return { latest: previous?.latest ?? null, scannedThrough };
}

export function isRecentDockConversation(
  timestamp: number | null | undefined,
  now: number,
): boolean {
  return timestamp != null && timestamp <= now && timestamp > now - DOCK_CONVERSATION_WINDOW_MS;
}
