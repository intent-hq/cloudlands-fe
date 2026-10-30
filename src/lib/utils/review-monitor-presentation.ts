import type { ReviewMonitorRow, ReviewMonitorExtension } from '$shared/types/pr-monitor';
import { reviewTargetKey } from '$shared/types/repository-context';
import { getPrChipLabel } from './pr-chip-label';
import { m } from '$shared/paraglide/messages.js';

type MonitorIdentity = ReviewMonitorExtension & {
  monitorId?: string;
  repo: string;
  prNumber: number;
  url?: string | null;
};

export function isMergeRequest(row: ReviewMonitorExtension): boolean {
  return row.resource?.repository.provider === 'gitlab';
}

export function monitorNumber(row: ReviewMonitorExtension, number: number): string {
  return `${isMergeRequest(row) ? '!' : '#'}${number}`;
}

/** Only the legacy GitHub contract permits reconstructing a URL. */
export function monitorUrl(row: MonitorIdentity): string {
  return (
    row.url ??
    (row.resource || row.monitorAvailability || row.url === null
      ? ''
      : `https://github.com/${row.repo}/pull/${row.prNumber}`)
  );
}

export function monitorChipLabel(row: MonitorIdentity, workspaceRepo?: string): string {
  return isMergeRequest(row)
    ? `${row.repo} !${row.prNumber}`
    : getPrChipLabel(row.repo, row.prNumber, workspaceRepo);
}

export function monitorIdentity(row: MonitorIdentity): string {
  return row.resource
    ? reviewTargetKey(row.resource)
    : row.monitorAvailability
      ? `unresolved:${row.monitorId}`
      : `${row.repo.toLowerCase()}#${row.prNumber}`;
}

/** Availability replaces the existing status sentence, never an extra provider panel. */
export function monitorAvailabilitySummary(row: ReviewMonitorExtension): string | undefined {
  switch (row.monitorAvailability?.state) {
    case undefined:
    case 'available':
      return undefined;
    case 'pending':
      return m.chat_chatMessage_loading_label();
    case 'reconnect-required':
      return m.chat_monitoredPrs_status_reconnect();
    case 'restricted':
      return m.chat_monitoredPrs_status_restricted();
    case 'unresolved':
      return m.chat_monitoredPrs_status_unresolved();
    default:
      return m.chat_monitoredPrs_status_unknown();
  }
}

export function hasUnknownMonitorFacts(
  snapshot: NonNullable<ReviewMonitorRow['lastSnapshot']>,
): boolean {
  return (
    snapshot.isDraft === null ||
    snapshot.hasConflicts === null ||
    snapshot.isBehind === null ||
    Object.values(snapshot.checks).some((value) => value === null) ||
    snapshot.approvals.have === null ||
    snapshot.approvals.changesRequested === null ||
    (snapshot.availability !== undefined &&
      Object.values(snapshot.availability).some((value) => value !== 'available'))
  );
}

/** Canonical instance context for existing tooltips and accessible labels.
 * Kept out of the compact visible label so ordinary row geometry stays shared. */
export function monitorAccessibleLabel(label: string, row: ReviewMonitorExtension): string {
  if (!isMergeRequest(row) || !row.resource) return label;
  const instance = new URL(row.resource.repository.instanceBaseUrl);
  return `${label} (${instance.host}${instance.pathname.replace(/\/$/, '')})`;
}
