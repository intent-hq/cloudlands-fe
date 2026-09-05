/**
 * Maps daemon provisioning-progress frames (`git:clone:progress`, PROTOCOL
 * §5.1/§6.5) to localized Create-button labels. Phases are daemon-owned
 * strings on the unified 0–100 provisioning scale: the parsed clone phases
 * (`counting`, `compressing`, `receiving`, `resolving`, `checkout`) plus the
 * synthetic milestones (`starting`, `cache`, `submodules`, `cow-copy`,
 * `worktree`, `finalizing`, `complete`). Unknown phases fall back to the
 * generic "Preparing workspace…" label so a daemon that grows new
 * milestones never breaks the button.
 */
import { m } from '$shared/paraglide/messages.js';
import { formatInteger, formatNumber } from '$lib/i18n/format';
import type { WorkspaceCreateProgressEntry } from '$store/renderer/slices/workspace-create-progress/workspace-create-progress-types';

/**
 * Extract an "(N/M)" submodule counter from the daemon's human-readable
 * message (e.g. "Cloning submodules (2/3)"). The counter lives only in the
 * message — the wire frame carries no structured counts.
 */
function submoduleCounter(message: string | undefined): { current: number; total: number } | null {
  const match = message?.match(/\((\d+)\/(\d+)\)/);
  if (!match) return null;
  return { current: Number(match[1]), total: Number(match[2]) };
}

/** Localized stage label for one progress entry (no percent suffix). */
export function createProgressLabel(entry: WorkspaceCreateProgressEntry): string {
  switch (entry.phase) {
    case 'cache':
      return m.workspaceCreation_progressCache_label();
    case 'counting':
      return m.workspaceCreation_progressCounting_label();
    case 'compressing':
      return m.workspaceCreation_progressCompressing_label();
    case 'receiving':
      return m.workspaceCreation_progressReceiving_label();
    case 'resolving':
      return m.workspaceCreation_progressResolving_label();
    case 'checkout':
      return m.workspaceCreation_progressCheckout_label();
    case 'submodules': {
      const counter = submoduleCounter(entry.message);
      return counter
        ? m.workspaceCreation_progressSubmodulesCounted_label({
            current: formatInteger(counter.current),
            total: formatInteger(counter.total),
          })
        : m.workspaceCreation_progressSubmodules_label();
    }
    case 'cow-copy':
      return m.workspaceCreation_progressCowCopy_label();
    case 'worktree':
      return m.workspaceCreation_progressWorktree_label();
    case 'finalizing':
      return m.workspaceCreation_progressFinalizing_label();
    case 'complete':
      return m.workspaceCreation_stageAlmostReady_label();
    case 'starting':
    default:
      return m.workspaceCreation_stagePreparing_label();
  }
}

/** Locale-aware "45%" for a 0–100 progress value (clamped, rounded). */
export function formatCreateProgressPercent(percent: number): string {
  const clamped = Math.min(Math.max(percent, 0), 100);
  return formatNumber(clamped / 100, { style: 'percent', maximumFractionDigits: 0 });
}
