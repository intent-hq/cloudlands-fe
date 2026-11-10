/**
 * Cross-machine workspace feed for the Unified window (main → shell). Rows are the
 * lite workspace fields the shell needs for tab titles, status icons, palette search
 * and (stage 2) Home — never workspace content. Shared by main and the shell renderer.
 */

/** Fields copied from a daemon `workspace.subscribe` / `workspace.list` row. */
export const UNIFIED_FEED_ROW_KEYS = [
  'id',
  'title',
  'status',
  'archived',
  'displayStatus',
  'attention',
  'activity',
  'waiting',
  'repositoryName',
  'repositoryOwner',
  'repositoryPath',
  'branch',
  'createdAt',
  'updatedAt',
  'lastActivityAt',
  'myRole',
] as const;

export type UnifiedFeedRow = { id: string; title: string } & Partial<
  Record<Exclude<(typeof UNIFIED_FEED_ROW_KEYS)[number], 'id' | 'title'>, unknown>
>;

export interface UnifiedMachineFeed {
  machineId: string;
  rows: UnifiedFeedRow[];
  /** True while the machine is offline or not yet connected: rows are the last known list. */
  stale: boolean;
}

/** Keep only the lite fields; drop rows without a usable id. */
export function toFeedRow(raw: unknown): UnifiedFeedRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  if (typeof source.id !== 'string' || source.id.length === 0) return null;
  const row: Record<string, unknown> = {};
  for (const key of UNIFIED_FEED_ROW_KEYS) {
    if (source[key] !== undefined) row[key] = source[key];
  }
  row.title = typeof source.title === 'string' ? source.title : '';
  return row as UnifiedFeedRow;
}
