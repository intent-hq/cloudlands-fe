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

import { m } from '$shared/paraglide/messages.js';
import { formatInteger } from '$lib/i18n/format';

export interface PrMonitorWakeAttribution {
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

      const monitorId = typeof md.monitorId === 'string' ? md.monitorId.trim() : '';
      const url = typeof md.url === 'string' && md.url.trim() ? md.url.trim() : undefined;
      const reason = typeof md.reason === 'string' ? md.reason : '';
      return { monitorId, repo, prNumber, reason, ...(url ? { url } : {}) };
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
  return attribution.url ?? `https://github.com/${attribution.repo}/pull/${attribution.prNumber}`;
}

/**
 * Chip label following the MonitoredPrsRow convention: `#N`, prefixed with
 * `org/repo: ` only when the PR's repo differs from the workspace repository
 * (or the workspace repository is unknown — then plain `#N`).
 */
export function getPrMonitorWakeChipLabel(
  attribution: PrMonitorWakeAttribution,
  workspaceRepo?: string,
): string {
  const number = `#${formatInteger(attribution.prNumber)}`;
  if (workspaceRepo && attribution.repo !== workspaceRepo) {
    return m.chat_prMonitorWakeAttribution_crossRepoChip_label({
      repo: attribution.repo,
      number,
    });
  }
  return number;
}

/**
 * Literal wake prefix the daemon prepends to PR-monitor wake message
 * content: `[PR monitor <owner/repo>#<n>] `. Display-only strip — the stored
 * message text is never mutated. Returns the input unchanged when no prefix
 * matches.
 */
export function stripPrMonitorWakePrefix(text: string): string {
  return text.replace(PR_MONITOR_WAKE_PREFIX, '');
}
