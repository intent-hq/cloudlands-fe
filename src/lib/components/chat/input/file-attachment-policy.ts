import type { ContextItem } from './context-api';

/** Optional host policy; ordinary chat keeps its existing behavior when absent. */
export interface FileAttachmentPolicy {
  enabled: boolean;
  limit: number;
  /** Separate evidence clips do not consume ordinary file slots. */
  excludedIds?: readonly string[];
  unavailableMessage: string;
  limitMessage: string;
}

export function fileAttachmentRejection(
  items: readonly ContextItem[],
  policy?: FileAttachmentPolicy,
): 'disabled' | 'limit' | null {
  if (!policy) return null;
  if (!policy.enabled) return 'disabled';
  const excluded = new Set(policy.excludedIds);
  const count = items.filter(
    (item) =>
      item.type === 'file' && !item.imageData && !item.imageMimeType && !excluded.has(item.id),
  ).length;
  const limit = Number.isFinite(policy.limit) ? Math.max(0, Math.floor(policy.limit)) : 0;
  return count >= limit ? 'limit' : null;
}
