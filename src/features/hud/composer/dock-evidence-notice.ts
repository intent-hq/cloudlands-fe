/**
 * Dock banner notices for screen-evidence starts and refusals. Every refused
 * start says why; a permission cause offers "Open Settings" for its pane
 * (user click only — nothing opens System Settings automatically).
 */
import { notify } from '$lib/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';
import type { DockAnnotationIssue } from '$shared/dock-annotation';
import type { DockEvidenceErrorCode } from '$shared/dock-evidence';
import type { DockEvidencePrivacyPane } from '$shared/dock-evidence-ipc';
import { createDockComposerLabels } from './dock-composer-labels';

export interface DockEvidenceNotice {
  /** Replaces the banner of the same kind instead of stacking. */
  key: string;
  text: string;
  pane?: DockEvidencePrivacyPane;
}

/** Why an annotate session did not start (native `detail` narrows `unavailable`). */
export function annotationStartNotice(
  error: DockEvidenceErrorCode,
  detail?: string,
): DockEvidenceNotice {
  const key = 'dock-evidence:annotate';
  if (error === 'permission')
    return { key, text: m.dock_composer_screenPermission_tooltip(), pane: 'screen' };
  if (detail === 'display') return { key, text: m.dock_composer_annotateDisplay_error() };
  return { key, text: m.dock_composer_annotateStartFailed_error() };
}

/** A refused mark in a live session: no capture taken, no mark made. */
export function annotationIssueNotice(
  issue: Pick<DockAnnotationIssue, 'kind' | 'error'>,
): DockEvidenceNotice {
  const key = 'dock-evidence:annotate';
  if (issue.error === 'permission')
    return issue.kind === 'pick'
      ? { key, text: m.dock_composer_accessibilityPermission_tooltip(), pane: 'accessibility' }
      : { key, text: m.dock_composer_screenPermission_tooltip(), pane: 'screen' };
  // The screen could not be captured for the mark (helper or capture error).
  if (issue.kind === 'capture') return { key, text: m.dock_composer_markCaptureFailed_error() };
  return { key, text: m.dock_composer_annotationUnavailable_error() };
}

/** Capture or record refused by Screen Recording permission. */
export function screenPermissionNotice(kind: 'capture' | 'record'): DockEvidenceNotice {
  return {
    key: `dock-evidence:${kind}`,
    text: m.dock_composer_screenPermission_tooltip(),
    pane: 'screen',
  };
}

/** Dictation did not start; a microphone or speech-recognition denial offers its pane. */
export function speechStartNotice(code: string): DockEvidenceNotice {
  const pane: DockEvidencePrivacyPane | undefined = code.startsWith('speech-permission')
    ? 'speech'
    : code.includes('permission')
      ? 'microphone'
      : undefined;
  return {
    key: 'dock-evidence:mic',
    text: createDockComposerLabels().speechError(code),
    ...(pane ? { pane } : {}),
  };
}

/** Show a notice in the dock banner (the window's single unaddressed toast). */
export function showDockEvidenceNotice(
  notice: DockEvidenceNotice,
  openSettings: (pane: DockEvidencePrivacyPane) => void,
): void {
  const pane = notice.pane;
  notify.warning(notice.text, {
    key: notice.key,
    ...(pane
      ? {
          action: {
            label: m.annotation_startPermission_openSettings_label(),
            onClick: () => openSettings(pane),
          },
        }
      : {}),
  });
}
