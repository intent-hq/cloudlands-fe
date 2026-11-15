/**
 * Localized text for workspace homes (PROTOCOL `methods/nodes.md` →
 * "Detached workspaces", "Moving the home"). The detached sentence is the
 * documented one; the banner, card marker tooltip and file, diff and terminal
 * panels all show it.
 */
import { formatDateTime } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';
import type { MoveHomeFailure } from './workspace-home-slice';
import type { WorkspaceHomeView } from './workspace-home';

function backupTime(view: Pick<WorkspaceHomeView, 'lastBackupAt'>): string {
  return view.lastBackupAt ? formatDateTime(view.lastBackupAt) : '';
}

/** Why files, terminals and scripts are unavailable (detached or moving). */
export function homeUnavailableText(view: WorkspaceHomeView): string {
  if (view.starting) return m.workspaceHome_starting_label();
  if (view.state === 'moving') return m.workspaceHome_banner_moving();
  const time = backupTime(view);
  return time
    ? m.workspaceHome_banner_detached({ name: view.name, time })
    : m.workspaceHome_banner_detachedNoBackup({ name: view.name });
}

/** The banner sentence for the view's banner; empty when it has none. */
export function homeBannerText(view: WorkspaceHomeView): string {
  if (view.banner === 'detached' || view.banner === 'moving') return homeUnavailableText(view);
  if (view.banner !== 'backupWarning') return '';
  const time = backupTime(view);
  return time
    ? m.workspaceHome_banner_backupWarning({ name: view.name, time })
    : m.workspaceHome_banner_backupWarningNoBackup({ name: view.name });
}

/** The card marker's label. */
export function homeMarkerLabel(marker: 'detached' | 'moving'): string {
  return marker === 'detached'
    ? m.workspaceHome_marker_detached()
    : m.workspaceHome_marker_moving();
}

/** "Last backup Nov 12, 2026, 9:41 AM", or null before the first backup. */
export function homeLastBackupText(view: WorkspaceHomeView): string | null {
  const time = backupTime(view);
  return time ? m.workspaceHome_header_lastBackup({ time }) : null;
}

/** The warning the Move home dialog shows before a move from a detached home. */
export function homeMoveWarningText(view: WorkspaceHomeView): string | null {
  if (!view.moveWarning) return null;
  const time = backupTime(view);
  return time
    ? m.workspaceHome_moveDialog_warning({ name: view.name, time })
    : m.workspaceHome_moveDialog_warningNoBackup({ name: view.name });
}

/** Why `workspace.setHome` refused. */
export function moveHomeFailureText(failure: MoveHomeFailure): string {
  switch (failure.code) {
    case 'forbidden':
      return m.workspaceHome_moveError_forbidden();
    case 'homes-unsupported':
      return m.workspaceHome_moveError_homesUnsupported();
    case 'home-moving':
      return m.workspaceHome_moveError_homeMoving();
    case 'home-target-unavailable':
      return m.workspaceHome_moveError_targetUnavailable();
    case 'machine-update-required':
      return m.workspaceHome_moveError_updateRequired();
    default:
      return m.workspaceHome_moveError_failed({ message: failure.message });
  }
}
