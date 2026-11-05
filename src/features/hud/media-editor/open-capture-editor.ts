/**
 * Opening the capture editor from the dock. Internal preview for now: the clip pill
 * opens the editor only while `intent.dock.captureEditorPreview` is set to '1' in
 * the dock's local storage; otherwise it keeps its player dialog.
 */
import { electronAPI, isElectron } from '$lib/electron-bridge';
import type { DockEvidenceClip, DockMark } from '$shared/dock-evidence';
import {
  DOCK_CAPTURE_EDITOR_CHANNELS,
  type DockCaptureEditorOpenRequest,
  type DockCaptureEditorOpenResult,
} from '$shared/dock-capture-editor';

const PREVIEW_KEY = 'intent.dock.captureEditorPreview';

export function dockCaptureEditorPreviewEnabled(): boolean {
  try {
    return isElectron() && localStorage.getItem(PREVIEW_KEY) === '1';
  } catch {
    return false;
  }
}

/** The editor request for a finished, placed recording and the marks made during it. */
export function dockRecordingEditorRequest(input: {
  workspaceId: string;
  agentId: string;
  clip: DockEvidenceClip;
  marks: readonly DockMark[];
}): DockCaptureEditorOpenRequest | null {
  const { clip } = input;
  if (clip.status !== 'ready' || !clip.path) return null;
  const marks = input.marks
    .filter(
      (mark): mark is DockMark & { clipMs: number } =>
        mark.clipId === clip.id && typeof mark.clipMs === 'number',
    )
    .sort((a, b) => a.clipMs - b.clipMs)
    .map((mark) => ({
      id: mark.id,
      tool: mark.tool,
      atMs: mark.clipMs,
      ...(mark.element?.name ? { label: mark.element.name.slice(0, 200) } : {}),
    }));
  return {
    kind: 'recording',
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    attachmentId: clip.id,
    // A placed recording's attachment path changes only when it is replaced.
    sourceRevision: clip.path,
    attachmentPath: clip.path,
    title: '',
    durationMs: clip.durationMs,
    marks,
    provenance: {
      hasMicAudio: clip.hasMicAudio,
      // Marks drawn while recording are part of the recorded frames.
      visuals: marks.length > 0 ? 'baked-marks' : 'clean',
    },
  };
}

export async function openDockCaptureEditor(
  request: DockCaptureEditorOpenRequest,
): Promise<DockCaptureEditorOpenResult> {
  if (!isElectron()) return { ok: false, error: 'unavailable' };
  try {
    return ((await electronAPI().invoke(DOCK_CAPTURE_EDITOR_CHANNELS.OPEN, request)) ?? {
      ok: false,
      error: 'unavailable',
    }) as DockCaptureEditorOpenResult;
  } catch {
    return { ok: false, error: 'transport' };
  }
}
