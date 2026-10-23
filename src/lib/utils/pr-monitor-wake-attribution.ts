/**
 * PR-monitor wake message attribution.
 *
 * The daemon tags user-role rows delivered by a centralized PR-monitor wake
 * with `{ type: 'pr_monitor_wake', monitorId, repo, prNumber, reason, url? }`
 * — on the row's `metadata`, on the persisted text block's `messageMetadata`,
 * and on queued entries' `messageMetadata` (PROTOCOL §5.42). This util
 * extracts that attribution metadata-first, with the protocol prefix as a
 * legacy fallback.
 */

import {
  MonitorResourceSchema,
  MonitorAvailabilitySchema,
  type ReviewMonitorExtension,
} from '$shared/types/pr-monitor';
import { getPrChipLabel } from './pr-chip-label';

export interface PrMonitorWakeAttribution extends ReviewMonitorExtension {
  /** Monitor id (may be empty when the daemon omitted it). */
  monitorId: string;
  /** `owner/repo` of the monitored PR. */
  repo: string;
  /** PR number. */
  prNumber: number;
  /** The PR's HTML URL, when the daemon had a baseline snapshot to read it from. */
  url?: string;
  /** Wake reason supplied by the daemon (empty for legacy prefix fallback). */
  reason?: string;
}

const PR_MONITOR_WAKE_PREFIX = /^\[PR monitor ([^\s#\]]+)#([1-9][0-9]*)\]\s*/;

/**
 * Extract PR-monitor wake attribution from metadata or a legacy protocol
 * prefix. Metadata still requires usable `repo` + `prNumber` fields.
 */
export function getPrMonitorWakeAttribution(
  metadata: unknown,
  legacyContent?: string,
): PrMonitorWakeAttribution | null {
  if (metadata && typeof metadata === 'object') {
    const md = metadata as Record<string, unknown>;
    if (md.type === 'pr_monitor_wake') {
      const repo = typeof md.repo === 'string' ? md.repo.trim() : '';
      const prNumber =
        typeof md.prNumber === 'number' && Number.isInteger(md.prNumber) && md.prNumber > 0
          ? md.prNumber
          : null;
      if (!repo || prNumber === null) return null;

      const resource =
        md.resource === undefined ? undefined : MonitorResourceSchema.safeParse(md.resource);
      if (
        resource &&
        (!resource.success ||
          resource.data.number !== prNumber ||
          resource.data.repository.projectPath !== repo)
      )
        return null;
      const extension: ReviewMonitorExtension = {
        ...(resource?.success ? { resource: resource.data } : {}),
        ...(md.monitorAvailability !== undefined
          ? { monitorAvailability: MonitorAvailabilitySchema.parse(md.monitorAvailability) }
          : {}),
      };
      const monitorId = typeof md.monitorId === 'string' ? md.monitorId.trim() : '';
      const url = typeof md.url === 'string' && md.url.trim() ? md.url.trim() : undefined;
      const reason = typeof md.reason === 'string' ? md.reason : '';
      return { monitorId, repo, prNumber, reason, ...extension, ...(url ? { url } : {}) };
    }
  }

  const legacyMatch = legacyContent?.match(PR_MONITOR_WAKE_PREFIX);
  if (!legacyMatch) return null;
  return {
    monitorId: '',
    repo: legacyMatch[1],
    prNumber: Number(legacyMatch[2]),
    reason: '',
  };
}

/**
 * The PR HTML URL to open: metadata `url` when the daemon provided it, else
 * the GitHub fallback built from `repo` + `prNumber` (same fallback as
 * MonitoredPrsRow) — so the chip works before the daemon ships `url`.
 */
export function getPrMonitorWakeUrl(attribution: PrMonitorWakeAttribution): string {
  return (
    attribution.url ??
    (attribution.resource || attribution.monitorAvailability
      ? ''
      : `https://github.com/${attribution.repo}/pull/${attribution.prNumber}`)
  );
}

/**
 * Chip label following the shared PR-chip convention (`getPrChipLabel`, also
 * used by MonitoredPrsRow): `repo #N` when the PR's owner matches the
 * workspace repository's owner, otherwise (or when the workspace repository
 * is unknown) `owner/repo #N`.
 */
export function getPrMonitorWakeChipLabel(
  attribution: PrMonitorWakeAttribution,
  workspaceRepo?: string,
): string {
  if (attribution.resource?.repository.provider === 'gitlab')
    return `${attribution.resource.repository.projectPath} !${attribution.prNumber}`;
  return getPrChipLabel(attribution.repo, attribution.prNumber, workspaceRepo);
}

/**
 * Literal wake prefix the daemon prepends to PR-monitor wake message
 * content: `[PR monitor <owner/repo>#<n>] `. Display-only strip — the stored
 * message text is never mutated. Returns the input unchanged when no prefix
 * matches. MR prefixes require an already validated qualified attribution and
 * must match its project and number; MR text alone never supplies identity.
 */
export function stripPrMonitorWakePrefix(
  text: string,
  attribution?: PrMonitorWakeAttribution | null,
): string {
  const resource = attribution?.resource;
  if (resource?.repository.provider === 'gitlab' && resource.kind === 'merge-request') {
    const prefix = `[MR monitor ${resource.repository.projectPath}!${resource.number}]`;
    return text.startsWith(prefix) ? text.slice(prefix.length).trimStart() : text;
  }
  return text.replace(PR_MONITOR_WAKE_PREFIX, '');
}
