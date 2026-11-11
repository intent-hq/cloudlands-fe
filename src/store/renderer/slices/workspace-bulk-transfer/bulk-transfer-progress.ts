import type { TransferProgress } from '../workspace-transfer/workspace-transfer-types';
import type { BulkTransferItem } from './workspace-bulk-transfer-types';

export interface BulkTransferEstimate {
  bytes: number;
  /** Every workspace has a loaded estimate. */
  complete: boolean;
  /** At least one estimate is still loading. */
  loading: boolean;
}

/** Sum of the per-workspace `workspace.transfer.plan` estimates. */
export function bulkTransferEstimate(items: readonly BulkTransferItem[]): BulkTransferEstimate {
  let bytes = 0;
  let complete = true;
  let loading = false;
  for (const item of items) {
    if (item.sizeStatus === 'loaded' && item.sizeBytes !== null) bytes += item.sizeBytes;
    else complete = false;
    if (item.sizeStatus === 'loading') loading = true;
  }
  return { bytes, complete, loading };
}

/** Share of the running workspace already moved: download + upload against twice the archive. */
function runningFraction(progress: TransferProgress | null): number {
  if (!progress || progress.phase === 'building') return 0;
  if (progress.phase === 'committing') return 1;
  const total = progress.bytesTotal;
  if (!total || total <= 0) return 0;
  return Math.min(1, (progress.bytesDown + progress.bytesUp) / (total * 2));
}

/**
 * Overall progress in [0, 1]. Each workspace weighs its size estimate (at
 * least one byte so empty ones still advance; unknown sizes take the average
 * known size). Finished workspaces, whatever the outcome, count in full.
 */
export function bulkTransferFraction(
  items: readonly BulkTransferItem[],
  currentId: string | null,
  progress: TransferProgress | null,
): number {
  const known = items.flatMap((item) =>
    item.sizeStatus === 'loaded' && item.sizeBytes !== null ? [item.sizeBytes] : [],
  );
  const fallback = known.length ? known.reduce((sum, bytes) => sum + bytes, 0) / known.length : 1;
  let total = 0;
  let done = 0;
  for (const item of items) {
    const weight = Math.max(
      1,
      item.sizeStatus === 'loaded' && item.sizeBytes !== null ? item.sizeBytes : fallback,
    );
    total += weight;
    if (item.status === 'done' || item.status === 'failed' || item.status === 'skipped') {
      done += weight;
    } else if (item.status === 'running' && item.workspaceId === currentId) {
      done += weight * runningFraction(progress);
    }
  }
  return total > 0 ? Math.min(1, done / total) : 0;
}
