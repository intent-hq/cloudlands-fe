/**
 * Download size, rate and time left for the `receiving` clone phase, from
 * the daemon's `git:clone:progress` `transfer` counters (PROTOCOL §6.5).
 */
import { m } from '$shared/paraglide/messages.js';
import { formatNumber, formatSalientDuration } from '$lib/i18n/format';
import type { WorkspaceCreateTransfer } from '$store/renderer/slices/workspace-create-progress/workspace-create-progress-types';

/** Below this share of objects the average object size is too noisy to extrapolate. */
const MIN_ESTIMATE_FRACTION = 0.05;

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Validate an untrusted `data.transfer` payload; `undefined` when unusable. */
export function parseCreateProgressTransfer(raw: unknown): WorkspaceCreateTransfer | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const receivedObjects = count(record.receivedObjects);
  const totalObjects = count(record.totalObjects);
  if (receivedObjects === undefined || !totalObjects) return undefined;
  const transfer: WorkspaceCreateTransfer = { receivedObjects, totalObjects };
  const receivedBytes = count(record.receivedBytes);
  const bytesPerSecond = count(record.bytesPerSecond);
  if (receivedBytes !== undefined) transfer.receivedBytes = receivedBytes;
  if (bytesPerSecond !== undefined) transfer.bytesPerSecond = bytesPerSecond;
  return transfer;
}

/**
 * Time left for the download: the remaining objects at the average object
 * size so far, over git's current rate. git never reports the total size,
 * so this is an estimate. `null` when there is not enough data.
 */
function estimateDownloadMsLeft(transfer: WorkspaceCreateTransfer): number | null {
  const { receivedObjects, totalObjects, receivedBytes, bytesPerSecond } = transfer;
  if (!receivedBytes || !bytesPerSecond) return null;
  if (receivedObjects >= totalObjects) return null;
  if (receivedObjects / totalObjects < MIN_ESTIMATE_FRACTION) return null;
  const remainingBytes = (receivedBytes * (totalObjects - receivedObjects)) / receivedObjects;
  return Math.round((remainingBytes / bytesPerSecond) * 1000);
}

function byteUnit(bytes: number): { unit: string; value: number; digits: number } {
  if (bytes >= 1e9) return { unit: 'gigabyte', value: bytes / 1e9, digits: 2 };
  if (bytes >= 1e6) return { unit: 'megabyte', value: bytes / 1e6, digits: 1 };
  return { unit: 'kilobyte', value: bytes / 1e3, digits: 0 };
}

function formatBytes(bytes: number, perSecond = false): string {
  const { unit, value, digits } = byteUnit(bytes);
  return formatNumber(value, {
    style: 'unit',
    unit: perSecond ? `${unit}-per-second` : unit,
    maximumFractionDigits: digits,
  });
}

/** Coarse steps so the countdown does not flicker on every rate redraw. */
function roundTimeLeft(ms: number): number {
  if (ms < 60_000) return Math.max(5_000, Math.round(ms / 5_000) * 5_000);
  return Math.round(ms / 60_000) * 60_000;
}

/** "12.3 MB · 5.7 MB/s · 2m left", or `null` until git reports bytes. */
export function createProgressTransferLabel(transfer: WorkspaceCreateTransfer): string | null {
  const { receivedBytes, bytesPerSecond } = transfer;
  if (receivedBytes === undefined || bytesPerSecond === undefined) return null;
  const received = formatBytes(receivedBytes);
  const rate = formatBytes(bytesPerSecond, true);
  const msLeft = estimateDownloadMsLeft(transfer);
  if (msLeft === null)
    return m.workspace_compactInitializer_progressTransfer_label({ received, rate });
  return m.workspace_compactInitializer_progressTransferTimeLeft_label({
    received,
    rate,
    duration: formatSalientDuration(roundTimeLeft(msLeft)),
  });
}
