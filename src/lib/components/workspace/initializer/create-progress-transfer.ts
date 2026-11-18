/**
 * Download size and rate for the `receiving` clone phase, from
 * the daemon's `git:clone:progress` `transfer` counters (PROTOCOL §6.5).
 */
import { m } from '$shared/paraglide/messages.js';
import { formatNumber } from '$lib/i18n/format';
import type { WorkspaceCreateTransfer } from '$store/renderer/slices/workspace-create-progress/workspace-create-progress-types';

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

function byteUnit(bytes: number): { unit: string; value: number; digits: number } {
  if (bytes >= 1e9) return { unit: 'gigabyte', value: bytes / 1e9, digits: 2 };
  if (bytes >= 1e6) return { unit: 'megabyte', value: bytes / 1e6, digits: 1 };
  return { unit: 'kilobyte', value: bytes / 1e3, digits: bytes < 1e4 ? 1 : 0 };
}

function formatBytes(bytes: number, perSecond = false): string {
  const { unit, value, digits } = byteUnit(bytes);
  return formatNumber(value, {
    style: 'unit',
    unit: perSecond ? `${unit}-per-second` : unit,
    maximumFractionDigits: digits,
  });
}

/** "12.3 MB · 5.7 MB/s", or `null` until git reports bytes. */
export function createProgressTransferLabel(transfer: WorkspaceCreateTransfer): string | null {
  const { receivedBytes, bytesPerSecond } = transfer;
  if (receivedBytes === undefined || bytesPerSecond === undefined) return null;
  return m.workspace_compactInitializer_progressTransfer_label({
    received: formatBytes(receivedBytes),
    rate: formatBytes(bytesPerSecond, true),
  });
}
