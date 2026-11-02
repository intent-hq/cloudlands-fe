import { m } from '$shared/paraglide/messages.js';
import { formatShortcut } from '$lib/utils/shortcuts';
import { formatInteger } from '$lib/i18n/format';
import type { DockComposerMediaLabels } from '../components/dock-composer-media-presentation';
import type { FileAttachmentPolicy } from '$lib/components/chat/input/file-attachment-policy';
import { DOCK_EVIDENCE_LIMITS } from '$shared/dock-evidence';

export type DockComposerLabels = DockComposerMediaLabels & {
  speechError: (code: string) => string;
};

/** Keep platform shortcut formatting and locale lookup at the presentation boundary. */
export function createDockComposerLabels(): DockComposerLabels {
  return {
    capture: m.dock_composer_capture_tooltip({ shortcut: formatShortcut('mod+shift+s') }),
    captureLimit: m.dock_composer_captureLimit_tooltip(),
    clipLimit: m.dock_composer_clipLimit_tooltip({
      limit: formatInteger(DOCK_EVIDENCE_LIMITS.clips),
    }),
    record: m.dock_composer_record_tooltip({ shortcut: formatShortcut('mod+shift+r') }),
    stopRecording: m.dock_composer_stopRecording_tooltip(),
    annotate: m.dock_composer_annotate_tooltip({ shortcut: formatShortcut('mod+shift+a') }),
    annotationTools: m.annotation_toolbar_ariaLabel(),
    annotateCurrent: (tool) => m.dock_composer_annotate_ariaLabel({ tool }),
    tools: {
      pick: m.dock_composer_pick_label(),
      box: m.dock_composer_box_label(),
      pen: m.dock_composer_pen_label(),
      arrow: m.annotation_arrow_label(),
    },
    dictate: m.dock_composer_dictate_tooltip({ shortcut: formatShortcut('mod+shift+m') }),
    stopDictating: m.dock_composer_stopDictating_tooltip(),
    annotating: m.dock_composer_annotating_status(),
    listening: m.dock_composer_listening_status(),
    recording: m.dock_composer_recording_status(),
    markUp: m.dock_composer_markUp_label(),
    remove: m.chat_contextChip_remove_label(),
    play: m.dock_composer_play_label(),
    done: m.dock_composer_done_label(),
    attachments: m.context_attachments_title_label(),
    retry: m.chat_shared_retry_label(),
    attachmentPending: m.dock_composer_attachmentPending_status(),
    attachmentFailed: m.dock_composer_attachmentFailed_error(),
    image: (n) => m.dock_composer_image_ariaLabel({ n: formatInteger(n) }),
    clip: (duration) => m.dock_composer_clip_ariaLabel({ duration }),
    recordingReference: (n, end) =>
      end
        ? m.dock_composer_recordingEnd_chip({ n: formatInteger(n) })
        : m.dock_composer_recordingStart_chip({ n: formatInteger(n) }),
    speechError: (code) => {
      if (code.includes('permission')) return m.dock_composer_speechPermission_error();
      if (
        [
          'unsupported-platform',
          'helper-missing',
          'recognizer-unavailable',
          'locale-unsupported',
          'assets-unavailable',
          'unavailable',
        ].includes(code)
      )
        return m.dock_composer_speechUnavailable_error();
      return m.dock_composer_speechFailed_error();
    },
  };
}

export function createDockComposerFilePolicy(
  enabled: boolean,
  excludedIds: readonly string[],
): FileAttachmentPolicy {
  return {
    enabled,
    limit: DOCK_EVIDENCE_LIMITS.files,
    excludedIds,
    unavailableMessage: m.dock_composer_filesUnavailable_error(),
    limitMessage: m.dock_composer_fileLimit_error({
      limit: formatInteger(DOCK_EVIDENCE_LIMITS.files),
    }),
  };
}
