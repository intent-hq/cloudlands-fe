/**
 * Localized text for workspace homes (PROTOCOL `methods/nodes.md` →
 * "Detached workspaces", "Moving the home"). The detached sentence is the
 * documented one; the banner, card marker tooltip and file, diff and terminal
 * panels all show it.
 */
import { formatDateTime } from '$lib/i18n/format';
import { getActiveLocale } from '$lib/i18n/locale';
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
  // A state this app does not know: say it is unavailable, without backup times.
  if (view.unknownState) return m.workspaceHome_banner_detachedNoBackup({ name: view.name });
  const time = backupTime(view);
  return time
    ? m.workspaceHome_banner_detached({ name: view.name, time })
    : m.workspaceHome_banner_detachedNoBackup({ name: view.name });
}

/** Why Run is disabled: the home reason while it is not attached, else null. */
export function homeRunDisabledReason(view: WorkspaceHomeView | null | undefined): string | null {
  return view?.unavailable ? homeUnavailableText(view) : null;
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

/** The opening banner's title: "Setting up home on Mac Studio…", or why it failed. */
export function homeSetupTitle(view: WorkspaceHomeView): string {
  switch (view.setup?.phase) {
    case 'preparing':
    case 'runningSetup':
      return m.workspaceHome_opening_title({ name: view.name });
    case 'openFailed':
      return m.workspaceHome_openFailed_title({ name: view.name });
    case 'setupFailed':
      return m.remoteAgent_notice_setupFailed_title({ machine: view.name });
    default:
      return '';
  }
}

/** The opening's step, or what follows a failure; null when there is none. */
export function homeSetupDetail(view: WorkspaceHomeView): string | null {
  const setup = view.setup;
  switch (setup?.phase) {
    case 'preparing':
      return m.remoteAgent_status_preparingCheckout();
    case 'runningSetup':
      return m.remoteAgent_status_runningSetup();
    case 'openFailed':
      return m.workspaceHome_openFailed_hint({ name: view.name });
    case 'setupFailed':
      if (setup.exitCode !== null) {
        return m.workspaceHome_setupFailed_exitCode({ code: String(setup.exitCode) });
      }
      return setup.timedOut
        ? m.workspaceHome_setupFailed_timeout()
        : m.workspaceHome_setupFailed_generic();
    default:
      return null;
  }
}

/**
 * Why the open or setup failed, as the machine said it, without its error
 * code ("node-checkout-failed: fetch failed" → "fetch failed"); null without one.
 */
export function homeOpenFailureReason(view: WorkspaceHomeView): string | null {
  const setup = view.setup;
  const error =
    setup?.phase === 'openFailed' || setup?.phase === 'setupFailed' ? setup.error : null;
  if (!error) return null;
  const reason = error.replace(/^[a-z][a-z0-9-]*:\s*/, '').trim();
  return reason || null;
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

/** "Where Reviewer and Builder run" for a Move home row; null without agents. */
export function homeMoveAgentsText(agents: readonly string[] = []): string | null {
  if (agents.length === 0) return null;
  if (agents.length === 1) return m.workspaceHome_moveDialog_agentDescription({ agent: agents[0] });
  const list = new Intl.ListFormat(getActiveLocale(), { style: 'long', type: 'conjunction' });
  return m.workspaceHome_moveDialog_agentsDescription({ agents: list.format(agents) });
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
