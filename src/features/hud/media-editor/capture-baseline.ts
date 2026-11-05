/**
 * The screenshot editor's Reset baseline (Capture and recording editor spec, "Reset
 * edits"): the marks captured with the first pixels, on the session's current pixels.
 * After a saved retake they are carried onto the new pixels by the two captures'
 * frames, as a retake carries edits; without that mapping there is no baseline, and
 * Reset stays unavailable rather than guessing.
 */
import type { DockCaptureEditorSnapshot } from '$shared/dock-capture-editor';
import { dockMediaRetakeMapping, originalDockMediaEdit } from '$shared/dock-media-edit';
import type { ScreenshotEditorBundle } from './screenshot/DockScreenshotEditorWindow.svelte';
import { retakeScreenshotEdit } from './screenshot/screenshot-edit-geometry';

export function screenshotCaptureBaseline(
  snapshot: DockCaptureEditorSnapshot,
): ScreenshotEditorBundle | undefined {
  const source = snapshot.source;
  if (!source || source.kind !== 'screenshot') return undefined;
  const origin = snapshot.originalSource ?? source;
  const found = originalDockMediaEdit({
    source: origin,
    saved: snapshot.saved ?? null,
    transcript: null,
  });
  if (!found) return undefined;
  if (origin.id === source.id) return { source, mediaUrl: snapshot.mediaUrl, edit: found.edit };
  const mapping = dockMediaRetakeMapping(origin, source);
  if (!mapping) return undefined;
  try {
    return {
      source,
      mediaUrl: snapshot.mediaUrl,
      edit: retakeScreenshotEdit(found.edit, source, mapping),
    };
  } catch {
    return undefined;
  }
}
