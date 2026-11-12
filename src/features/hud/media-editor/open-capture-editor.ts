/**
 * Opening the capture editor from the dock. Internal preview for now: the clip pill
 * opens the editor only while `intent.dock.captureEditorPreview` is set to '1' in
 * the dock's local storage; otherwise it keeps its player dialog.
 */
import { electronAPI, isElectron } from '$lib/electron-bridge';
import {
  dockMediaSourceFor,
  type DockComposerEvidence,
  type DockEvidenceClip,
  type DockMark,
} from '$shared/dock-evidence';
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

/**
 * The editor request for a finished, placed recording and the marks made during it.
 * Its canonical source, saved edit and transcript go along only when the evidence
 * holds a valid one for this clip; otherwise the editor opens read-only.
 */
export function dockRecordingEditorRequest(input: {
  workspaceId: string;
  agentId: string;
  clip: DockEvidenceClip;
  evidence: DockComposerEvidence | null;
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
  const source = dockMediaSourceFor(input.evidence ?? undefined, clip.id);
  const media = source ? clip.media : undefined;
  return {
    kind: 'recording',
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    // The canonical source names the attachment file it describes; without one, the
    // clip and its placed path (which changes only when it is replaced) identify it.
    attachmentId: source?.attachmentId ?? clip.id,
    sourceRevision: source ? `${source.id}:${source.revision}` : clip.path,
    attachmentPath: clip.path,
    title: '',
    durationMs: clip.durationMs,
    marks,
    // The canonical source is the authority on how it was captured; without one, the
    // clip's own record decides, conservatively (any recorded mark counts as drawn in).
    provenance: source
      ? {
          ...(source.audio === 'unknown' ? {} : { hasMicAudio: source.audio === 'available' }),
          visuals: source.visuals,
        }
      : {
          hasMicAudio: clip.hasMicAudio,
          visuals: marks.length > 0 ? 'baked-marks' : 'clean',
        },
    ...(source && media
      ? { source, saved: media.saved ?? null, transcript: media.transcript ?? null }
      : {}),
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
