import { call } from 'typed-redux-saga';
import type { SagaGenerator } from 'typed-redux-saga';
import { DOCK_CAPTURE_EDITOR_CHANNELS } from '$shared/dock-capture-editor';
import { dockCaptureEditorPreviewEnabled } from '$features/hud/media-editor/open-capture-editor';

/**
 * Capture → editor handoff, renderer side: before a capture (or a recording stop) that
 * may open the media editor, ask main to keep the dock out of sight. The editor adopts
 * the hold when it opens; every other outcome must end it (`endDockEditorHold`).
 * Null when the editor cannot follow (preview off) or main refused.
 */
export function* beginDockEditorHold(): SagaGenerator<string | null> {
  if (!dockCaptureEditorPreviewEnabled() || !window.electronAPI?.invoke) return null;
  const token = crypto.randomUUID();
  const ok = yield* call(() =>
    window.electronAPI
      .invoke(DOCK_CAPTURE_EDITOR_CHANNELS.HOLD_BEGIN, { token })
      .catch(() => false),
  );
  return ok === true ? token : null;
}

/** No editor took this hold (refused, failed, cancelled): release it. Idempotent in main. */
export function endDockEditorHold(token: string | null | undefined): void {
  if (!token) return;
  void window.electronAPI
    ?.invoke(DOCK_CAPTURE_EDITOR_CHANNELS.HOLD_END, { token })
    .catch(() => false);
}
